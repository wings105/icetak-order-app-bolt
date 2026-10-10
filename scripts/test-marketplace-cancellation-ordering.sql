-- Order System regression; every fixture and trigger effect is rolled back.
begin;
set local statement_timeout='15s';
set local role service_role;
do $qa$
declare
  template public.marketplace_orders%rowtype;
  fixture uuid := gen_random_uuid();
  source_event uuid;
  example jsonb;
  event jsonb;
  case_no integer := 0;
  seq integer := 1000000;
  actual text;
begin
  select * into strict template from public.marketplace_orders
  where provider='shopee' order by created_at desc limit 1;
  select id into strict source_event from public.marketplace_webhook_events
  where provider='shopee' order by received_at desc limit 1;
  if exists(select 1 from public.marketplace_order_status_history
    where source_event_id=source_event and sequence_no>=1000000) then
    raise exception 'QA sequence range occupied';
  end if;
  insert into public.marketplace_orders(id,provider,order_sn,shop_id,payment_status)
  values(fixture,template.provider,'QA-CANCEL-'||fixture::text,template.shop_id,'paid');

  for example in select value from jsonb_array_elements('[
    {"name":"late pending cannot overwrite final at same second","expected":"CANCELLED","events":[["CANCELLED",0,0],["IN_CANCEL",0,1]]},
    {"name":"reverse arrival order","expected":"CANCELLED","events":[["IN_CANCEL",0,0],["CANCELLED",0,1]]},
    {"name":"older cancellation cannot override newer status","expected":"READY_TO_SHIP","events":[["CANCELLED",0,2],["READY_TO_SHIP",1,1]]},
    {"name":"genuine pending cancellation remains pending","expected":"IN_CANCEL","events":[["READY_TO_SHIP",0,0],["IN_CANCEL",1,1]]},
    {"name":"older late delivery ignored","expected":"CANCELLED","events":[["CANCELLED",1,0],["READY_TO_SHIP",0,2]]},
    {"name":"newer cancellation withdrawal retains time ordering","expected":"READY_TO_SHIP","events":[["IN_CANCEL",0,1],["READY_TO_SHIP",1,0]]},
    {"name":"ordinary delivery ordering preserved","expected":"SHIPPED","events":[["READY_TO_SHIP",0,2],["SHIPPED",1,1]]}
  ]'::jsonb)
  loop
    case_no := case_no+1;
    delete from public.marketplace_order_status_history where order_id=fixture;
    for event in select value from jsonb_array_elements(example->'events')
    loop
      seq := seq+1;
      insert into public.marketplace_order_status_history
        (order_id,source_event_id,sequence_no,event_code,event_kind,status,occurred_at,created_at)
      values(fixture,source_event,seq,3,'order_status',event->>0,
        '2026-01-01 00:00:00+00'::timestamptz+make_interval(secs=>(event->>1)::int),
        '2026-01-01 00:01:00+00'::timestamptz+make_interval(secs=>(event->>2)::int));
    end loop;
    actual := public.reconcile_marketplace_order_status(fixture);
    if actual is distinct from example->>'expected' then
      raise exception '%: expected %, got %',example->>'name',example->>'expected',actual;
    end if;
    if not exists(select 1 from public.marketplace_orders where id=fixture
      and current_status=actual and payment_status='paid') then
      raise exception '%: persisted status/payment incorrect',example->>'name';
    end if;
    update public.marketplace_orders set updated_at='2000-01-01 00:00:00+00' where id=fixture;
    perform public.reconcile_marketplace_order_status(fixture);
    if not exists(select 1 from public.marketplace_orders where id=fixture
      and updated_at='2000-01-01 00:00:00+00') then
      raise exception '%: repeated reconciliation mutated the order',example->>'name';
    end if;
  end loop;
  delete from public.marketplace_order_status_history where order_id=fixture;
  if public.reconcile_marketplace_order_status(fixture) is not null then
    raise exception 'Empty history must return null';
  end if;
  -- Exercise deferred production triggers while still inside the rollback.
  set constraints all immediate;
end $qa$;
rollback;
select '8 cases passed; persisted status/payment and duplicate-sync checks passed; all fixtures rolled back' as result;
