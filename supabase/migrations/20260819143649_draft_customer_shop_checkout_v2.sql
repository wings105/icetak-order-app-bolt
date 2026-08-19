alter table public.payment_sessions
  add column if not exists draft_version integer,
  add column if not exists pricing_snapshot jsonb,
  add column if not exists delivery_code text,
  add column if not exists shipping_fee_snapshot numeric;

create index if not exists idx_payment_sessions_draft_status_created
  on public.payment_sessions(draft_id,status,created_at desc)
  where draft_id is not null;

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

  delivery_code:=lower(btrim(coalesce(p_delivery,d.working_draft->>'delivery','')));
  delivery_fee:=case delivery_code
    when 'pickup' then 0
    when 'spx' then 4.50
    when 'jnt' then 5.90
    when 'ninja' then 6.90
    else null
  end;
  if delivery_fee is null then raise exception 'invalid_delivery_option'; end if;

  work:=coalesce(d.working_draft,'{}'::jsonb);
  work:=jsonb_set(work,'{delivery}',to_jsonb(delivery_code),true);
  work:=jsonb_set(work,'{delivery_fee}',to_jsonb(delivery_fee),true);
  work:=jsonb_set(work,'{customer}',coalesce(work->'customer','{}'::jsonb)||coalesce(p_customer,'{}'::jsonb),true);
  work:=jsonb_set(
    work,
    '{customer_checkout}',
    jsonb_build_object(
      'delivery',delivery_code,
      'delivery_fee',delivery_fee,
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
      'previous_version',d.version,
      'draft_total',(totals->>'draft_total')::numeric
    )
  );

  result:=public.icetak_customer_confirm_draft(p_customer_token,p_customer,p_actor);
  return result||jsonb_build_object(
    'delivery',delivery_code,
    'shipping_fee',(totals->>'shipping_fee')::numeric,
    'item_subtotal',(totals->>'item_subtotal')::numeric,
    'draft_total',(totals->>'draft_total')::numeric
  );
end
$$;

