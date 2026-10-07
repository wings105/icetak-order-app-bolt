BEGIN;

-- Acceptance test for the shared storefront/customer-portal creation RPC.
-- Run inside a transaction and ROLLBACK: no fixtures or provider jobs may commit.
do $test$
declare
  p jsonb;
  r jsonb;
  again jsonb;
  oid uuid;
  opt boolean;
  mode integer;
  expected_opt boolean;
  n integer;
  qid uuid;
  fixture_key text := 'qa:direct-whatsapp:'||gen_random_uuid()::text;
begin
  if not exists(select 1 from public.whatsapp_settings_masked where key='enabled' and text_value='true' and is_secret=false) then
    raise exception 'Acceptance test requires the existing master ON; do not activate it for testing';
  end if;
  for mode in 1..5 loop
    expected_opt:=mode not in (2,5);
    p:=jsonb_build_object(
      'customer',jsonb_build_object('name','QA direct checkout rollback','phone','60100000001'),
      'items',jsonb_build_array(jsonb_build_object('k','acrylic','title','Acrylic Cake Topper','qty',1,'price',9876.01+mode,'size','A6 Standard','style','Gold','process','Pre-order','customText','QA')),
      'total',9876.01+mode,'date_need',(now() at time zone 'Asia/Kuala_Lumpur')::date+2,
      'delivery','pickup','payment',case when mode=3 then 'Cash at Counter' else 'QR Pay' end,
      'source',case when mode=4 then 'customer_portal' when mode=5 then 'draft_engine' else 'customer' end,
      'external_order_id',fixture_key||':'||mode
    );
    if mode<>4 then p:=p||jsonb_build_object('notify_whatsapp',mode<>2); end if;
    r:=public.icetak_create_order(p);
    oid:=(r->>'order_db_id')::uuid;
    if oid is null then raise exception 'fixture did not create an order'; end if;
    select whatsapp_opt_in into opt from public.orders where id=oid;
    if opt is distinct from expected_opt then raise exception 'checkout consent was not saved for mode %',mode; end if;
    select count(*) into n from public.notification_queue where order_id=oid and event_type='order_created';
    if n<>(case when expected_opt then 1 else 0 end) then
      raise exception 'wrong order_created queue count mode %: %',mode,n;
    end if;
    if expected_opt then
      if not exists(select 1 from public.notification_queue where order_id=oid and event_type='order_created' and status='pending' and phone=public.icetak_normalize_phone('60100000001')) then
        raise exception 'wrong order recipient/status mode %',mode;
      end if;
    end if;
    if not exists(select 1 from public.notification_outbox where order_id=r->>'order_id' and event_type='order_created') and expected_opt then
      raise exception 'order_created outbox missing';
    end if;
    again:=public.icetak_create_order(p);
    if coalesce((again->>'duplicate')::boolean,false)=false or again->>'order_id'<>r->>'order_id' then
      raise exception 'creation retry was not idempotent';
    end if;
    select count(*) into n from public.notification_queue where order_id=oid and event_type='order_created';
    if n<>(case when expected_opt then 1 else 0 end) then raise exception 'creation retry duplicated a notification'; end if;

    update public.orders set payment='Paid',payment_status='paid',payment_method='QR Pay',payment_verified_at=now() where id=oid;
    update public.orders set payment='Paid',payment_status='paid' where id=oid;
    select count(*) into n from public.notification_queue where order_id=oid and event_type='payment_received';
    if n<>(case when expected_opt then 1 else 0 end) then raise exception 'wrong payment_received count mode %: %',mode,n; end if;
    if expected_opt then
      qid:=public.icetak_enqueue_whatsapp_event('payment_received',oid,'{}'::jsonb,null,now());
      if qid is not null then raise exception 'payment retry duplicated a notification'; end if;
    end if;
  end loop;
end;
$test$;

select 'PASS: checkout consent ON/OFF/default, cash and QR, customer/customer_portal, recipient, create retry, paid transition, payment retry and non-customer isolation' as result;

ROLLBACK;
