create or replace function public.claim_clickup_production_outbox(p_limit integer default 10)
returns setof public.integration_outbox
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  perform public.icetak_reconcile_clickup_webhook_backfill(null);

  update public.integration_outbox o
  set status='processed',processed_at=coalesce(o.processed_at,now()),sent_at=coalesce(o.sent_at,now()),
      locked_at=null,next_attempt_at=null,last_error=null,error=null
  where o.provider='activepieces' and o.event_type='clickup.production.create'
    and o.status in ('pending','retry','processing')
    and not exists(select 1 from public.production_components pc where pc.order_id=o.order_id and pc.clickup_task_id is null);

  update public.integration_outbox
  set status='failed',locked_at=null,next_attempt_at=null,
      last_error='activepieces_stale_after_max_attempts',
      error='Activepieces did not finish ClickUp create/link after repeated 3-minute leases'
  where provider='activepieces' and event_type='clickup.production.create' and status='processing'
    and locked_at < now()-interval '3 minutes' and coalesce(attempts,0) >= 5;

  update public.integration_outbox
  set status='retry',locked_at=null,next_attempt_at=now(),last_error='stale_processing_lease_recovered',error=null
  where provider='activepieces' and event_type='clickup.production.create' and status='processing'
    and locked_at < now()-interval '3 minutes' and coalesce(attempts,0) < 5;

  return query
  with picked as (
    select id from public.integration_outbox
    where provider='activepieces' and event_type='clickup.production.create'
      and status in ('pending','retry') and coalesce(next_attempt_at,now()) <= now()
    order by created_at limit greatest(1,least(coalesce(p_limit,10),50)) for update skip locked
  )
  update public.integration_outbox o
  set status='processing',locked_at=now(),next_attempt_at=null,last_error=null,error=null,
      attempts=coalesce(o.attempts,0)+1,payload=public.icetak_clickup_production_payload_data(o.order_id)
  from picked where o.id=picked.id returning o.*;
end;
$$;

comment on function public.claim_clickup_production_outbox(integer) is
  'Claims component-safe ClickUp production jobs with a 3-minute lease; stale jobs auto-retry below 5 attempts and then fail for explicit admin recovery instead of looping indefinitely.';
