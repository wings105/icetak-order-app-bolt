-- Private receipt fallback for delayed bulk QRPay reconciliation.
-- Uploading proof never marks an order paid; only a verified admin or the
-- existing bank webhook can finalize the complete checkout atomically.

create or replace function public.icetak_customer_submit_pickup_receipt(
  p_token text,
  p_checkout_id uuid,
  p_receipt_bucket text,
  p_receipt_path text,
  p_receipt_name text,
  p_receipt_mime text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_master uuid;
  v_checkout public.pickup_checkouts%rowtype;
  v_session public.payment_sessions%rowtype;
  v_expires timestamptz;
begin
  v_master:=public.icetak_pickup_master_from_token(p_token);
  if v_master is null then raise exception 'invalid_or_expired_pickup_link'; end if;

  select * into v_checkout from public.pickup_checkouts
  where id=p_checkout_id and customer_master_id=v_master
  for update;
  if not found then raise exception 'pickup_checkout_not_found'; end if;
  if v_checkout.status<>'awaiting_payment' or v_checkout.payment_method<>'qrpay' then
    raise exception 'pickup_checkout_not_payable';
  end if;
  if v_checkout.expires_at is not null and v_checkout.expires_at<now() then
    raise exception 'pickup_checkout_expired';
  end if;
  if p_receipt_bucket<>'icetak-receipts'
    or left(coalesce(p_receipt_path,''),length('pickup/'||v_checkout.id::text||'/'))
      <>'pickup/'||v_checkout.id::text||'/' then
    raise exception 'invalid_receipt_path';
  end if;
  if p_receipt_mime not in ('image/jpeg','image/png','application/pdf') then
    raise exception 'invalid_receipt_type';
  end if;

  select * into v_session from public.payment_sessions
  where id=v_checkout.payment_session_id
  for update;
  if not found or v_session.purpose<>'pickup_bundle' then
    raise exception 'pickup_payment_session_not_found';
  end if;
  if lower(coalesce(v_session.status,'')) not in
    ('pending','submitted','receipt_submitted','pending_review') then
    raise exception 'pickup_payment_session_not_payable';
  end if;

  v_expires:=greatest(coalesce(v_checkout.expires_at,now()),now()+interval '2 hours');
  update public.payment_sessions
  set receipt_bucket=p_receipt_bucket,
      receipt_path=p_receipt_path,
      receipt_name=left(coalesce(p_receipt_name,'receipt'),160),
      receipt_mime=p_receipt_mime,
      submitted_at=now(),
      status='receipt_submitted',
      expires_at=v_expires
  where id=v_session.id;

  update public.pickup_checkouts
  set expires_at=v_expires,
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)
        ||jsonb_build_object('receipt_submitted_at',now(),'receipt_name',p_receipt_name)
  where id=v_checkout.id;

  return jsonb_build_object(
    'ok',true,'checkoutId',v_checkout.id,'checkoutNo',v_checkout.checkout_no,
    'amount',v_checkout.total_amount,'status','awaiting_payment','paid',false,
    'receiptSubmitted',true,'receiptName',p_receipt_name,
    'receiptMime',p_receipt_mime,'receiptSubmittedAt',now(),'expiresAt',v_expires
  );
end;
$$;

