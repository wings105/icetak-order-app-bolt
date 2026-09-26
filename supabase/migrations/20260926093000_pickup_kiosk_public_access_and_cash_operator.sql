begin;

create table if not exists public.pickup_kiosk_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  key_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.pickup_kiosk_keys enable row level security;
revoke all on table public.pickup_kiosk_keys from public, anon, authenticated;
grant select, update on table public.pickup_kiosk_keys to service_role;

create or replace function public.icetak_admin_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    coalesce(auth.jwt()->>'role','')='service_role'
    or exists (
      select 1
      from public.admin_users u
      left join public.admin_permissions p on p.username=u.username
      where u.auth_user_id=auth.uid()
        and u.is_active=true
        and p_permission=any(coalesce(p.permissions,'{}'::text[]))
    );
$function$;

create or replace function public.icetak_admin_confirm_pickup_receipt(
  p_checkout_id uuid,
  p_transaction_reference text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_checkout public.pickup_checkouts%rowtype;
  v_session public.payment_sessions%rowtype;
  v_actor text;
  v_reference text:=btrim(coalesce(p_transaction_reference,''));
  v_result jsonb;
begin
  if not public.icetak_admin_has_permission('verify_payments') then raise exception 'Forbidden'; end if;
  select username into v_actor from public.admin_users
  where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_actor is null and coalesce(auth.jwt()->>'role','')='service_role' then v_actor:='pickup_kiosk'; end if;
  if v_actor is null then raise exception 'Forbidden'; end if;
  if length(v_reference)<4 or length(v_reference)>120 then raise exception 'valid_transaction_reference_required'; end if;

  select * into v_checkout from public.pickup_checkouts where id=p_checkout_id for update;
  if not found then raise exception 'pickup_checkout_not_found'; end if;
  if v_checkout.status<>'awaiting_payment' or v_checkout.payment_method<>'qrpay' then raise exception 'pickup_checkout_not_payable'; end if;
  select * into v_session from public.payment_sessions where id=v_checkout.payment_session_id for update;
  if not found or coalesce(v_session.receipt_path,'')='' or lower(coalesce(v_session.status,'')) not in
    ('submitted','receipt_submitted','pending_review') then raise exception 'pickup_receipt_not_submitted'; end if;

  v_result:=public.icetak_finalize_pickup_checkout(
    v_checkout.id,v_reference,v_checkout.total_amount,'qrpay',null,v_actor,
    jsonb_build_object(
      'source','pickup_receipt_manual_review','receipt_bucket',v_session.receipt_bucket,
      'receipt_path',v_session.receipt_path,'receipt_name',v_session.receipt_name,
      'verified_by',v_actor,'review_note',left(coalesce(p_note,''),500),'paid_at',now()
    )
  );

  update public.pickup_checkouts
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('receipt_verified_by',v_actor,'receipt_verified_at',now())
  where id=v_checkout.id;

  return v_result||jsonb_build_object('reviewedBy',v_actor,'receiptName',v_session.receipt_name);
end;
$function$;

create or replace function public.icetak_admin_create_pickup_checkout_attributed(
  p_customer_master_id uuid,
  p_order_ids uuid[],
  p_method text,
  p_source text default 'counter',
  p_handled_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor text;
  v_staff text:=lower(btrim(coalesce(p_handled_by,'')));
  v_result jsonb;
begin
  if not public.icetak_admin_has_permission('verify_payments') then raise exception 'Forbidden: verify_payments'; end if;

  if lower(coalesce(p_method,''))='cash' then
    if v_staff not in ('nurul','imah','aisy','fadlin','owner') then raise exception 'handled_by_required'; end if;
    v_actor:=v_staff;
  else
    select u.username into v_actor from public.admin_users u
    where u.auth_user_id=auth.uid() and u.is_active limit 1;
    v_actor:=coalesce(v_actor,case when coalesce(auth.jwt()->>'role','')='service_role' then 'pickup_kiosk' else 'admin' end);
  end if;

  v_result:=public.icetak_create_pickup_checkout_internal(
    p_customer_master_id,p_order_ids,lower(p_method),p_source,v_actor
  );

  if lower(coalesce(p_method,''))='cash' then
    insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
    select
      o.id::text,coalesce(o.order_no,o.order_id),'pickup_cash_confirm_operator',v_actor,
      jsonb_build_object(
        'handled_by',v_actor,'source',coalesce(nullif(p_source,''),'counter'),
        'checkout_id',v_result->>'checkoutId','checkout_no',v_result->>'checkoutNo','amount',v_result->>'amount'
      )
    from public.orders o where o.id=any(p_order_ids);
  end if;

  return v_result||jsonb_build_object('handledBy',v_actor);
end;
$function$;

revoke all on function public.icetak_admin_create_pickup_checkout_attributed(uuid,uuid[],text,text,text) from public,anon;
grant execute on function public.icetak_admin_create_pickup_checkout_attributed(uuid,uuid[],text,text,text) to authenticated,service_role;

commit;
