-- Ensure delayed WhatsApp notification retries are dispatched after their
-- scheduled_at time. Secrets remain in whatsapp_settings and are resolved by
-- Postgres at runtime; no credential is persisted in the cron command.
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'icetak-whatsapp-dispatch-retry'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end
$$;

select cron.schedule(
  'icetak-whatsapp-dispatch-retry',
  '* * * * *',
  $cron$
    select net.http_post(
      url := coalesce(
        (select nullif(text_value, '') from public.whatsapp_settings where key = 'dispatch_url' limit 1),
        'https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/whatsapp-dispatch'
      ),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-internal-key', (select secret_value from public.whatsapp_settings where key = 'dispatch_internal_key' limit 1)
      ),
      body := jsonb_build_object('limit', 20),
      timeout_milliseconds := 30000
    );
  $cron$
);
