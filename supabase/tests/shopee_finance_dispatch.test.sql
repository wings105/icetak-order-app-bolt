-- Run as postgres in the SQL editor/MCP. All test rows and pg_net requests are
-- rolled back. pg_net does not make HTTP requests until the transaction commits.
begin;
do $test$
declare
  v_prefix text := 'SQLFIN' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  v_event uuid;
  v_initial uuid;
  v_completed uuid;
  v_request bigint;
  v_payload jsonb;
  v_count integer;
  v_result jsonb;
begin
  update finance.shopee_finance_dispatch_config
    set enabled = true, target_url = 'https://hook.integrator.boost.space/transactiontestonly',
        enabled_at = now() - interval '1 hour';

  select event_id into v_event from public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-unpaid', p_event_code => 3,
    p_order_sn => v_prefix, p_shop_id => '188218638', p_region => 'MY',
    p_occurred_at => now(), p_parsed_payload => jsonb_build_object('code', 3,
      'data', jsonb_build_object('ordersn', v_prefix, 'status', 'UNPAID'))
  );
  select id, request_id, payload into v_initial, v_request, v_payload
    from finance.shopee_finance_dispatches where source_event_id = v_event and stage = 'initial';
  if v_initial is null or v_request is null then raise exception 'initial dispatch was not queued by capture'; end if;
  if v_payload->>'order_sn' <> v_prefix or v_payload->>'shop_id' <> '188218638'
     or v_payload->>'event' <> 'order_received' or v_payload->>'status' <> 'UNPAID'
     or v_payload->>'dispatch_id' <> v_initial::text then
    raise exception 'wrong initial payload: %', v_payload;
  end if;
  if not exists (select 1 from net.http_request_queue where id = v_request
    and method = 'POST' and headers->>'Idempotency-Key' = v_payload->>'idempotency_key'
    and convert_from(body, 'UTF8')::jsonb = v_payload) then
    raise exception 'wrong outgoing HTTP body/headers';
  end if;

  -- Both identical captures and distinct retries/status updates stay one initial.
  perform public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-unpaid', p_event_code => 3,
    p_order_sn => v_prefix, p_parsed_payload => jsonb_build_object('data',
      jsonb_build_object('ordersn', v_prefix, 'status', 'UNPAID'))
  );
  perform public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-paid', p_event_code => 3,
    p_order_sn => v_prefix, p_occurred_at => now() + interval '1 minute',
    p_parsed_payload => jsonb_build_object('data', jsonb_build_object('ordersn', v_prefix, 'status', 'READY_TO_SHIP'))
  );
  perform public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-paid-retry', p_event_code => 3,
    p_order_sn => v_prefix, p_occurred_at => now() + interval '1 minute',
    p_parsed_payload => jsonb_build_object('data', jsonb_build_object('ordersn', v_prefix, 'status', 'READY_TO_SHIP'))
  );
  select count(*) into v_count from finance.shopee_finance_dispatches where payload->>'order_sn' = v_prefix;
  if v_count <> 1 then raise exception 'duplicate initial dispatch'; end if;

  perform public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-chat', p_event_code => 10,
    p_order_sn => v_prefix || '-CHAT', p_parsed_payload => jsonb_build_object('data',
      jsonb_build_object('ordersn', v_prefix || '-CHAT', 'status', 'READY_TO_SHIP'))
  );
  perform public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-tracking', p_event_code => 4,
    p_order_sn => v_prefix || '-TRACK', p_parsed_payload => jsonb_build_object('data',
      jsonb_build_object('ordersn', v_prefix || '-TRACK', 'tracking_no', 'TEST'))
  );
  if exists (select 1 from finance.shopee_finance_dispatches where payload->>'order_sn' in (v_prefix || '-CHAT', v_prefix || '-TRACK')) then
    raise exception 'unrelated event queued finance';
  end if;

  select event_id into v_event from public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-completed', p_event_code => 3,
    p_order_sn => v_prefix, p_occurred_at => now() + interval '2 minutes',
    p_parsed_payload => jsonb_build_object('data', jsonb_build_object('ordersn', v_prefix, 'status', 'COMPLETED'))
  );
  select id into v_completed from finance.shopee_finance_dispatches where source_event_id = v_event and stage = 'completed';
  if v_completed is null then raise exception 'completed did not queue second dispatch'; end if;
  perform public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-completed-retry', p_event_code => 3,
    p_order_sn => v_prefix, p_occurred_at => now() + interval '2 minutes',
    p_parsed_payload => jsonb_build_object('data', jsonb_build_object('ordersn', v_prefix, 'status', 'COMPLETED'))
  );
  perform public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-late-unpaid', p_event_code => 3,
    p_order_sn => v_prefix, p_occurred_at => now() - interval '1 minute',
    p_parsed_payload => jsonb_build_object('data', jsonb_build_object('ordersn', v_prefix, 'status', 'UNPAID'))
  );
  select count(*) into v_count from finance.shopee_finance_dispatches where payload->>'order_sn' = v_prefix;
  if v_count <> 2 then raise exception 'order must have exactly two stages'; end if;
  if not exists (select 1 from public.marketplace_orders where order_sn = v_prefix and current_status = 'COMPLETED') then
    raise exception 'late event regressed order status';
  end if;

  -- A COMPLETED first sighting requests only completed, never two at once.
  perform public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-first-completed', p_event_code => 3,
    p_order_sn => v_prefix || '-FIRST', p_occurred_at => now(),
    p_parsed_payload => jsonb_build_object('data', jsonb_build_object('ordersn', v_prefix || '-FIRST', 'status', 'COMPLETED'))
  );
  select count(*) into v_count from finance.shopee_finance_dispatches where payload->>'order_sn' = v_prefix || '-FIRST' and stage = 'completed';
  if v_count <> 1 or exists (select 1 from finance.shopee_finance_dispatches where payload->>'order_sn' = v_prefix || '-FIRST' and stage = 'initial') then
    raise exception 'wrong first-completed handling';
  end if;

  -- Older COMPLETED after a newer cancellation cannot trigger finance release.
  perform public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-cancel', p_event_code => 3,
    p_order_sn => v_prefix || '-CANCEL', p_occurred_at => now() + interval '3 minutes',
    p_parsed_payload => jsonb_build_object('data', jsonb_build_object('ordersn', v_prefix || '-CANCEL', 'status', 'CANCELLED'))
  );
  perform public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-old-completed', p_event_code => 3,
    p_order_sn => v_prefix || '-CANCEL', p_occurred_at => now(),
    p_parsed_payload => jsonb_build_object('data', jsonb_build_object('ordersn', v_prefix || '-CANCEL', 'status', 'COMPLETED'))
  );
  if exists (select 1 from finance.shopee_finance_dispatches where payload->>'order_sn' = v_prefix || '-CANCEL') then
    raise exception 'stale completion caused a dispatch';
  end if;

  -- Receipt success is tracked; repeated worker runs cannot resend success.
  insert into net._http_response (id, status_code, content, timed_out) values (v_request, 200, 'Accepted', false);
  v_result := finance.run_shopee_finance_dispatches(200);
  if not exists (select 1 from finance.shopee_finance_dispatches where id = v_initial and status = 'delivered' and attempt_count = 1) then
    raise exception '200 response not finalized';
  end if;
  perform finance.run_shopee_finance_dispatches(200);
  if finance.send_shopee_finance_dispatch(v_initial) then raise exception 'delivered request resent'; end if;

  -- Retry on 429 with the same dispatch ID, body, and idempotency key.
  select request_id, payload into v_request, v_payload from finance.shopee_finance_dispatches where id = v_completed;
  insert into net._http_response (id, status_code, timed_out) values (v_request, 429, false);
  perform finance.run_shopee_finance_dispatches(200);
  if not exists (select 1 from finance.shopee_finance_dispatches where id = v_completed and status = 'pending' and available_at > now()) then
    raise exception '429 did not schedule backoff';
  end if;
  update finance.shopee_finance_dispatches set available_at = now() where id = v_completed;
  perform finance.run_shopee_finance_dispatches(200);
  if not exists (select 1 from finance.shopee_finance_dispatches d join net.http_request_queue q on q.id = d.request_id
    where d.id = v_completed and d.status = 'in_flight' and d.attempt_count = 2
      and d.payload = v_payload and convert_from(q.body, 'UTF8')::jsonb = v_payload
      and q.headers->>'Idempotency-Key' = v_payload->>'idempotency_key') then
    raise exception 'retry changed identity or body';
  end if;

  select request_id into v_request from finance.shopee_finance_dispatches where id = v_completed;
  insert into net._http_response (id, status_code, timed_out) values (v_request, 401, false);
  perform finance.run_shopee_finance_dispatches(200);
  if not exists (select 1 from finance.shopee_finance_dispatches where id = v_completed and status = 'failed' and last_http_status = 401) then
    raise exception 'permanent 401 should stop retries';
  end if;

  -- Recovery after pg_net loses an unlogged request; bounded retry count.
  update finance.shopee_finance_dispatches set status = 'in_flight', request_id = null,
    attempt_count = 7, last_attempt_at = now() - interval '6 minutes' where id = v_completed;
  perform finance.run_shopee_finance_dispatches(200);
  if not exists (select 1 from finance.shopee_finance_dispatches where id = v_completed and status = 'pending' and last_error = 'response_missing_after_5_minutes') then
    raise exception 'missing request not recovered';
  end if;
  update finance.shopee_finance_dispatches set available_at = now() where id = v_completed;
  perform finance.run_shopee_finance_dispatches(200);
  select request_id into v_request from finance.shopee_finance_dispatches where id = v_completed;
  insert into net._http_response (id, status_code, timed_out) values (v_request, 503, false);
  perform finance.run_shopee_finance_dispatches(200);
  if not exists (select 1 from finance.shopee_finance_dispatches where id = v_completed and status = 'failed' and attempt_count = 8) then
    raise exception 'eight-attempt bound failed';
  end if;

  -- Pausing dispatch does not affect successful incoming order capture.
  update finance.shopee_finance_dispatch_config set enabled = false;
  select event_id into v_event from public.capture_marketplace_webhook(
    p_provider => 'shopee', p_event_key => v_prefix || '-paused', p_event_code => 3,
    p_order_sn => v_prefix || '-PAUSED', p_occurred_at => now(),
    p_parsed_payload => jsonb_build_object('data', jsonb_build_object('ordersn', v_prefix || '-PAUSED', 'status', 'READY_TO_SHIP'))
  );
  if not exists (select 1 from public.marketplace_webhook_events where id = v_event and processing_status = 'processed')
    or exists (select 1 from finance.shopee_finance_dispatches where source_event_id = v_event) then
    raise exception 'disabled dispatch affected capture';
  end if;

  update finance.shopee_finance_dispatch_config set enabled = true, enabled_at = now() + interval '1 minute';
  if finance.enqueue_shopee_finance_dispatch(v_event) is not null then raise exception 'historical event auto-replayed'; end if;
  if finance.enqueue_shopee_finance_dispatch(v_event, true) is null then raise exception 'explicit replay failed'; end if;

  if has_table_privilege('anon', 'finance.shopee_finance_dispatch_config', 'SELECT')
    or has_table_privilege('authenticated', 'finance.shopee_finance_dispatches', 'INSERT')
    or has_function_privilege('anon', 'finance.enqueue_shopee_finance_dispatch(uuid,boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'finance.run_shopee_finance_dispatches(integer)', 'EXECUTE')
    or has_function_privilege('service_role', 'finance.send_shopee_finance_dispatch(uuid)', 'EXECUTE') then
    raise exception 'private dispatch privileges exposed';
  end if;
  raise notice 'PASS: lifecycle, duplicates, unrelated events, stale events, first completion, HTTP success, retry identity/backoff/limit, crash recovery, pause, activation, private permissions';
end;
$test$;
rollback;
