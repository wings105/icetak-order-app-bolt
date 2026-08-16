-- ClickUp production outbox reliability hardening.
-- 1) Make the watchdog the single owner of stale lease recovery.
-- 2) Add a read-only peek + atomic claim-by-id so the Edge Function can
--    prepare its response before changing queue state to processing.
-- 3) Add lightweight HTTP diagnostics for intermittent AP auth/request issues.

create table if not exists public.clickup_outbox_http_events (
  id bigint generated always as identity primary key,
  function_name text not null,
  request_id uuid not null,
  stage text not null,
  event_id uuid null,
  order_id uuid null,
  status_code integer null,
  duration_ms integer null,
  has_ap_secret boolean null,
  raw_secret_length integer null,
  trimmed_secret_length integer null,
  provided_secret_fingerprint text null,
  cf_ray text null,
  user_agent text null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists clickup_outbox_http_events_created_at_idx
  on public.clickup_outbox_http_events(created_at desc);

create index if not exists clickup_outbox_http_events_request_id_idx
  on public.clickup_outbox_http_events(request_id);

create index if not exists clickup_outbox_http_events_event_id_idx
  on public.clickup_outbox_http_events(event_id, created_at desc)
  where event_id is not null;

alter table public.clickup_outbox_http_events enable row level security;
revoke all on table public.clickup_outbox_http_events from anon, authenticated;
grant select, insert on table public.clickup_outbox_http_events to service_role;
grant usage, select on sequence public.clickup_outbox_http_events_id_seq to service_role;

create or replace function public.peek_clickup_production_outbox(p_limit integer default 10)
returns setof public.integration_outbox
language sql
stable
security definer
set search_path to 'public','pg_temp'
as $$
  select o.*
  from public.integration_outbox o
  where o.provider='activepieces'
    and o.event_type='clickup.production.create'
    and o.status in ('pending','retry')
    and coalesce(o.next_attempt_at,now()) <= now()
    and exists (
      select 1
      from public.production_components pc
      where pc.order_id=o.order_id
        and pc.clickup_task_id is null
    )
  order by o.created_at, o.id
  limit greatest(1,least(coalesce(p_limit,10),50));
$$;

revoke all on function public.peek_clickup_production_outbox(integer) from public, anon, authenticated;
grant execute on function public.peek_clickup_production_outbox(integer) to service_role;

create or replace function public.claim_clickup_production_outbox_event(
  p_event_id uuid,
  p_expected_missing_count integer default null,
  p_request_id uuid default null
)
returns setof public.integration_outbox
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  return query
  update public.integration_outbox o
  set status='processing',
      locked_at=now(),
      next_attempt_at=null,
      last_error=null,
      error=null,
      attempts=coalesce(o.attempts,0)+1,
      payload=coalesce(public.icetak_clickup_production_payload_data(o.order_id),'{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object(
          'claim_request_id', p_request_id,
          'claim_strategy', 'prepare_then_claim_v3'
        ))
  where o.id=p_event_id
    and o.provider='activepieces'
    and o.event_type='clickup.production.create'
    and o.status in ('pending','retry')
    and coalesce(o.next_attempt_at,now()) <= now()
    and exists (
      select 1
      from public.production_components pc
      where pc.order_id=o.order_id
        and pc.clickup_task_id is null
    )
    and (
      p_expected_missing_count is null
      or p_expected_missing_count = (
        select count(*)::integer
        from public.production_components pc
        where pc.order_id=o.order_id
          and pc.clickup_task_id is null
      )
    )
  returning o.*;
end;
$$;

revoke all on function public.claim_clickup_production_outbox_event(uuid,integer,uuid) from public, anon, authenticated;
grant execute on function public.claim_clickup_production_outbox_event(uuid,integer,uuid) to service_role;

