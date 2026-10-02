-- Two finance requests per Shopee order. The private destination is configured
-- separately after deployment; never put the bearer webhook URL in this file.
create table finance.shopee_finance_dispatch_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  target_url text,
  enabled_at timestamptz,
  updated_at timestamptz not null default now(),
  check (target_url is null or target_url ~ '^https://hook\.integrator\.boost\.space/[A-Za-z0-9]+$'),
  check (not enabled or (target_url is not null and enabled_at is not null))
);
insert into finance.shopee_finance_dispatch_config (singleton) values (true);
alter table finance.shopee_finance_dispatch_config enable row level security;
revoke all on finance.shopee_finance_dispatch_config from public, anon, authenticated, service_role;

create table finance.shopee_finance_dispatches (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id) on delete cascade,
  source_event_id uuid references public.marketplace_webhook_events(id) on delete set null,
  stage text not null check (stage in ('initial', 'completed')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'in_flight', 'delivered', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  request_id bigint,
  available_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_http_status integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, stage)
);
create index shopee_finance_dispatch_pending_idx
  on finance.shopee_finance_dispatches (available_at, created_at) where status = 'pending';
create index shopee_finance_dispatch_flight_idx
  on finance.shopee_finance_dispatches (last_attempt_at) where status = 'in_flight';
create index shopee_finance_dispatch_source_idx
  on finance.shopee_finance_dispatches (source_event_id);
alter table finance.shopee_finance_dispatches enable row level security;
revoke all on finance.shopee_finance_dispatches from public, anon, authenticated, service_role;
grant select on finance.shopee_finance_dispatches to service_role;

create or replace function finance.send_shopee_finance_dispatch(p_dispatch_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_config finance.shopee_finance_dispatch_config%rowtype;
  v_job finance.shopee_finance_dispatches%rowtype;
  v_request_id bigint;
begin
  select * into v_config from finance.shopee_finance_dispatch_config where singleton;
  if not coalesce(v_config.enabled, false) then return false; end if;
  select * into v_job from finance.shopee_finance_dispatches
    where id = p_dispatch_id for update;
  if not found or v_job.status <> 'pending' or v_job.available_at > now() then return false; end if;
  if v_job.attempt_count >= 8 then
    update finance.shopee_finance_dispatches
      set status = 'failed', last_error = 'retry_limit_reached', updated_at = now()
      where id = v_job.id;
    return false;
  end if;

  -- pg_net starts the HTTP request only after the order transaction commits.
  begin
    v_request_id := net.http_post(
      url := v_config.target_url,
      body := v_job.payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Idempotency-Key', v_job.payload->>'idempotency_key',
        'X-ICetak-Dispatch-Id', v_job.id::text
      ),
      timeout_milliseconds := 15000
    );
    update finance.shopee_finance_dispatches
      set status = 'in_flight', request_id = v_request_id,
          attempt_count = attempt_count + 1, last_attempt_at = now(),
          last_http_status = null, last_error = null, updated_at = now()
      where id = v_job.id;
    return true;
  exception when others then
    -- A dispatch failure must not prevent the incoming order from being saved.
    update finance.shopee_finance_dispatches
      set status = case when attempt_count + 1 >= 8 then 'failed' else 'pending' end,
          attempt_count = attempt_count + 1, last_attempt_at = now(),
          last_error = 'http_enqueue_failed:' || sqlstate,
          available_at = now() + make_interval(mins => least(60, power(2, least(attempt_count, 6))::integer)),
          updated_at = now()
      where id = v_job.id;
    return false;
  end;
end;
$function$;
revoke all on function finance.send_shopee_finance_dispatch(uuid) from public, anon, authenticated, service_role;

create or replace function finance.enqueue_shopee_finance_dispatch(p_event_id uuid, p_replay boolean default false)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_config finance.shopee_finance_dispatch_config%rowtype;
  v_event public.marketplace_webhook_events%rowtype;
  v_order public.marketplace_orders%rowtype;
  v_data jsonb;
  v_status text;
  v_stage text;
  v_id uuid := gen_random_uuid();
  v_inserted uuid;
  v_key text;