revoke all on function public.icetak_customer_confirm_checkout(text,jsonb,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.icetak_customer_confirm_checkout(text,jsonb,text,integer,text)
  to service_role;

create or replace function public.icetak_reopen_draft_checkout(
  p_customer_token text,
  p_actor text default 'customer-link'::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  d public.qrpay_order_drafts%rowtype;
begin
  select * into d
  from public.qrpay_order_drafts
  where customer_review_token=p_customer_token
  for update;

  if not found then raise exception 'draft_not_found'; end if;
  if d.order_id is not null or d.status='confirmed' then raise exception 'order_already_created'; end if;
  if d.payment_status='paid' then raise exception 'payment_already_received'; end if;
  if exists(
    select 1 from public.payment_sessions
    where draft_id=d.id and status in ('submitted','receipt_submitted','pending_review')
  ) then raise exception 'payment_receipt_already_submitted'; end if;

  update public.payment_sessions
  set status='superseded'
  where draft_id=d.id and status='pending';

  update public.qrpay_order_drafts
  set customer_status='ready',
      customer_confirmed_at=null,
      payment_status='unpaid',
      payment_session_id=null,
      status='ready_customer',
      version=version+1,
      updated_at=now()
  where id=d.id;

  update public.order_sessions
  set status='ready_customer',updated_at=now()
  where id=d.order_session_id;

  insert into public.qrpay_order_draft_events(
    draft_id,event_type,actor,before_data,after_data,metadata
  ) values(
    d.id,'customer_checkout_reopened',p_actor,d.working_draft,d.working_draft,
    jsonb_build_object('previous_payment_session_id',d.payment_session_id)
  );

  return jsonb_build_object('success',true,'draft_id',d.id,'status','ready');
end
$$;

revoke all on function public.icetak_reopen_draft_checkout(text,text)
  from public,anon,authenticated;
grant execute on function public.icetak_reopen_draft_checkout(text,text)
  to service_role;

create or replace function public.icetak_prepare_draft_payment(
  p_customer_token text,
  p_force_new boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  d public.qrpay_order_drafts%rowtype;
  sid uuid;
  exp timestamptz;
  selected numeric;
  off integer;
  selected_off integer:=0;
  found_slot boolean:=false;
  old public.payment_sessions%rowtype;
  snapshot jsonb;
  delivery_code text;
begin
  select * into d
  from public.qrpay_order_drafts
  where customer_review_token=p_customer_token
  for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.admin_approved_at is null then raise exception 'draft_not_ready_for_customer'; end if;
  if d.customer_status not in ('confirmed','awaiting_payment') then raise exception 'customer_must_confirm_first'; end if;
  if not d.payment_required then return jsonb_build_object('payment_required',false,'status',d.payment_status); end if;
  if d.payment_status='paid' then
    return jsonb_build_object(
      'payment_required',true,'status','matched','draft_id',d.id,
      'baseAmount',d.draft_total,'expectedAmount',d.draft_total
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('icetak_payment_amount_allocator',0));

  update public.payment_sessions
  set status='expired'
  where draft_id=d.id and status='pending'
    and expires_at<=now()-make_interval(secs=>coalesce(reservation_grace_seconds,120));

  delivery_code:=lower(coalesce(d.working_draft->>'delivery',''));
  snapshot:=jsonb_build_object(
    'draft_version',d.version,
    'item_subtotal',d.item_subtotal,
    'shipping_fee',d.shipping_fee,
    'draft_total',d.draft_total,
    'delivery',delivery_code,
    'price_adjustments',coalesce(d.working_draft->'price_adjustments','{}'::jsonb)
  );

  if not p_force_new then
    select * into old
    from public.payment_sessions
    where draft_id=d.id
      and status in ('pending','submitted','receipt_submitted','pending_review')
      and expires_at>now()
    order by created_at desc
    limit 1;

    if found and (
      old.base_amount is distinct from d.draft_total
      or old.draft_version is distinct from d.version
      or coalesce(old.delivery_code,'') is distinct from delivery_code
    ) then
      update public.payment_sessions set status='superseded' where id=old.id;
      old:=null;
    end if;
  end if;

  if old.id is not null then
    sid:=old.id;
    exp:=old.expires_at;
    selected:=old.expected_amount;
    selected_off:=coalesce(old.amount_offset_cents,0);
  else
    for off in 0..50 loop
      selected:=round(d.draft_total-(off::numeric/100),2);
      if selected>0 and not exists(
        select 1
        from public.payment_sessions ps
        where ps.expected_amount=selected
          and ps.status in ('pending','submitted','receipt_submitted','pending_review')
          and ps.expires_at>now()-make_interval(secs=>coalesce(ps.reservation_grace_seconds,120))
      ) then
        found_slot:=true;
        selected_off:=off;
        exit;
      end if;
    end loop;
    if not found_slot then
      raise exception 'Payment amount slots are temporarily full. Please try again in 2 minutes.';
    end if;

    insert into public.payment_sessions(
      draft_id,purpose,base_amount,expected_amount,discount,amount_offset_cents,
      reservation_grace_seconds,status,expires_at,order_token,draft_version,
      pricing_snapshot,delivery_code,shipping_fee_snapshot
    ) values(
      d.id,'draft_checkout',d.draft_total,selected,round(d.draft_total-selected,2),selected_off,
      120,'pending',now()+interval '10 minutes',d.customer_review_token,d.version,
      snapshot,delivery_code,d.shipping_fee
    ) returning id,expires_at into sid,exp;
  end if;

  update public.qrpay_order_drafts
  set payment_session_id=sid,payment_status='pending',customer_status='awaiting_payment',
      status='awaiting_payment',updated_at=now()
  where id=d.id;
  update public.order_sessions
  set status='awaiting_payment',updated_at=now()
  where id=d.order_session_id;

  return jsonb_build_object(
    'id',sid,'draft_id',d.id,'baseAmount',d.draft_total,'expectedAmount',selected,
    'discount',round(d.draft_total-selected,2),'amountOffsetCents',selected_off,
    'expiresAt',extract(epoch from exp)*1000,'status','pending','draftVersion',d.version,
    'delivery',delivery_code,'shippingFee',d.shipping_fee
  );
end
$$;

revoke all on function public.icetak_prepare_draft_payment(text,boolean)
  from public,anon,authenticated;
grant execute on function public.icetak_prepare_draft_payment(text,boolean)
  to service_role;
