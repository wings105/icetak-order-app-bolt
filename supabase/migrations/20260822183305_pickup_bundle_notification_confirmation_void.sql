-- Pickup bundle payment safety:
-- 1) collapse payment notifications into one bundle message;
-- 2) require explicit cash confirmation in the UI (the RPC itself remains the
--    final payment boundary);
-- 3) provide an auditable void/reversal path for an accidental payment.

alter table public.pickup_checkouts
  drop constraint if exists pickup_checkouts_status_check;
alter table public.pickup_checkouts
  add constraint pickup_checkouts_status_check
  check (status in ('awaiting_payment','paid','expired','cancelled','voided'));

alter table public.pickup_checkout_orders
  drop constraint if exists pickup_checkout_orders_status_check;
alter table public.pickup_checkout_orders
  add constraint pickup_checkout_orders_status_check
  check (status in ('reserved','allocated','released','voided'));

create table if not exists public.pickup_checkout_voids (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null unique references public.pickup_checkouts(id) on delete restrict,
  finance_transaction_id bigint,
  transaction_id text,
  amount numeric not null,
  reason text not null,
  voided_by text not null,
  voided_at timestamptz not null default now(),
  checkout_snapshot jsonb not null default '{}'::jsonb,
  order_snapshot jsonb not null default '[]'::jsonb,
  finance_snapshot jsonb not null default '{}'::jsonb
);

create index if not exists pickup_checkout_voids_voided_at_idx
  on public.pickup_checkout_voids(voided_at desc);

alter table public.pickup_checkout_voids enable row level security;
revoke all on table public.pickup_checkout_voids from public,anon,authenticated;
grant select,insert on table public.pickup_checkout_voids to service_role;

-- Bundle payment changes set payment_method to a bundle-specific value. The
-- existing per-order trigger must not send one message per order in that case.
create or replace function public.icetak_orders_whatsapp_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  old_paid boolean;
  new_paid boolean;
  old_cancel boolean;
  new_cancel boolean;
  old_ready_pickup boolean;
  new_ready_pickup boolean;
  old_status_text text;
  new_status_text text;
begin
  if tg_op='INSERT' then return new; end if;

  old_paid:=public.icetak_payment_state_is_paid(old.payment_status,old.payment);
  new_paid:=public.icetak_payment_state_is_paid(new.payment_status,new.payment);
  if not old_paid and new_paid
     and lower(coalesce(new.payment_method,'')) not like '%pickup bundle%' then
    perform public.icetak_enqueue_whatsapp_event('payment_received',new.id,'{}'::jsonb,null,now());
  end if;

  if coalesce(old.production_approved,false)=false
     and coalesce(new.production_approved,false)=true then
    perform public.icetak_enqueue_whatsapp_event('production_started',new.id,'{}'::jsonb,null,now());
  end if;

  old_cancel:=lower(concat_ws(' ',old.status,old.admin_status,old.fulfillment_stage)) like '%cancel%';
  new_cancel:=lower(concat_ws(' ',new.status,new.admin_status,new.fulfillment_stage)) like '%cancel%';
  if not old_cancel and new_cancel then
    perform public.icetak_enqueue_whatsapp_event('order_cancelled',new.id,'{}'::jsonb,null,now());
  end if;

  old_status_text:=lower(trim(coalesce(old.status,'')));
  new_status_text:=lower(trim(coalesce(new.status,'')));
  old_ready_pickup:=old_status_text in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup')
    or lower(trim(coalesce(old.admin_status,''))) in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup');
  new_ready_pickup:=new_status_text in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup')
    or lower(trim(coalesce(new.admin_status,''))) in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup');

  if not old_ready_pickup and new_ready_pickup
     and lower(coalesce(new.delivery_method,new.delivery,'')) like '%pickup%' then
    perform public.icetak_enqueue_auto_pickup_ready(new.id,new.pickup_ready_at);
  end if;
  return new;
end;
$function$;

drop trigger if exists icetak_orders_whatsapp_trg on public.orders;
create trigger icetak_orders_whatsapp_trg
after insert or update on public.orders
for each row execute function public.icetak_orders_whatsapp_trigger();

