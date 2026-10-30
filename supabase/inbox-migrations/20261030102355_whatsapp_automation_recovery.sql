-- service_role uses the live safeupdate extension: singleton writes need explicit predicates.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.icetak_wa_automation(text,jsonb,text)'::regprocedure) into definition;
 definition:=replace(definition,'update wa_automation.health set last_worker_at=now(),last_worker_error=null;',
  'update wa_automation.health set last_worker_at=now(),last_worker_error=null where singleton=true;');
 execute definition;
 select pg_get_functiondef('wa_automation.capture()'::regprocedure) into definition;
 definition:=replace(definition,'update wa_automation.health set last_worker_error=''CAPTURE_FAILED:''||sqlstate;',
  'update wa_automation.health set last_worker_error=''CAPTURE_FAILED:''||sqlstate where singleton=true;');
 execute definition;
end $$;

create or replace function wa_automation.kick() returns bigint language plpgsql security invoker set search_path='' as $$
declare token text; request_id bigint;
begin
 if not exists(select 1 from wa_automation.runs where status in ('pending','retry','processing') and available_at<=now())
  and exists(select 1 from wa_automation.health where last_worker_at>now()-interval '5 minutes') then return null; end if;
 select setting_value into token from public.private_runtime_settings where setting_key='qrpay_ai_worker_token';
 if nullif(token,'') is null then return null; end if;
 select net.http_post(url:='https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/automation-engine',
  headers:=jsonb_build_object('content-type','application/json','x-automation-token',token),
  body:='{"action":"process"}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end $$;
revoke all on function wa_automation.kick() from public,anon,authenticated;
grant execute on function wa_automation.kick() to service_role;
