create extension if not exists pg_cron;

create or replace function public.icetak_dispatch_pending_notifications()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  dispatch_url text;
  dispatch_key text;
  request_id bigint;
begin
  if not exists (
    select 1 from public.notification_queue
    where status='pending' and coalesce(scheduled_at,now())<=now()
  ) then
    return null;
  end if;

  select text_value into dispatch_url from public.whatsapp_settings where key='dispatch_url' limit 1;
  select secret_value into dispatch_key from public.whatsapp_settings where key='dispatch_internal_key' limit 1;
  if nullif(dispatch_url,'') is null or nullif(dispatch_key,'') is null then
    return null;
  end if;

  select net.http_post(
    url:=dispatch_url,
    headers:=jsonb_build_object('content-type','application/json','x-internal-key',dispatch_key),
    body:=jsonb_build_object('limit',20)
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.icetak_dispatch_pending_notifications() from public,anon,authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname='icetak-whatsapp-dispatch-every-minute';

select cron.schedule(
  'icetak-whatsapp-dispatch-every-minute',
  '* * * * *',
  'select public.icetak_dispatch_pending_notifications();'
);