create or replace function public.icetak_pickup_bundle_paid_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_first_order uuid;
  v_order_ids text;
  v_count integer;
  v_extra jsonb;
  v_queue_id uuid;
begin
  if old.status='paid' or new.status<>'paid' then return new; end if;

  select count(*)::integer,
         string_agg(coalesce(o.order_no,o.order_id),', ' order by o.order_no,o.order_id),
         (array_agg(o.id order by case when o.whatsapp_opt_in then 0 else 1 end,o.order_no,o.order_id))[1]
  into v_count,v_order_ids,v_first_order
  from public.pickup_checkout_orders po
  join public.orders o on o.id=po.order_id
  where po.checkout_id=new.id;
  if v_first_order is null then return new; end if;

  v_extra:=jsonb_build_object(
    'order_id',v_order_ids,
    'order_total','RM'||to_char(new.total_amount,'FM999999990.00'),
    'pickup_order_count',v_count,
    'pickup_checkout_no',new.checkout_no,
    'payment_method',case when new.payment_method='cash' then 'cash' else 'QRPay' end
  );
  v_queue_id:=public.icetak_enqueue_whatsapp_event(
    'payment_received',v_first_order,'{}'::jsonb,
    'pickup_bundle:'||new.id::text,now()
  );
  if v_queue_id is not null then
    update public.notification_queue
    set payload=coalesce(payload,'{}'::jsonb)
      ||jsonb_build_object('vars',coalesce(payload->'vars','{}'::jsonb)||v_extra)
    where id=v_queue_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists icetak_pickup_bundle_paid_notification_trg on public.pickup_checkouts;
create trigger icetak_pickup_bundle_paid_notification_trg
after update of status on public.pickup_checkouts
for each row execute function public.icetak_pickup_bundle_paid_notification();