begin
  select * into v_config from finance.shopee_finance_dispatch_config where singleton;
  if not coalesce(v_config.enabled, false) then return null; end if;
  select * into v_event from public.marketplace_webhook_events where id = p_event_id;
  if not found or v_event.provider <> 'shopee' or v_event.processing_status <> 'processed'
     or v_event.parse_error is not null or v_event.parsed_payload is null
     or (not p_replay and v_event.received_at < v_config.enabled_at) then
    return null;
  end if;
  if v_event.event_code is distinct from 3 and not (
    v_event.event_code is null and nullif(v_event.parsed_payload->>'orderno', '') is not null
  ) then return null; end if;

  v_data := case when jsonb_typeof(v_event.parsed_payload->'data') = 'object'
    then v_event.parsed_payload->'data' else v_event.parsed_payload end;
  select * into v_order from public.marketplace_orders
    where provider = 'shopee' and order_sn = coalesce(
      v_event.order_sn, nullif(v_data->>'order_sn', ''),
      nullif(v_data->>'ordersn', ''), nullif(v_event.parsed_payload->>'orderno', '')
    );
  if not found then return null; end if;
  v_status := upper(coalesce(nullif(v_data->>'status', ''), v_order.current_status));

  if v_event.event_code = 3 and v_status = 'COMPLETED' and v_order.current_status = 'COMPLETED' then
    v_stage := 'completed';
  elsif v_status in ('UNPAID', 'READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'TO_CONFIRM_RECEIVE', 'IN_CANCEL', 'UNKNOWN')
    and v_order.current_status not in ('COMPLETED', 'CANCELLED') then
    v_stage := 'initial';
  else
    return null;
  end if;

  v_key := 'shopee:' || v_order.order_sn || ':' || v_stage;
  insert into finance.shopee_finance_dispatches (id, order_id, source_event_id, stage, payload)
    values (v_id, v_order.id, v_event.id, v_stage, jsonb_build_object(
      'schema_version', 1,
      'dispatch_id', v_id,
      'idempotency_key', v_key,
      'provider', 'shopee',
      'stage', v_stage,
      'event', case v_stage when 'completed' then 'order_completed' else 'order_received' end,
      'order_sn', v_order.order_sn,
      'ordersn', v_order.order_sn,
      'shop_id', coalesce(v_event.shop_id, v_order.shop_id),
      'status', v_status,
      'region', v_order.region,
      'currency', v_order.currency,
      'source_event_id', v_event.id,
      'occurred_at', coalesce(v_event.occurred_at, v_event.received_at)
    ))
    on conflict (order_id, stage) do nothing
    returning id into v_inserted;
  if v_inserted is not null then
    perform finance.send_shopee_finance_dispatch(v_inserted);
    return v_inserted;
  end if;
  return null;
end;
$function$;
revoke all on function finance.enqueue_shopee_finance_dispatch(uuid, boolean) from public, anon, authenticated, service_role;

create or replace function finance.queue_shopee_finance_dispatch_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform finance.enqueue_shopee_finance_dispatch(new.id);
  return new;
end;
$function$;
revoke all on function finance.queue_shopee_finance_dispatch_trigger() from public, anon, authenticated, service_role;

create trigger shopee_finance_dispatch_after_processing
  after update of processing_status on public.marketplace_webhook_events
  for each row
  when (new.provider = 'shopee' and new.processing_status = 'processed'
        and old.processing_status is distinct from new.processing_status)
  execute function finance.queue_shopee_finance_dispatch_trigger();

create or replace function finance.run_shopee_finance_dispatches(p_limit integer default 50)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_job finance.shopee_finance_dispatches%rowtype;
  v_response net._http_response%rowtype;
  v_found boolean;
  v_retry boolean;
  v_delivered integer := 0;
  v_retried integer := 0;
  v_failed integer := 0;
  v_sent integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  for v_job in
    select * from finance.shopee_finance_dispatches
    where status = 'in_flight' order by last_attempt_at, id
    limit v_limit for update skip locked
  loop
    select * into v_response from net._http_response
      where id = v_job.request_id order by created desc limit 1;
    v_found := found;
    -- Lost unlogged pg_net requests (e.g. a database restart) are recoverable.
    if not v_found and v_job.last_attempt_at > now() - interval '5 minutes' then continue; end if;

    if v_found and v_response.status_code between 200 and 299
       and not coalesce(v_response.timed_out, false) and v_response.error_msg is null then
      update finance.shopee_finance_dispatches
        set status = 'delivered', delivered_at = coalesce(v_response.created, now()),
            last_http_status = v_response.status_code, last_error = null, updated_at = now()
        where id = v_job.id;
      v_delivered := v_delivered + 1;
    else
      v_retry := not v_found or v_response.status_code is null
        or coalesce(v_response.timed_out, false) or v_response.error_msg is not null
        or v_response.status_code in (408, 425, 429) or v_response.status_code >= 500;
      v_retry := v_retry and v_job.attempt_count < 8;
      update finance.shopee_finance_dispatches
        set status = case when v_retry then 'pending' else 'failed' end,
            last_http_status = v_response.status_code,
            last_error = case when not v_found then 'response_missing_after_5_minutes'
              when coalesce(v_response.timed_out, false) then 'http_timeout'
              when v_response.error_msg is not null then 'http_network_error'
              else 'http_' || coalesce(v_response.status_code::text, 'unknown') end,
            available_at = now() + make_interval(mins => least(60, power(2, least(greatest(v_job.attempt_count - 1, 0), 6))::integer)),
            updated_at = now()
        where id = v_job.id;
      if v_retry then v_retried := v_retried + 1; else v_failed := v_failed + 1; end if;
    end if;
  end loop;

  for v_job in
    select * from finance.shopee_finance_dispatches
    where status = 'pending' and available_at <= now()
    order by available_at, created_at, id limit v_limit for update skip locked
  loop
    if finance.send_shopee_finance_dispatch(v_job.id) then v_sent := v_sent + 1; end if;
  end loop;
  return jsonb_build_object('delivered', v_delivered, 'retry_pending', v_retried, 'failed', v_failed, 'sent', v_sent);
end;
$function$;
revoke all on function finance.run_shopee_finance_dispatches(integer) from public, anon, authenticated, service_role;

select cron.schedule(
  'icetak-shopee-finance-dispatch-every-minute',
  '* * * * *',
  'select finance.run_shopee_finance_dispatches(50);'
);
