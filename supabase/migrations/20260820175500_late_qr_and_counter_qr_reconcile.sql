-- Late/saved QR reconciliation + QR-at-counter settlement.
-- Source of truth for the production changes applied on 2026-08-20.

create or replace function public.icetak_norm_msisdn(p text)
returns text language sql immutable as $$
  select case
    when regexp_replace(coalesce(p,''),'[^0-9]','','g')='' then null
    when regexp_replace(coalesce(p,''),'[^0-9]','','g') like '0%' then '6'||regexp_replace(coalesce(p,''),'[^0-9]','','g')
    when regexp_replace(coalesce(p,''),'[^0-9]','','g') like '1%' then '60'||regexp_replace(coalesce(p,''),'[^0-9]','','g')
    else regexp_replace(coalesce(p,''),'[^0-9]','','g') end
$$;

create or replace function public.icetak_admin_prepare_counter_qr(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path to public,pg_temp as $$
declare o public.orders%rowtype; u text; sid uuid; exp timestamptz; selected numeric; off int; found_slot boolean:=false;
begin
  select username into u from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  if u is null then raise exception 'Unauthorized'; end if;
  if not public.icetak_admin_has_permission('verify_payments') then raise exception 'Forbidden'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if lower(coalesce(o.delivery_method,o.delivery,'')) not like '%pickup%' then raise exception 'Order bukan pickup'; end if;
  if lower(coalesce(o.payment_status,'')) in ('paid','matched','payment_received') or lower(coalesce(o.payment,''))='paid' then raise exception 'Order sudah dibayar'; end if;
  if lower(coalesce(o.payment_status,''))<>'cash_counter' and lower(coalesce(o.payment_method,o.payment,'')) not in ('cash at counter','cash counter','cash','counter','pay at pickup') then raise exception 'Order bukan Bayar Semasa Pickup'; end if;
  if coalesce(o.total,0)<=0 then raise exception 'Invalid order total'; end if;
  perform pg_advisory_xact_lock(hashtextextended('icetak_payment_amount_allocator',0));
  update public.payment_sessions set status='superseded' where order_id=o.id and purpose in ('counter_qr','counter_qr_fallback') and status in ('pending','submitted','receipt_submitted','pending_review');
  for off in 0..50 loop
    selected:=round(o.total-(off::numeric/100),2);
    if selected>0 and not exists(select 1 from public.payment_sessions ps where ps.expected_amount=selected and ps.status in ('pending','submitted','receipt_submitted','pending_review') and ps.expires_at>now()-make_interval(secs=>coalesce(ps.reservation_grace_seconds,120))) then found_slot:=true; exit; end if;
  end loop;
  if not found_slot then raise exception 'Payment amount slots are temporarily full. Please try again in 2 minutes.'; end if;
  exp:=now()+interval '30 minutes';
  insert into public.payment_sessions(order_id,order_token,purpose,base_amount,expected_amount,discount,amount_offset_cents,reservation_grace_seconds,status,expires_at,origin_payment_state)
  values(o.id,o.public_token,'counter_qr',o.total,selected,round(o.total-selected,2),off,120,'pending',exp,jsonb_build_object('payment_status',o.payment_status,'payment',o.payment,'payment_method',o.payment_method,'prepared_by',u,'prepared_at',now())) returning id into sid;
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload) values(o.id::text,coalesce(o.order_no,o.order_id),'prepare_counter_qr',u,jsonb_build_object('payment_session_id',sid,'expected_amount',selected,'base_amount',o.total,'expires_at',exp));
  return jsonb_build_object('ok',true,'payment_session_id',sid,'order_db_id',o.id,'order_id',coalesce(o.order_no,o.order_id),'base_amount',o.total,'expected_amount',selected,'expires_at',exp,'purpose','counter_qr');
end $$;