create or replace function public.icetak_admin_void_pickup_payment(
  p_checkout_id uuid,
  p_reason text default 'Pickup payment recorded by mistake'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor text;
  v_checkout public.pickup_checkouts%rowtype;
  v_void public.pickup_checkout_voids%rowtype;
  v_finance finance.transactions%rowtype;
  v_journal finance.journal_entries%rowtype;
  v_reversal_id bigint;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_orders jsonb;
  v_order_count integer;
begin
  if not (coalesce(auth.jwt()->>'role','')='service_role' or public.icetak_admin_has_permission('verify_payments')) then
    raise exception 'Forbidden: verify_payments';
  end if;
  select username into v_actor from public.admin_users
  where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_actor is null and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Unauthorized'; end if;
  v_actor:=coalesce(v_actor,'service_role');
  if p_checkout_id is null then raise exception 'Checkout ID is required'; end if;
  if v_reason is null then raise exception 'Void reason is required'; end if;
  if length(v_reason)>500 then raise exception 'Void reason is too long'; end if;

  perform pg_advisory_xact_lock(hashtextextended('void-pickup-checkout:'||p_checkout_id::text,0));
  select * into v_checkout from public.pickup_checkouts where id=p_checkout_id for update;
  if not found then raise exception 'Pickup checkout was not found'; end if;
  if v_checkout.status='voided' then
    select * into v_void from public.pickup_checkout_voids where checkout_id=p_checkout_id;
    return jsonb_build_object('ok',true,'duplicate',true,'checkoutId',p_checkout_id,'voidedAt',v_void.voided_at,'reason',v_void.reason);
  end if;
  if v_checkout.status<>'paid' then raise exception 'Only a received payment can be voided'; end if;
  if exists(select 1 from public.pickup_handover_orders ho join public.pickup_handovers h on h.id=ho.handover_id where h.checkout_id=p_checkout_id) then
    raise exception 'Payment cannot be voided after handover';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'orderId',o.id,'orderNo',coalesce(o.order_no,o.order_id),
    'paymentStatus',o.payment_status,'payment',o.payment,
    'paymentMethod',o.payment_method,'paymentTransactionId',o.payment_transaction_id,
    'paymentVerifiedAt',o.payment_verified_at,'paymentVerifiedBy',o.payment_verified_by
  ) order by o.order_no,o.order_id),'[]'::jsonb),count(*)::integer
  into v_orders,v_order_count
  from public.pickup_checkout_orders po join public.orders o on o.id=po.order_id
  where po.checkout_id=p_checkout_id;

  if v_checkout.finance_transaction_id is not null then
    select * into v_finance from finance.transactions where id=v_checkout.finance_transaction_id for update;
    if v_finance.id is not null then
      select * into v_journal from finance.journal_entries where transaction_id=v_finance.id and status='posted' order by id desc limit 1 for update;
      if v_journal.id is not null then
        insert into finance.journal_entries(transaction_id,entry_date,description,status,source_type,source_reference,posted_at,posted_by,reversed_entry_id)
        values(null,(now() at time zone 'Asia/Kuala_Lumpur')::date,'Void pickup payment '||v_checkout.checkout_no,'posted','pickup_void','void:'||v_checkout.id::text,now(),v_actor,v_journal.id)
        returning id into v_reversal_id;
        insert into finance.journal_lines(journal_entry_id,account_id,debit,credit,memo)
        select v_reversal_id,l.account_id,l.credit,l.debit,'Void pickup payment: '||coalesce(l.memo,'') from finance.journal_lines l where l.journal_entry_id=v_journal.id;
        update finance.journal_entries set status='reversed',transaction_id=null where id=v_journal.id;
      end if;
      update finance.payment_allocations set status='reversed',reversed_at=now()
      where transaction_id=v_finance.id and status='allocated';
      update finance.transactions set status='void',reconciliation_status='ignored',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('voided',true,'void_reason',v_reason,'voided_by',v_actor,'voided_at',now(),'reversal_journal_entry_id',v_reversal_id),updated_at=now() where id=v_finance.id;
    end if;
  end if;

  insert into public.pickup_checkout_voids(checkout_id,finance_transaction_id,transaction_id,amount,reason,voided_by,checkout_snapshot,order_snapshot,finance_snapshot)
  values(p_checkout_id,v_checkout.finance_transaction_id,v_checkout.transaction_id,v_checkout.total_amount,v_reason,v_actor,to_jsonb(v_checkout),v_orders,coalesce(to_jsonb(v_finance),'{}'::jsonb))
  on conflict(checkout_id) do nothing;

  update public.payment_transactions set raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object('voided',true,'void_reason',v_reason,'voided_by',v_actor,'voided_at',now()) where payment_session_id=v_checkout.payment_session_id;
  update public.payment_sessions set status='voided' where id=v_checkout.payment_session_id;
  update public.orders o
  set payment_status='pending',
      payment='Unpaid',
      payment_method=null,
      payment_transaction_id=null,
      payment_verified_at=null,
      payment_verified_by=null,
      updated_at=now()
  where o.id in (select po.order_id from public.pickup_checkout_orders po where po.checkout_id=p_checkout_id);
  update public.pickup_checkout_orders set status='voided',active_reservation=false where checkout_id=p_checkout_id;
  update public.pickup_checkouts set status='voided',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('voided',true,'void_reason',v_reason,'voided_by',v_actor,'voided_at',now()),updated_at=now() where id=p_checkout_id;
  update public.notification_queue set status='skipped',processed_at=now(),decision_reason='pickup_bundle_voided'
  where event_type='payment_received' and status in ('pending','processing') and payload->'vars'->>'pickup_checkout_no'=v_checkout.checkout_no;

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  select o.id::text,coalesce(o.order_no,o.order_id),'pickup_bundle_void',v_actor,jsonb_build_object('checkout_id',p_checkout_id,'checkout_no',v_checkout.checkout_no,'reason',v_reason,'amount',v_checkout.total_amount)
  from public.orders o join public.pickup_checkout_orders po on po.order_id=o.id where po.checkout_id=p_checkout_id;
  return jsonb_build_object('ok',true,'duplicate',false,'checkoutId',p_checkout_id,'checkoutNo',v_checkout.checkout_no,'amount',v_checkout.total_amount,'orderCount',v_order_count,'voidedBy',v_actor,'reason',v_reason);
end;
$$;

revoke execute on function public.icetak_admin_void_pickup_payment(uuid,text) from public,anon;
grant execute on function public.icetak_admin_void_pickup_payment(uuid,text) to authenticated,service_role;
