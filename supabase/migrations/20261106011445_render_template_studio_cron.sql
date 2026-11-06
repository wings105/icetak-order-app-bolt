create or replace function render_studio.dispatch() returns bigint language plpgsql security invoker set search_path='' as $$
declare token text;request_id bigint;
begin
 update render_studio.jobs set state='failed',error='LEASE_EXPIRED_RETRY_MANUALLY',updated_at=now() where state='processing' and lease_until<now();
 if not exists(select 1 from render_studio.jobs where state='queued') then return null;end if;
 select setting_value into token from public.private_runtime_settings where setting_key='order_brief_worker_token';
 if coalesce(token,'')='' then return null;end if;
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/render-template-ai',headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',token),body:='{"action":"run"}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end $$;
revoke all on function render_studio.dispatch() from public,anon,authenticated;
grant execute on function render_studio.dispatch() to service_role;
select cron.schedule('icetak-render-template-ai','* * * * *','select render_studio.dispatch()');