create or replace function public.icetak_admin_counter_qr_status(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path to public,pg_temp as $$
declare u text; s public.payment_sessions%rowtype; o public.orders%rowtype;
begin
  select username into u from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  if u is null then raise exception 'Unauthorized'; end if;
  if not public.icetak_admin_has_permission('verify_payments') then raise exception 'Forbidden'; end if;
  select * into o from public.orders where id=p_order_id;
  if not found then raise exception 'Order not found'; end if;
  select * into s from public.payment_sessions where order_id=p_order_id and purpose in ('counter_qr','counter_qr_fallback') and status in ('pending','submitted','receipt_submitted','pending_review','matched') order by created_at desc limit 1;
  if not found then return jsonb_build_object('ok',true,'active',false,'order_id',coalesce(o.order_no,o.order_id)); end if;
  return jsonb_build_object('ok',true,'active',s.status<>'matched' and s.expires_at>now()-make_interval(secs=>coalesce(s.reservation_grace_seconds,120)),'matched',s.status='matched','payment_session_id',s.id,'status',s.status,'base_amount',s.base_amount,'expected_amount',s.expected_amount,'expires_at',s.expires_at,'transaction_id',s.transaction_id,'order_id',coalesce(o.order_no,o.order_id));
end $$;

create or replace function public.icetak_preserve_counter_qr_method()
returns trigger language plpgsql set search_path to public,pg_temp as $$
begin
  if lower(coalesce(new.payment_status,''))='paid' and exists(select 1 from public.payment_sessions ps where ps.order_id=new.id and ps.status='matched' and ps.purpose in ('counter_qr','counter_qr_fallback') and (new.payment_transaction_id is null or ps.transaction_id=new.payment_transaction_id)) then new.payment_method:='QR Pay at Counter'; end if;
  return new;
end $$;
drop trigger if exists trg_preserve_counter_qr_method on public.orders;
create trigger trg_preserve_counter_qr_method before update of payment_status,payment_transaction_id,payment_method on public.orders for each row execute function public.icetak_preserve_counter_qr_method();

create or replace function public.icetak_auto_reconcile_unmatched_payment()
returns trigger language plpgsql security definer set search_path to public,pg_temp as $$
declare pphone text:=public.icetak_norm_msisdn(coalesce(new.raw_payload->>'matched_phone',new.raw_payload->>'phone',new.raw_payload->>'customer_phone')); did uuid; oid uuid; cnt int:=0; pcnt int:=0; r jsonb;
begin
  if new.transaction_id is null or new.amount is null or new.amount<=0 then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('late-qr-reconcile:'||new.transaction_id,0));
  if pphone is not null then
    select count(*),(array_agg(d.id order by d.updated_at desc))[1] into pcnt,did from public.qrpay_order_drafts d where d.order_id is null and d.payment_required=true and d.payment_mode not in ('cash_counter','cash_at_counter') and d.status not in ('confirmed','rejected') and abs(d.draft_total-new.amount)<0.01 and d.created_at>now()-interval '30 days' and public.icetak_norm_msisdn(d.customer_phone)=pphone;
  end if;
  if pcnt<>1 then
    select count(*),(array_agg(d.id order by d.updated_at desc))[1] into cnt,did from public.qrpay_order_drafts d where d.order_id is null and d.payment_required=true and d.payment_mode not in ('cash_counter','cash_at_counter') and d.status not in ('confirmed','rejected') and abs(d.draft_total-new.amount)<0.01 and d.created_at>now()-interval '30 days';
    if cnt<>1 then did:=null; end if;
  end if;
  if did is not null then
    begin
      r:=public.icetak_admin_link_payment_to_draft(new.transaction_id,did,'payment-auto-reconcile',coalesce(pphone is null,true));
      if coalesce((r->>'success')::boolean,false) then return new; end if;
    exception when others then null; end;
  end if;
  oid:=null; pcnt:=0; cnt:=0;
  if pphone is not null then
    select count(*),(array_agg(o.id order by coalesce(o.pickup_ready_at,o.updated_at,o.created_at) desc))[1] into pcnt,oid from public.orders o where lower(coalesce(o.delivery_method,o.delivery,'')) like '%pickup%' and lower(coalesce(o.payment_status,''))='cash_counter' and abs(coalesce(o.total,0)-new.amount)<0.01 and o.created_at>now()-interval '30 days' and lower(coalesce(o.status,'')) not like '%cancel%' and public.icetak_norm_msisdn(o.delivery_phone)=pphone;
  end if;
  if pcnt<>1 then
    select count(*),(array_agg(o.id order by coalesce(o.pickup_ready_at,o.updated_at,o.created_at) desc))[1] into cnt,oid from public.orders o where lower(coalesce(o.delivery_method,o.delivery,'')) like '%pickup%' and lower(coalesce(o.payment_status,''))='cash_counter' and abs(coalesce(o.total,0)-new.amount)<0.01 and o.created_at>now()-interval '7 days' and o.pickup_ready_at is not null and lower(coalesce(o.status,'')) not like '%cancel%';
    if cnt<>1 then oid:=null; end if;
  end if;
  if oid is not null then
    begin
      select public.finance_admin_manual_match_qrpay(new.transaction_id,coalesce(o.order_no,o.order_id),'payment-auto-reconcile',true) into r from public.orders o where o.id=oid;
      if coalesce((r->>'success')::boolean,false) then update public.orders set payment_method='QR Pay at Counter',updated_at=now() where id=oid; return new; end if;
    exception when others then null; end;
  end if;
  return new;
