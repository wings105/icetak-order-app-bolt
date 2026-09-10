-- Make customer checkout confirmation unambiguous, atomic and retry-safe.
-- The prior implementation used `delivery_code` as both a PL/pgSQL variable
-- and a payment_sessions column, which raises PostgreSQL 42702 at runtime.
create or replace function public.icetak_customer_confirm_checkout(
  p_customer_token text,
  p_customer jsonb default '{}'::jsonb,
  p_delivery text default null,
  p_expected_version integer default null,
  p_actor text default 'customer-link'::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  d public.qrpay_order_drafts%rowtype;
  work jsonb;
  totals jsonb;
  result jsonb;
  payment_result jsonb;
  v_delivery_code text;
  v_delivery_fee numeric;
  v_free_shipping boolean;
  next_version integer;
begin
  select * into d
  from public.qrpay_order_drafts
  where customer_review_token=p_customer_token
  for update;

  if not found then raise exception 'draft_not_found'; end if;
  if d.admin_approved_at is null then raise exception 'draft_not_ready'; end if;
  if d.order_id is not null or d.status='confirmed' then
    return jsonb_build_object('success',true,'already_confirmed',true,'order_id',d.order_no);
  end if;
  if d.payment_status='paid' then raise exception 'payment_already_received'; end if;
  if d.customer_status='change_requested' then raise exception 'seller_review_required'; end if;

  -- A browser/network retry after a successful confirmation must resume the
  -- same payment session instead of changing the quote or confirming twice.
  if d.payment_required and d.customer_status in ('confirmed','awaiting_payment') then
    payment_result:=public.icetak_prepare_draft_payment(p_customer_token,false);
    return jsonb_build_object(
      'success',true,
      'already_confirmed',true,
      'payment_required',true,
      'draft_id',d.id,
      'payment',payment_result
    );
  end if;

  if p_expected_version is not null and d.version<>p_expected_version then
    raise exception 'quote_changed';
  end if;

  work:=coalesce(d.working_draft,'{}'::jsonb);
  v_delivery_code:=lower(btrim(coalesce(p_delivery,work->>'delivery','')));
  v_free_shipping:=lower(coalesce(work->>'free_shipping','false')) in ('true','1','yes','on')
    and v_delivery_code<>'pickup';
  v_delivery_fee:=case
    when v_free_shipping then 0
    when v_delivery_code='pickup' then 0
    when v_delivery_code='spx' then 4.50
    when v_delivery_code='jnt' then 5.90
    when v_delivery_code='ninja' then 6.90
    else null
  end;
  if v_delivery_fee is null then raise exception 'invalid_delivery_option'; end if;

  work:=jsonb_set(work,'{delivery}',to_jsonb(v_delivery_code),true);
  work:=jsonb_set(work,'{free_shipping}',to_jsonb(v_free_shipping),true);
  work:=jsonb_set(work,'{delivery_fee}',to_jsonb(v_delivery_fee),true);
  work:=jsonb_set(work,'{customer}',coalesce(work->'customer','{}'::jsonb)||coalesce(p_customer,'{}'::jsonb),true);
  totals:=public.icetak_qrpay_draft_totals(work);
  next_version:=d.version+1;

  work:=work||jsonb_build_object(
    'total',(totals->>'draft_total')::numeric,
    'draft_total',(totals->>'draft_total')::numeric,
    'delivery_fee',(totals->>'shipping_fee')::numeric,
    'pricing_totals',totals
  );
  work:=jsonb_set(
    work,
    '{customer_checkout}',
    jsonb_build_object(
      'delivery',v_delivery_code,
      'delivery_fee',(totals->>'shipping_fee')::numeric,
      'free_shipping',v_free_shipping,
      'source','customer_shop_checkout_v2',
      'draft_version',next_version,
      'confirmed_at',now()
    ),
    true
  );

  update public.payment_sessions ps
  set status='superseded'
  where ps.draft_id=d.id
    and ps.status in ('pending','submitted','receipt_submitted','pending_review')
    and (
      ps.base_amount is distinct from (totals->>'draft_total')::numeric
      or ps.draft_version is distinct from next_version
      or coalesce(ps.delivery_code,'') is distinct from v_delivery_code
      or ps.shipping_fee_snapshot is distinct from (totals->>'shipping_fee')::numeric
    );

  update public.qrpay_order_drafts
  set working_draft=work,
      item_subtotal=(totals->>'item_subtotal')::numeric,
      shipping_fee=(totals->>'shipping_fee')::numeric,
      draft_total=(totals->>'draft_total')::numeric,
      payment_difference=case
        when payment_amount is null then 0
        else round((totals->>'draft_total')::numeric-payment_amount,2)
      end,
      payment_session_id=null,
      version=next_version,
      updated_at=now()
  where id=d.id;

  insert into public.qrpay_order_draft_events(
    draft_id,event_type,actor,before_data,after_data,metadata
  ) values(
    d.id,'customer_checkout_confirmed',p_actor,d.working_draft,work,
    jsonb_build_object(
      'delivery',v_delivery_code,
      'shipping_fee',(totals->>'shipping_fee')::numeric,
      'free_shipping',v_free_shipping,
      'previous_version',d.version,
      'draft_version',next_version,
      'draft_total',(totals->>'draft_total')::numeric,
      'payment_session_refreshed',true
    )
  );

  result:=public.icetak_customer_confirm_draft(p_customer_token,p_customer,p_actor);
  if coalesce((result->>'payment_required')::boolean,false) then
    payment_result:=public.icetak_prepare_draft_payment(p_customer_token,false);
    result:=result||jsonb_build_object('payment',payment_result);
  end if;

  return result||jsonb_build_object(
    'delivery',v_delivery_code,
    'shipping_fee',(totals->>'shipping_fee')::numeric,
    'free_shipping',v_free_shipping,
    'item_subtotal',(totals->>'item_subtotal')::numeric,
    'draft_total',(totals->>'draft_total')::numeric,
    'payment_session_refresh_required',true
  );
end
$$;

revoke all on function public.icetak_customer_confirm_checkout(text,jsonb,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.icetak_customer_confirm_checkout(text,jsonb,text,integer,text)
  to service_role;