create or replace function public.icetak_pickup_checkout_status(
  p_token text,
  p_checkout_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_master uuid;
  v_checkout public.pickup_checkouts%rowtype;
  v_session public.payment_sessions%rowtype;
begin
  v_master:=public.icetak_pickup_master_from_token(p_token);
  if v_master is null then raise exception 'invalid_or_expired_pickup_link'; end if;
  select * into v_checkout from public.pickup_checkouts
  where id=p_checkout_id and customer_master_id=v_master;
  if not found then raise exception 'pickup_checkout_not_found'; end if;
  select * into v_session from public.payment_sessions where id=v_checkout.payment_session_id;

  return jsonb_build_object(
    'ok',true,'checkoutId',v_checkout.id,'checkoutNo',v_checkout.checkout_no,
    'status',v_checkout.status,'paid',v_checkout.status='paid',
    'amount',v_checkout.total_amount,'transactionId',v_checkout.transaction_id,
    'expiresAt',v_checkout.expires_at,'paidAt',v_checkout.paid_at,
    'receiptSubmitted',coalesce(v_session.receipt_path,'')<>''
      and lower(coalesce(v_session.status,'')) in ('submitted','receipt_submitted','pending_review'),
    'receiptName',v_session.receipt_name,
    'receiptMime',v_session.receipt_mime,
    'receiptSubmittedAt',v_session.submitted_at
  );
end;
$$;

create or replace function public.icetak_admin_pickup_checkout_status(p_checkout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_checkout public.pickup_checkouts%rowtype;
  v_session public.payment_sessions%rowtype;
begin
  if not (
    public.icetak_admin_has_permission('verify_payments')
    or public.icetak_admin_has_permission('view_finance')
  ) then raise exception 'Forbidden'; end if;
  select * into v_checkout from public.pickup_checkouts where id=p_checkout_id;
  if not found then raise exception 'pickup_checkout_not_found'; end if;
  select * into v_session from public.payment_sessions where id=v_checkout.payment_session_id;

  return jsonb_build_object(
    'ok',true,'checkoutId',v_checkout.id,'checkoutNo',v_checkout.checkout_no,
    'status',v_checkout.status,'paid',v_checkout.status='paid',
    'amount',v_checkout.total_amount,'transactionId',v_checkout.transaction_id,
    'expiresAt',v_checkout.expires_at,'paidAt',v_checkout.paid_at,
    'paymentMethod',v_checkout.payment_method,
    'paymentSessionId',v_checkout.payment_session_id,
    'receiptSubmitted',coalesce(v_session.receipt_path,'')<>''
      and lower(coalesce(v_session.status,'')) in ('submitted','receipt_submitted','pending_review'),
    'receiptName',v_session.receipt_name,
    'receiptMime',v_session.receipt_mime,
    'receiptSubmittedAt',v_session.submitted_at,
    'orderIds',coalesce((
      select jsonb_agg(po.order_id order by po.order_id)
      from public.pickup_checkout_orders po where po.checkout_id=v_checkout.id
    ),'[]'::jsonb)
  );
end;
$$;

-- Preserve the existing lookup contract and make customer-uploaded proof
-- discoverable when counter staff open the customer after a page refresh.
create or replace function public.icetak_admin_pickup_latest_paid_checkout(p_customer_master_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_checkout public.pickup_checkouts%rowtype;
  v_session public.payment_sessions%rowtype;
begin
  if not (
    public.icetak_admin_has_permission('view_customers')
    or public.icetak_admin_has_permission('verify_payments')
  ) then raise exception 'Forbidden'; end if;

  select pc.* into v_checkout
  from public.pickup_checkouts pc
  left join public.payment_sessions ps on ps.id=pc.payment_session_id
  where pc.customer_master_id=p_customer_master_id
    and (
      (
        pc.status='awaiting_payment'
        and pc.payment_method='qrpay'
        and ps.status in ('submitted','receipt_submitted','pending_review')
        and coalesce(ps.receipt_path,'')<>''
        and coalesce(pc.expires_at,now()+interval '1 second')>now()
      )
      or (
        pc.status='paid'
        and not exists (
          select 1 from public.pickup_handovers h where h.checkout_id=pc.id
        )
      )
    )
  order by (pc.status='awaiting_payment') desc,
    pc.paid_at desc nulls last,pc.updated_at desc
  limit 1;

  if not found then return jsonb_build_object('ok',true,'checkout',null); end if;
  select * into v_session from public.payment_sessions where id=v_checkout.payment_session_id;

  return jsonb_build_object(
    'ok',true,
    'checkout',jsonb_build_object(
      'ok',true,'paid',v_checkout.status='paid','checkoutId',v_checkout.id,
      'checkoutNo',v_checkout.checkout_no,'amount',v_checkout.total_amount,
      'transactionId',v_checkout.transaction_id,'paidAt',v_checkout.paid_at,
      'paymentMethod',v_checkout.payment_method,'status',v_checkout.status,
      'expiresAt',v_checkout.expires_at,'paymentSessionId',v_checkout.payment_session_id,
      'receiptSubmitted',v_checkout.status='awaiting_payment'
        and coalesce(v_session.receipt_path,'')<>'',
      'receiptName',v_session.receipt_name,'receiptMime',v_session.receipt_mime,
      'receiptSubmittedAt',v_session.submitted_at,
      'orderIds',coalesce((
        select jsonb_agg(po.order_id order by po.order_id)
        from public.pickup_checkout_orders po where po.checkout_id=v_checkout.id
      ),'[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.icetak_admin_confirm_pickup_receipt(
  p_checkout_id uuid,
  p_transaction_reference text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_checkout public.pickup_checkouts%rowtype;
  v_session public.payment_sessions%rowtype;
  v_actor text;
  v_reference text:=btrim(coalesce(p_transaction_reference,''));
  v_result jsonb;
begin
  if not public.icetak_admin_has_permission('verify_payments') then
    raise exception 'Forbidden';
  end if;
  select username into v_actor from public.admin_users
  where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_actor is null then raise exception 'Forbidden'; end if;
  if length(v_reference)<4 or length(v_reference)>120 then
    raise exception 'valid_transaction_reference_required';
  end if;

  select * into v_checkout from public.pickup_checkouts
  where id=p_checkout_id for update;
  if not found then raise exception 'pickup_checkout_not_found'; end if;
  if v_checkout.status<>'awaiting_payment' or v_checkout.payment_method<>'qrpay' then
    raise exception 'pickup_checkout_not_payable';
  end if;
  select * into v_session from public.payment_sessions
  where id=v_checkout.payment_session_id for update;
  if not found or coalesce(v_session.receipt_path,'')=''
    or lower(coalesce(v_session.status,'')) not in
      ('submitted','receipt_submitted','pending_review') then
    raise exception 'pickup_receipt_not_submitted';
  end if;

  v_result:=public.icetak_finalize_pickup_checkout(
    v_checkout.id,v_reference,v_checkout.total_amount,'qrpay',
    null,v_actor,
    jsonb_build_object(
      'source','pickup_receipt_manual_review',
      'receipt_bucket',v_session.receipt_bucket,
      'receipt_path',v_session.receipt_path,
      'receipt_name',v_session.receipt_name,
      'verified_by',v_actor,
      'review_note',left(coalesce(p_note,''),500),
      'paid_at',now()
    )
  );

  update public.pickup_checkouts
  set metadata=coalesce(metadata,'{}'::jsonb)
    ||jsonb_build_object('receipt_verified_by',v_actor,'receipt_verified_at',now())
  where id=v_checkout.id;

  return v_result||jsonb_build_object('reviewedBy',v_actor,'receiptName',v_session.receipt_name);
end;
$$;

revoke execute on function public.icetak_customer_submit_pickup_receipt(text,uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.icetak_customer_submit_pickup_receipt(text,uuid,text,text,text,text)
  to service_role;

revoke execute on function public.icetak_admin_confirm_pickup_receipt(uuid,text,text)
  from public,anon;
grant execute on function public.icetak_admin_confirm_pickup_receipt(uuid,text,text)
  to authenticated,service_role;

