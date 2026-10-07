BEGIN;
-- Actual draft -> order conversion and notification choice, with no committed fixtures.
do $test$
declare
  p jsonb;
  d jsonb;
  a jsonb;
  c jsonb;
  did uuid;
  oid uuid;
  enabled boolean;
  opt boolean;
  flags jsonb;
  n integer;
  audits integer;
  q uuid;
  i integer;
  key text:='qa:cash-notification:'||gen_random_uuid()::text;
begin
  for i in 1..2 loop
    enabled:=i=2;
    p:=jsonb_build_object(
      'customer',jsonb_build_object('name','QA cash notification rollback','phone','60100000002'),
      'items',jsonb_build_array(jsonb_build_object('k','acrylic','title','Acrylic Cake Topper','qty',1,'price',20,'size','A6 Standard','style','Gold','process','Pre-order','review','No Review','customText','QA')),
      'price_adjustments',jsonb_build_object('custom_addon',9876+i,'custom_addon_reason','rollback fixture unique amount'),
      'date_need',(now() at time zone 'Asia/Kuala_Lumpur')::date+2,'delivery','pickup',
      'notify_whatsapp',not enabled
    );
    d:=public.icetak_create_generic_order_draft('admin_manual',null,'60100000002','QA cash notification rollback',p,key||i,now(),null,'cash_counter','qa-rollback');
    did:=(d->>'id')::uuid;
    -- Match the Edge handler's explicit action policy, overriding the inherited choice.
    p:=(d->'working_draft')||jsonb_build_object('notify_whatsapp',enabled);
    a:=public.icetak_admin_approve_draft_for_customer(d->>'review_token',p,'qa-rollback');
    c:=public.icetak_customer_confirm_draft(a->>'customer_review_token','{}'::jsonb,'admin-proxy');
    select order_id into oid from public.qrpay_order_drafts where id=did;
    if oid is null then raise exception 'cash fixture did not convert'; end if;
    select whatsapp_opt_in into opt from public.orders where id=oid;
    if opt is distinct from enabled then raise exception 'cash action did not reach order opt-in'; end if;
    perform public.icetak_set_cash_draft_whatsapp_choice(d->>'review_token',enabled,'qa-rollback');
    select jsonb_build_array(working_draft->'notify_whatsapp',confirmed_draft->'notify_whatsapp') into flags from public.qrpay_order_drafts where id=did;
    if flags<>jsonb_build_array(enabled,enabled) then raise exception 'draft/order choice disagrees'; end if;
    select count(*) into audits from public.qrpay_order_draft_events where draft_id=did and event_type='cash_whatsapp_choice';
    perform public.icetak_set_cash_draft_whatsapp_choice(d->>'review_token',enabled,'qa-rollback');
    select count(*) into n from public.qrpay_order_draft_events where draft_id=did and event_type='cash_whatsapp_choice';
    if n<>audits then raise exception 'choice retry duplicated audit'; end if;

    update public.orders set status='Ready for Pickup',admin_status='Ready for Pickup',
      fulfillment_stage='ready_for_pickup',pickup_ready_at=now() where id=oid;
    perform public.icetak_enqueue_auto_pickup_ready(oid,now());
    select count(*) into n from public.notification_queue where order_id=oid and event_type='order_ready_pickup_auto';
    if n<>(case when enabled then 1 else 0 end) then raise exception 'ready notification choice failed: %',n; end if;
    update public.orders set payment_status='paid',payment='Paid',payment_method='Cash at Counter',payment_verified_at=now() where id=oid;
    select count(*) into n from public.notification_queue where order_id=oid and event_type='payment_received';
    if n<>(case when enabled then 1 else 0 end) then raise exception 'payment notification choice failed: %',n; end if;

    if enabled then
      q:=public.icetak_enqueue_whatsapp_event('pickup_order_confirmed',oid,'{}'::jsonb,'qa_cash_choice',now());
      if q is null then raise exception 'link fixture did not enqueue'; end if;
      perform public.icetak_set_cash_draft_whatsapp_choice(d->>'review_token',false,'qa-rollback');
      if exists(select 1 from public.notification_queue where order_id=oid and status in ('pending','processing')) then
        raise exception 'OFF left a pending customer notification';
      end if;
      if (select whatsapp_opt_in from orders where id=oid) then raise exception 'OFF did not persist'; end if;
      perform public.icetak_set_cash_draft_whatsapp_choice(d->>'review_token',true,'qa-rollback');
      if (select working_draft->>'notify_whatsapp' from qrpay_order_drafts where id=did)<>'true'
        or (select confirmed_draft->>'notify_whatsapp' from qrpay_order_drafts where id=did)<>'true'
        or not (select whatsapp_opt_in from orders where id=oid) then raise exception 'restored ON did not persist'; end if;
    end if;
    begin
      perform public.icetak_set_cash_draft_whatsapp_choice('invalid',true,'qa-rollback');
      raise exception 'invalid token accepted';
    exception when others then
      if sqlerrm<>'draft_not_found' then raise; end if;
    end;
  end loop;
  if has_function_privilege('anon','public.icetak_set_cash_draft_whatsapp_choice(text,boolean,text)','execute')
    or has_function_privilege('authenticated','public.icetak_set_cash_draft_whatsapp_choice(text,boolean,text)','execute') then
    raise exception 'choice RPC is exposed to browser roles';
  end if;
end;
$test$;
select 'PASS: cash action choice, draft/order consistency, ready and paid queues, OFF cancellation, retry, restored ON and service-only grants' as result;

ROLLBACK;
