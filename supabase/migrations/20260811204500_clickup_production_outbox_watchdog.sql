create or replace function public.icetak_clickup_production_outbox_watchdog()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_reconciled integer := 0;
  v_processed integer := 0;
  v_released integer := 0;
begin
  v_reconciled := public.icetak_reconcile_clickup_webhook_backfill(null);

  update public.integration_outbox o
  set status='processed',
      processed_at=coalesce(o.processed_at,now()),
      sent_at=coalesce(o.sent_at,now()),
      locked_at=null,
      last_error=null,
      error=null
  where o.provider='activepieces'
    and o.event_type='clickup.production.create'
    and o.status in ('pending','retry','processing')
    and not exists(
      select 1 from public.production_components pc
      where pc.order_id=o.order_id and pc.clickup_task_id is null
    );
  get diagnostics v_processed = row_count;

  update public.integration_outbox
  set status='retry',
      locked_at=null,
      next_attempt_at=now(),
      last_error='stale_processing_lease_recovered'
  where provider='activepieces'
    and event_type='clickup.production.create'
    and status='processing'
    and locked_at < now()-interval '3 minutes';
  get diagnostics v_released = row_count;

  return jsonb_build_object(
    'ok',true,
    'reconciled_from_clickup_webhook',v_reconciled,
    'marked_processed',v_processed,
    'released_stale_processing',v_released,
    'at',now()
  );
end;
$$;

do $$
begin
  if exists(select 1 from cron.job where jobname='clickup-production-outbox-watchdog') then
    perform cron.unschedule('clickup-production-outbox-watchdog');
  end if;
  perform cron.schedule(
    'clickup-production-outbox-watchdog',
    '* * * * *',
    'select public.icetak_clickup_production_outbox_watchdog();'
  );
end $$;
