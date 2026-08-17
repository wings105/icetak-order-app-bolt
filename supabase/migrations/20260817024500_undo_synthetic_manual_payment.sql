-- Safely undo a synthetic draft payment without touching the real QRPay event.
-- The removed row is archived for audit and order payment totals are recalculated.

create table if not exists public.payment_transaction_voids (
  id uuid primary key default gen_random_uuid(),
  original_payment_id uuid not null unique,
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null,
  transaction_id text,
  amount numeric not null,
  paid_at timestamptz,
  sender_name text,
  raw_payload jsonb not null default '{}'::jsonb,
  payment_snapshot jsonb not null,
  order_snapshot jsonb not null,
  void_reason text not null,
  voided_by text not null,
  voided_at timestamptz not null default now()
);

create index if not exists payment_transaction_voids_order_idx
  on public.payment_transaction_voids(order_id,voided_at desc);

alter table public.payment_transaction_voids enable row level security;
revoke all on table public.payment_transaction_voids from public,anon,authenticated;
grant select,insert on table public.payment_transaction_voids to service_role;

create or replace function public.icetak_admin_undo_manual_payment(
  p_payment_id uuid,
  p_reason text default 'Manual payment linked by mistake'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor text;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_payment public.payment_transactions%rowtype;
  v_order public.orders%rowtype;
  v_void public.payment_transaction_voids%rowtype;
  v_result jsonb;
begin
  if not public.icetak_admin_has_permission('verify_payments') then
    raise exception 'Forbidden: verify_payments';
  end if;
  select username into v_actor
  from public.admin_users
  where auth_user_id=auth.uid() and is_active=true
  limit 1;
  if v_actor is null then raise exception 'Unauthorized'; end if;
  if p_payment_id is null then raise exception 'Payment ID is required'; end if;
  if v_reason is null then raise exception 'Undo reason is required'; end if;
  if length(v_reason)>500 then raise exception 'Undo reason is too long'; end if;

  perform pg_advisory_xact_lock(hashtextextended('undo-manual-payment:'||p_payment_id::text,0));

  select * into v_payment
  from public.payment_transactions
  where id=p_payment_id
  for update;

  if not found then
    select * into v_void
    from public.payment_transaction_voids
    where original_payment_id=p_payment_id;
    if found then
      return jsonb_build_object(
        'success',true,'duplicate',true,'payment_id',p_payment_id,
        'order_id',v_void.order_id,'transaction_id',v_void.transaction_id,
        'amount',v_void.amount,'voided_at',v_void.voided_at,'voided_by',v_void.voided_by
      );
    end if;
    raise exception 'Payment was not found';
  end if;

  if lower(coalesce(v_payment.provider,''))<>'manual_qrpay'
     or coalesce(v_payment.transaction_id,'') not like 'draft_manual:%'
     or coalesce(v_payment.raw_payload->>'source','')<>'admin_draft_manual_paid' then
    raise exception 'Only a synthetic draft manual payment can be undone';
  end if;
  if v_payment.order_id is null then raise exception 'Manual payment is not linked to an order'; end if;

  select * into v_order from public.orders where id=v_payment.order_id for update;
  if not found then raise exception 'Linked order was not found'; end if;
  if v_order.pickup_collected_at is not null
     or v_order.delivered_at is not null
     or lower(coalesce(v_order.fulfillment_stage,'')) in ('collected','delivered','completed') then
    raise exception 'Completed or delivered orders cannot have payment undone';
  end if;

  insert into public.payment_transaction_voids(
    original_payment_id,order_id,provider,transaction_id,amount,paid_at,sender_name,
    raw_payload,payment_snapshot,order_snapshot,void_reason,voided_by
  ) values(
    v_payment.id,v_payment.order_id,coalesce(v_payment.provider,'manual_qrpay'),
    v_payment.transaction_id,v_payment.amount,v_payment.paid_at,v_payment.sender_name,
    coalesce(v_payment.raw_payload,'{}'::jsonb),to_jsonb(v_payment),to_jsonb(v_order),
    v_reason,v_actor
  ) on conflict (original_payment_id) do nothing;

  delete from public.payment_transactions where id=v_payment.id;
  v_result:=finance.recalculate_order_payment(v_order.id,v_actor);

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(
    v_order.id::text,coalesce(v_order.order_no,v_order.order_id),'undo_manual_payment',v_actor,
    jsonb_build_object(
      'payment_id',v_payment.id,'provider',v_payment.provider,
      'transaction_id',v_payment.transaction_id,'amount',v_payment.amount,
      'reason',v_reason,'before_payment_status',v_order.payment_status,
      'before_payment_method',v_order.payment_method,'after',v_result,
      'production_retained',true
    )
  );

  return jsonb_build_object(
    'success',true,'duplicate',false,'payment_id',v_payment.id,
    'order_id',v_order.id,'order_no',coalesce(v_order.order_no,v_order.order_id),
    'transaction_id',v_payment.transaction_id,'amount',v_payment.amount,
    'payment',v_result,'production_retained',true
  );
end;
$$;

revoke execute on function public.icetak_admin_undo_manual_payment(uuid,text) from public,anon;
grant execute on function public.icetak_admin_undo_manual_payment(uuid,text) to authenticated,service_role;

-- The operational QRPay bridge keeps a real payment row in payment_transactions
-- with order_id null. Preserve that immutable row and link it in-place.
do $$
begin
  if to_regprocedure('public.finance_admin_manual_match_qrpay_legacy(text,text,text,boolean)') is null then
    alter function public.finance_admin_manual_match_qrpay(text,text,text,boolean)
      rename to finance_admin_manual_match_qrpay_legacy;
  end if;
end;
$$;

create or replace function public.finance_admin_manual_match_qrpay(
  p_transaction_id text,
  p_order_no text,
  p_actor text default 'admin1',
  p_confirm_mismatch boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_transaction_id text:=nullif(btrim(coalesce(p_transaction_id,'')),'');
  v_order_no text:=nullif(btrim(coalesce(p_order_no,'')),'');
  v_actor text:=coalesce(nullif(btrim(coalesce(p_actor,'')),''),'admin1');
  v_payment public.payment_transactions%rowtype;
  v_order public.orders%rowtype;
  v_job public.qrpay_ai_jobs%rowtype;
  v_phone text;
  v_order_phone text;
  v_linked_amount numeric:=0;
  v_paid_after numeric:=0;
  v_remaining_after numeric:=0;
  v_overpaid_after numeric:=0;
  v_amount_difference numeric:=0;
  v_phone_match boolean:=false;
  v_requires_confirmation boolean:=false;
  v_settlement_status text;
  v_payment_result jsonb;
begin
  if v_transaction_id is null or v_order_no is null then
    raise exception 'Transaction ID and order number are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('qrpay-manual-match:'||v_transaction_id,0));

  select * into v_payment
  from public.payment_transactions
  where transaction_id=v_transaction_id
  limit 1
  for update;

  -- Normal legacy path: unmatched_payment_transactions is still the source.
  if not found then
    return public.finance_admin_manual_match_qrpay_legacy(
      v_transaction_id,v_order_no,v_actor,p_confirm_mismatch
    );
  end if;

  select * into v_order
  from public.orders
  where lower(coalesce(order_no,order_id))=lower(v_order_no)
  order by created_at desc
  limit 1
  for update;
  if not found then raise exception 'Order % was not found',v_order_no; end if;

  if v_payment.order_id=v_order.id then
    return jsonb_build_object(
      'success',true,'duplicate',true,'transaction_id',v_transaction_id,
      'order_id',v_order.id,'order_no',coalesce(v_order.order_no,v_order.order_id),
      'payment_id',v_payment.id
    );
  end if;
  if v_payment.order_id is not null then
    raise exception 'Transaction % is already linked to another order',v_transaction_id;
  end if;
  if lower(coalesce(v_payment.provider,'')) not in ('qrpay','qrpay_ai','duitnow','finance-qrpay') then
    raise exception 'Transaction % is not a real QRPay payment',v_transaction_id;
  end if;

  select * into v_job
  from public.qrpay_ai_jobs
  where transaction_id=v_transaction_id
  limit 1
  for update;

  v_phone:=nullif(regexp_replace(coalesce(v_job.matched_phone,v_payment.raw_payload->>'matched_phone',''),'[^0-9]','','g'),'');
  select nullif(regexp_replace(coalesce(nullif(v_order.delivery_phone,''),c.phone,''),'[^0-9]','','g'),'')
  into v_order_phone
  from public.customers c
  where c.id=v_order.customer_id;
  if v_order_phone is null then
    v_order_phone:=nullif(regexp_replace(coalesce(v_order.delivery_phone,''),'[^0-9]','','g'),'');
  end if;

  select coalesce(sum(pt.amount),0) into v_linked_amount
  from public.payment_transactions pt
  where pt.order_id=v_order.id and pt.transaction_id<>v_transaction_id;

  v_paid_after:=round(v_linked_amount+v_payment.amount,2);
  v_remaining_after:=round(greatest(coalesce(v_order.total,0)-v_paid_after,0),2);
  v_overpaid_after:=round(greatest(v_paid_after-coalesce(v_order.total,0),0),2);
  v_amount_difference:=round(coalesce(v_order.total,0)-v_paid_after,2);
  v_phone_match:=v_phone is not null and v_order_phone is not null and v_phone=v_order_phone;
  v_requires_confirmation:=not v_phone_match or v_overpaid_after>=0.01;
  v_settlement_status:=case
    when v_overpaid_after>=0.01 then 'overpaid'
    when v_remaining_after>=0.01 then 'partial'
    else 'settled'
  end;

  if v_requires_confirmation and not coalesce(p_confirm_mismatch,false) then
    return jsonb_build_object(
      'success',false,'requires_confirmation',true,'transaction_id',v_transaction_id,
      'payment_amount',v_payment.amount,'order_id',v_order.id,
      'order_no',coalesce(v_order.order_no,v_order.order_id),'order_total',v_order.total,
      'linked_amount',v_linked_amount,'paid_after',v_paid_after,
      'remaining_after',v_remaining_after,'overpaid_after',v_overpaid_after,
      'settlement_status',v_settlement_status,'amount_difference',v_amount_difference,
      'payment_phone',v_phone,'order_phone',v_order_phone,'phone_match',v_phone_match
    );
  end if;

  update public.payment_transactions set
    order_id=v_order.id,
    raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object(
      'manual_match',true,'manual_match_order_no',coalesce(v_order.order_no,v_order.order_id),
      'manual_match_actor',v_actor,'manual_match_at',now(),
      'matched_phone',v_phone,'order_phone',v_order_phone,
      'linked_amount_before',v_linked_amount,'paid_after',v_paid_after,
      'remaining_after',v_remaining_after,'overpaid_after',v_overpaid_after,
      'settlement_status',v_settlement_status,'linked_existing_payment_row',true
    )
  where id=v_payment.id;

  v_payment_result:=finance.recalculate_order_payment(v_order.id,v_actor);

  update public.qrpay_ai_jobs set
    order_id=v_order.id,order_no=coalesce(v_order.order_no,v_order.order_id),
    status='completed',completed_at=now(),locked_at=null,
    match_reason='manual_admin_match_existing_order_'||v_settlement_status,updated_at=now()
  where transaction_id=v_transaction_id;

  update public.admin_order_reviews set
    status='created',order_id=v_order.id,order_no=coalesce(v_order.order_no,v_order.order_id),
    approved_at=coalesce(approved_at,now()),completed_at=now(),last_error=null,
    evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
      'manual_match',true,'actor',v_actor,'linked_existing_payment_row',true,
      'linked_amount_before',v_linked_amount,'paid_after',v_paid_after,
      'remaining_after',v_remaining_after,'overpaid_after',v_overpaid_after,
      'settlement_status',v_settlement_status,'phone_match',v_phone_match
    ),updated_at=now()
  where transaction_id=v_transaction_id or qrpay_job_id=v_job.id;

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(
    v_order.id::text,coalesce(v_order.order_no,v_order.order_id),'manual_match_qrpay',v_actor,
    jsonb_build_object(
      'transaction_id',v_transaction_id,'payment_id',v_payment.id,
      'payment_amount',v_payment.amount,'order_total',v_order.total,
      'linked_existing_payment_row',true,'linked_amount_before',v_linked_amount,
      'paid_after',v_paid_after,'remaining_after',v_remaining_after,
      'overpaid_after',v_overpaid_after,'settlement_status',v_settlement_status,
      'phone_match',v_phone_match,'payment',v_payment_result
    )
  );

  return jsonb_build_object(
    'success',true,'duplicate',false,'transaction_id',v_transaction_id,
    'payment_id',v_payment.id,'payment_amount',v_payment.amount,
    'order_id',v_order.id,'order_no',coalesce(v_order.order_no,v_order.order_id),
    'order_total',v_order.total,'linked_amount_before',v_linked_amount,
    'paid_after',v_paid_after,'remaining_after',v_remaining_after,
    'overpaid_after',v_overpaid_after,'settlement_status',v_settlement_status,
    'amount_difference',v_amount_difference,'phone_match',v_phone_match,
    'linked_existing_payment_row',true
  );
end;
$$;

revoke execute on function public.finance_admin_manual_match_qrpay_legacy(text,text,text,boolean) from public,anon,authenticated;
revoke execute on function public.finance_admin_manual_match_qrpay(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.finance_admin_manual_match_qrpay_legacy(text,text,text,boolean) to service_role;
grant execute on function public.finance_admin_manual_match_qrpay(text,text,text,boolean) to service_role;

comment on function public.icetak_admin_undo_manual_payment(uuid,text)
is 'Admin-only idempotent undo for synthetic draft manual payments. Archives before delete and preserves real QRPay rows.';

comment on function public.finance_admin_manual_match_qrpay(text,text,text,boolean)
is 'Links either an unmatched QRPay row or an immutable operational QRPay row with order_id null.';
