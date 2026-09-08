-- Preserve an admin-granted free-shipping quote when the customer confirms
-- or changes courier on the customer checkout page.
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
  delivery_code text;
  delivery_fee numeric;
  free_shipping boolean;
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
  if p_expected_version is not null and d.version<>p_expected_version then
    raise exception 'quote_changed';
  end if;

  work:=coalesce(d.working_draft,'{}'::jsonb);
  delivery_code:=lower(btrim(coalesce(p_delivery,work->>'delivery','')));
  free_shipping:=lower(coalesce(work->>'free_shipping','false')) in ('true','1','yes','on')
    and delivery_code<>'pickup';
  delivery_fee:=case
    when free_shipping then 0
    when delivery_code='pickup' then 0
    when delivery_code='spx' then 4.50
    when delivery_code='jnt' then 5.90
    when delivery_code='ninja' then 6.90
    else null
  end;
  if delivery_fee is null then raise exception 'invalid_delivery_option'; end if;

  work:=jsonb_set(work,'{delivery}',to_jsonb(delivery_code),true);
  work:=jsonb_set(work,'{free_shipping}',to_jsonb(free_shipping),true);
  work:=jsonb_set(work,'{delivery_fee}',to_jsonb(delivery_fee),true);
  work:=jsonb_set(work,'{customer}',coalesce(work->'customer','{}'::jsonb)||coalesce(p_customer,'{}'::jsonb),true);
  work:=jsonb_set(
    work,
    '{customer_checkout}',
    jsonb_build_object(
      'delivery',delivery_code,
      'delivery_fee',delivery_fee,
      'free_shipping',free_shipping,
      'source','customer_shop_checkout_v2',
      'draft_version',d.version,
      'confirmed_at',now()
    ),
    true
  );
  totals:=public.icetak_qrpay_draft_totals(work);

  update public.qrpay_order_drafts
  set working_draft=work,
      item_subtotal=(totals->>'item_subtotal')::numeric,
      shipping_fee=(totals->>'shipping_fee')::numeric,
      draft_total=(totals->>'draft_total')::numeric,
      payment_difference=case
        when payment_amount is null then 0
        else round((totals->>'draft_total')::numeric-payment_amount,2)
      end,
      version=version+1,
      updated_at=now()
  where id=d.id;

  insert into public.qrpay_order_draft_events(
    draft_id,event_type,actor,before_data,after_data,metadata
  ) values(
    d.id,'customer_checkout_confirmed',p_actor,d.working_draft,work,
    jsonb_build_object(
      'delivery',delivery_code,
      'shipping_fee',delivery_fee,
      'free_shipping',free_shipping,
      'previous_version',d.version,
      'draft_total',(totals->>'draft_total')::numeric
    )
  );

  result:=public.icetak_customer_confirm_draft(p_customer_token,p_customer,p_actor);
  return result||jsonb_build_object(
    'delivery',delivery_code,
    'shipping_fee',(totals->>'shipping_fee')::numeric,
    'free_shipping',free_shipping,
    'item_subtotal',(totals->>'item_subtotal')::numeric,
    'draft_total',(totals->>'draft_total')::numeric
  );
end
$$;

revoke all on function public.icetak_customer_confirm_checkout(text,jsonb,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.icetak_customer_confirm_checkout(text,jsonb,text,integer,text)
  to service_role;