end $$;

drop trigger if exists trg_auto_reconcile_unmatched_payment on public.unmatched_payment_transactions;
drop trigger if exists zz_auto_reconcile_unmatched_payment on public.unmatched_payment_transactions;
-- Name deliberately sorts after unmatched_payment_queue_qrpay_ai so the FK-backed AI job is queued before an auto-match may delete the unmatched row.
create trigger zz_auto_reconcile_unmatched_payment after insert on public.unmatched_payment_transactions for each row execute function public.icetak_auto_reconcile_unmatched_payment();

-- Cash-counter pickup may become Ready before settlement; collection still requires payment.
create or replace function public.icetak_admin_order_action(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to public as $$
declare order_value public.orders%rowtype; action_value text:=lower(coalesce(p_payload->>'action','')); order_uuid uuid; order_number text:=nullif(trim(coalesce(p_payload->>'order_id',p_payload->>'order_no','')),''); username_value text; payment_value text; delivery_value text; transaction_value text; outbox_value uuid;
begin
  begin order_uuid:=nullif(p_payload->>'order_db_id','')::uuid; exception when invalid_text_representation then order_uuid:=null; end;
  if order_uuid is null and order_number is not null then select id into order_uuid from public.orders where order_id=order_number or order_no=order_number order by created_at desc limit 1; end if;
  if order_uuid is null then raise exception 'order_db_id or order_id required'; end if;
  select * into order_value from public.orders where id=order_uuid for update; if order_value.id is null then raise exception 'Order not found'; end if;
  select username into username_value from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1; if username_value is null then raise exception 'Unauthorized'; end if;
  delivery_value:=lower(coalesce(order_value.delivery_method,order_value.delivery,'')); payment_value:=lower(coalesce(order_value.payment_status,order_value.payment,''));
  if action_value='set_pay_at_pickup' then
    if not public.icetak_admin_has_permission('edit_order') and not public.icetak_admin_has_permission('verify_payments') then raise exception 'Forbidden'; end if; if delivery_value not like '%pickup%' then raise exception 'Order bukan pickup'; end if; if payment_value in ('paid','matched','payment_received') or lower(coalesce(order_value.payment,''))='paid' then raise exception 'Order sudah dibayar'; end if;
    update public.payment_sessions set status=case when status in ('pending','submitted','receipt_submitted','pending_review') then 'superseded' else status end where order_id=order_uuid;
    update public.orders set payment='Cash at Counter',payment_status='cash_counter',payment_method='Cash at Counter',status=case when coalesce(customer_confirmed,false) then 'Ready to Process' else 'Waiting Customer Confirmation' end,admin_status=case when coalesce(customer_confirmed,false) then 'Ready to Process' else 'Awaiting Customer Confirmation' end,tab='progress',updated_at=now() where id=order_uuid; outbox_value:=public.enqueue_clickup_production_order(order_uuid);
  elsif action_value='confirm_cash_paid' then
    if not public.icetak_admin_has_permission('verify_payments') then raise exception 'Forbidden'; end if; if delivery_value not like '%pickup%' then raise exception 'Order bukan pickup'; end if; if lower(coalesce(order_value.payment_method,order_value.payment,'')) not in ('cash at counter','cash counter','cash','counter','pay at pickup') and lower(coalesce(order_value.payment_status,''))<>'cash_counter' then raise exception 'Order bukan Bayar Semasa Pickup'; end if;
    if payment_value in ('paid','matched','payment_received') or lower(coalesce(order_value.payment,''))='paid' then return jsonb_build_object('ok',true,'already_paid',true,'action',action_value,'order_db_id',order_uuid,'order_id',coalesce(order_value.order_id,order_value.order_no)); end if;
    transaction_value:=coalesce(nullif(order_value.payment_transaction_id,''),'cash_counter:'||coalesce(order_value.order_no,order_value.order_id,order_uuid::text)); update public.payment_sessions set status=case when status in ('pending','submitted','receipt_submitted','pending_review') then 'superseded' else status end where order_id=order_uuid;
    insert into public.payment_transactions(order_id,payment_session_id,provider,transaction_id,amount,paid_at,sender_name,raw_payload) values(order_uuid,null,'cash_counter',transaction_value,coalesce(order_value.total,0),now(),coalesce(order_value.delivery_name,'Customer'),jsonb_build_object('source','admin_cash_counter','verified_by',username_value,'order_no',coalesce(order_value.order_no,order_value.order_id))) on conflict(transaction_id) do nothing;
    update public.orders set payment='Paid',payment_status='paid',payment_method='Cash at Counter',payment_transaction_id=transaction_value,payment_verified_at=coalesce(payment_verified_at,now()),payment_verified_by=username_value,status=case when lower(coalesce(fulfillment_stage,'')) in ('ready_for_pickup','collected','completed') or lower(coalesce(status,'')) like '%ready%pickup%' or lower(coalesce(status,'')) in ('completed','customer collected') then status else 'Payment Received' end,admin_status=case when pickup_collected_at is not null then 'Customer Collected' when pickup_ready_at is not null or lower(coalesce(status,'')) like '%ready%pickup%' then 'Ready for Pickup' else 'Ready to Process' end,tab=case when pickup_collected_at is not null then 'completed' when pickup_ready_at is not null or lower(coalesce(status,'')) like '%ready%pickup%' then 'receive' else 'progress' end,updated_at=now() where id=order_uuid; outbox_value:=public.enqueue_clickup_production_order(order_uuid);
  elsif action_value='approve_production' then
    if not public.icetak_admin_has_permission('approve_production') then raise exception 'Forbidden'; end if; if order_value.customer_confirm_token is not null and coalesce(order_value.customer_confirmed,false)=false then raise exception 'Customer belum confirm order'; end if; payment_value:=lower(coalesce(order_value.payment,order_value.payment_status,'')); if (payment_value like '%unpaid%' or payment_value like '%pending%' or payment_value like '%to_pay%') and payment_value not like '%cash%' then raise exception 'Payment belum diterima'; end if;
    update public.orders set production_approved=true,admin_status='Ready to Process',status='Production Started',tab='progress',fulfillment_stage='production',updated_at=now() where id=order_uuid;
  elsif action_value='ready_pickup' then
    if not public.icetak_admin_has_permission('approve_production') then raise exception 'Forbidden'; end if; if delivery_value not like '%pickup%' then raise exception 'Order bukan pickup'; end if; payment_value:=lower(coalesce(order_value.payment_status,order_value.payment,'')); if payment_value not similar to '%(paid|matched|payment_received|cash_counter)%' then raise exception 'Payment belum diterima / order bukan cash counter'; end if;
    update public.orders set production_completed_at=coalesce(production_completed_at,now()),pickup_ready_at=coalesce(pickup_ready_at,now()),pickup_collected_at=null,fulfillment_stage='ready_for_pickup',admin_status='Ready for Pickup',status='Ready for Pickup',tab='receive',updated_at=now() where id=order_uuid;
  elsif action_value in ('pickup_collected','customer_collected') then
    if not public.icetak_admin_has_permission('approve_production') then raise exception 'Forbidden'; end if; if delivery_value not like '%pickup%' then raise exception 'Order bukan pickup'; end if; if order_value.pickup_ready_at is null and lower(coalesce(order_value.status,'')) not like '%ready%pickup%' then raise exception 'Order belum Ready for Pickup'; end if; payment_value:=lower(coalesce(order_value.payment_status,order_value.payment,'')); if payment_value not similar to '%(paid|matched|payment_received)%' then raise exception 'Payment belum diterima'; end if;
    update public.orders set pickup_collected_at=coalesce(pickup_collected_at,now()),fulfillment_stage='collected',admin_status='Customer Collected',status='Completed',tab='completed',updated_at=now() where id=order_uuid;
  elsif action_value='cancel' then
    if not public.icetak_admin_has_permission('cancel_order') then raise exception 'Forbidden'; end if; update public.orders set status='Cancelled',admin_status='Cancelled',fulfillment_stage='cancelled',tab='completed',updated_at=now() where id=order_uuid;
  else raise exception 'Unsupported action'; end if;
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload) values(order_uuid::text,coalesce(order_value.order_id,order_value.order_no),action_value,username_value,jsonb_build_object('outbox_id',outbox_value,'payment_transaction_id',transaction_value));
  return jsonb_build_object('ok',true,'action',action_value,'order_db_id',order_uuid,'order_id',coalesce(order_value.order_id,order_value.order_no),'outbox_id',outbox_value,'payment_transaction_id',transaction_value);
end $$;