-- Keep the legacy batch RPC for compatibility, but remove stale recovery from
-- it. The watchdog below is now the single owner of stale lease transitions.
create or replace function public.claim_clickup_production_outbox(p_limit integer default 10)
returns setof public.integration_outbox
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  return query
  with picked as (
    select o0.id
    from public.integration_outbox o0
    where o0.provider='activepieces'
      and o0.event_type='clickup.production.create'
      and o0.status in ('pending','retry')
      and coalesce(o0.next_attempt_at,now()) <= now()
      and exists (
        select 1
        from public.production_components pc
        where pc.order_id=o0.order_id
          and pc.clickup_task_id is null
      )
    order by o0.created_at, o0.id
    limit greatest(1,least(coalesce(p_limit,10),50))
    for update of o0 skip locked
  )
  update public.integration_outbox o
  set status='processing',
      locked_at=now(),
      next_attempt_at=null,
      last_error=null,
      error=null,
      attempts=coalesce(o.attempts,0)+1,
      payload=public.icetak_clickup_production_payload_data(o.order_id)
  from picked
  where o.id=picked.id
  returning o.*;
end;
$$;

comment on function public.claim_clickup_production_outbox(integer) is
  'Legacy batch claim RPC. Stale recovery is owned by icetak_clickup_production_outbox_watchdog; new Edge consumers should prepare first then call claim_clickup_production_outbox_event.';

create or replace function public.icetak_clickup_production_outbox_watchdog()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_reconciled integer := 0;
  v_processed integer := 0;
  v_failed integer := 0;
  v_released integer := 0;
begin
  v_reconciled := public.icetak_reconcile_clickup_webhook_backfill(null);

  update public.integration_outbox o
  set status='processed',
      processed_at=coalesce(o.processed_at,now()),
      sent_at=coalesce(o.sent_at,now()),
      locked_at=null,
      next_attempt_at=null,
      last_error=null,
      error=null
  where o.provider='activepieces'
    and o.event_type='clickup.production.create'
    and o.status in ('pending','retry','processing')
    and not exists(
      select 1
      from public.production_components pc
      where pc.order_id=o.order_id
        and pc.clickup_task_id is null
    );
  get diagnostics v_processed = row_count;

  update public.integration_outbox
  set status='failed',
      locked_at=null,
      next_attempt_at=null,
      last_error='activepieces_stale_after_max_attempts',
      error='Activepieces did not finish ClickUp create/link after repeated 3-minute leases'
  where provider='activepieces'
    and event_type='clickup.production.create'
    and status='processing'
    and locked_at < now()-interval '3 minutes'
    and coalesce(attempts,0) >= 5;
  get diagnostics v_failed = row_count;

  update public.integration_outbox
  set status='retry',
      locked_at=null,
      next_attempt_at=now(),
      last_error='stale_processing_lease_recovered',
      error=null
  where provider='activepieces'
    and event_type='clickup.production.create'
    and status='processing'
    and locked_at < now()-interval '3 minutes'
    and coalesce(attempts,0) < 5;
  get diagnostics v_released = row_count;

  return jsonb_build_object(
    'ok',true,
    'reconciled_from_clickup_webhook',v_reconciled,
    'marked_processed',v_processed,
    'failed_stale_processing',v_failed,
    'released_stale_processing',v_released,
    'at',now()
  );
end;
$$;

comment on function public.icetak_clickup_production_outbox_watchdog() is
  'Single owner of ClickUp production stale lease recovery: reconcile linked tasks, fail stale leases at >=5 attempts, retry stale leases below 5 attempts.';

-- Keep diagnostics bounded. This is intentionally low-frequency (auth failures,
-- preparation errors and claimed jobs, not count=0 polls).
do $do$
begin
  if exists(select 1 from cron.job where jobname='clickup-outbox-http-events-retention') then
    perform cron.unschedule('clickup-outbox-http-events-retention');
  end if;
  perform cron.schedule(
    'clickup-outbox-http-events-retention',
    '17 3 * * *',
    $cmd$delete from public.clickup_outbox_http_events where created_at < now()-interval '30 days';$cmd$
  );
end
$do$;
