create schema if not exists order_audit;
revoke all on schema order_audit from public,anon,authenticated;
create table public.shopee_clickup_audit_runs(
 id uuid primary key default gen_random_uuid(),run_key text not null unique,
 started_at timestamptz not null default now(),finished_at timestamptz,
 status text not null default 'running' check(status in ('running','healthy','issues','error')),
 summary jsonb not null default '{}',error_code text,
 notification_status text not null default 'none' check(notification_status in ('none','pending','sending','sent','uncertain','superseded')),
 notification_attempts integer not null default 0,next_notification_at timestamptz,
 notification_message text,notification_error text,provider_message_id text,notified_at timestamptz
);
create table public.shopee_clickup_audit_issues(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.shopee_clickup_audit_runs(id),
 kind text not null,shop_id text,order_sn text,title text not null,body text,url text,
 severity text not null default 'warning',status text not null default 'open' check(status in ('open','resolved')),
 details jsonb not null default '{}',occurred_at timestamptz not null default now(),resolved_at timestamptz,resolved_by text
);
create index on public.shopee_clickup_audit_issues(run_id);
create index on public.shopee_clickup_audit_issues(status,occurred_at desc);
alter table public.shopee_clickup_audit_runs enable row level security;
alter table public.shopee_clickup_audit_issues enable row level security;
revoke all on public.shopee_clickup_audit_runs,public.shopee_clickup_audit_issues from public,anon,authenticated;
grant all on public.shopee_clickup_audit_runs,public.shopee_clickup_audit_issues to service_role;
do $vault$ begin
 if not exists(select 1 from vault.secrets where name='shopee_clickup_audit_worker') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'shopee_clickup_audit_worker');
 end if;
end $vault$;

create function public.shopee_clickup_audit_runtime(p_action text,p_body jsonb default '{}',p_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare r public.shopee_clickup_audit_runs%rowtype; k text;v_id uuid;v_phone text;v_issue jsonb;v_count integer;v_key text;
begin
 if p_action='auth' then
  select decrypted_secret into k from vault.decrypted_secrets where name='shopee_clickup_audit_worker';
  return jsonb_build_object('ok',p_key is not null and k is not null and extensions.digest(p_key,'sha256')=extensions.digest(k,'sha256'));
 elsif p_action='start' then
  perform pg_advisory_xact_lock(hashtext('shopee_clickup_audit'));
  if exists(select 1 from public.shopee_clickup_audit_runs where status='running' and started_at>now()-interval '10 minutes') then return jsonb_build_object('busy',true); end if;
  v_key:=coalesce(nullif(p_body->>'run_key',''),'scheduled:'||floor(extract(epoch from now())/21600)::text);
  insert into public.shopee_clickup_audit_runs(run_key) values(v_key) on conflict(run_key) do nothing returning id into v_id;
  return jsonb_build_object('id',v_id,'duplicate',v_id is null);
 elsif p_action='finish' then
  select * into r from public.shopee_clickup_audit_runs where id=(p_body->>'id')::uuid and status='running' for update;
  if not found then return jsonb_build_object('ok',true,'duplicate',true); end if;
  if jsonb_array_length(coalesce(p_body->'issues','[]'))>2000 then raise exception 'audit_issue_limit'; end if;
  for v_issue in select value from jsonb_array_elements(coalesce(p_body->'issues','[]')) loop
   insert into public.shopee_clickup_audit_issues(run_id,kind,shop_id,order_sn,title,body,url,severity,details)
   values(r.id,left(v_issue->>'kind',100),v_issue->>'shop_id',v_issue->>'order_sn',coalesce(v_issue->>'title','Semak padanan Shopee / ClickUp'),
   v_issue->>'body',v_issue->>'url',case when v_issue->>'kind'='audit_unavailable' then 'critical' else 'warning' end,coalesce(v_issue->'detail','{}'));
  end loop;
  select count(*) into v_count from public.shopee_clickup_audit_issues where run_id=r.id;
  if coalesce(p_body->>'error','')='' then
   update public.shopee_clickup_audit_issues set status='resolved',resolved_at=now(),resolved_by='next_complete_audit'
   where run_id<>r.id and status='open';
  end if;
  update public.shopee_clickup_audit_runs set status=case when nullif(p_body->>'error','') is not null then 'error' when v_count>0 then 'issues' else 'healthy' end,
   finished_at=now(),summary=coalesce(p_body->'summary','{}'),error_code=p_body->>'error',
   notification_status=case when v_count>0 then 'pending' else 'none' end,
   notification_message=p_body->>'message',next_notification_at=case when v_count>0 then now() else null end where id=r.id;
  -- Replace obsolete pending alerts; keep provider-uncertain deliveries for review.
  update public.shopee_clickup_audit_runs set notification_status='superseded'
   where id<>r.id and notification_status='pending' and (coalesce(p_body->>'error','')='' or v_count>0);
  return jsonb_build_object('ok',true,'issues',v_count);
 elsif p_action='claim_notification' then
  select text_value into v_phone from public.whatsapp_settings where key='admin_order_notify_phone';
  if v_phone is null then raise exception 'admin_recipient_missing'; end if;
  select * into r from public.shopee_clickup_audit_runs a where notification_status='pending' and next_notification_at<=now()
   and exists(select 1 from public.shopee_clickup_audit_issues i where i.run_id=a.id and i.status='open')
   order by started_at desc limit 1 for update skip locked;
  if not found then return '{}'::jsonb; end if;
  update public.shopee_clickup_audit_runs set notification_status='sending',notification_attempts=notification_attempts+1,next_notification_at=now()+interval '5 minutes' where id=r.id;
  return jsonb_build_object('id',r.id,'phone',v_phone,'message',r.notification_message);
 elsif p_action='notification_result' then
  update public.shopee_clickup_audit_runs set notification_status=case when p_body->>'provider_id' is not null then 'sent' when p_body->>'uncertain'='true' then 'uncertain' else 'pending' end,
   provider_message_id=p_body->>'provider_id',notified_at=case when p_body->>'provider_id' is not null then now() else null end,
   notification_error=p_body->>'error',next_notification_at=now()+interval '15 minutes'
  where id=(p_body->>'id')::uuid and notification_status='sending';
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'invalid_audit_action';
end $fn$;
revoke execute on function public.shopee_clickup_audit_runtime(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.shopee_clickup_audit_runtime(text,jsonb,text) to service_role;

create function order_audit.dispatch(p_notify_only boolean default false) returns bigint language plpgsql security definer set search_path='' as $fn$
declare k text; rid bigint; r record;
begin
 for r in select id from public.shopee_clickup_audit_runs where status='running' and started_at<now()-interval '10 minutes' loop
  perform public.shopee_clickup_audit_runtime('finish',jsonb_build_object('id',r.id,'error','AUDIT_WORKER_TIMEOUT','issues',jsonb_build_array(jsonb_build_object('kind','audit_unavailable','title','Semakan Shopee / ClickUp tidak siap','body','Worker timeout. Admin perlu semak sambungan API.')),'message','⚠️ ICETAK: Semakan Shopee / ClickUp tidak siap (worker timeout). Sila semak Marketplace Operations dalam Admin V2.'));
 end loop;
 -- A timeout after provider submission must not cause a blind resend.
 update public.shopee_clickup_audit_runs set notification_status='uncertain',notification_error='DELIVERY_RESULT_UNKNOWN' where notification_status='sending' and next_notification_at<now();
 if p_notify_only and not exists(select 1 from public.shopee_clickup_audit_runs where notification_status='pending' and next_notification_at<=now()) then return null; end if;
 select decrypted_secret into k from vault.decrypted_secrets where name='shopee_clickup_audit_worker';
 rid:=net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/shopee-clickup-audit',headers:=jsonb_build_object('content-type','application/json','x-audit-worker-key',k),body:=jsonb_build_object('notify_only',p_notify_only),timeout_milliseconds:=180000);
 return rid;
end $fn$;
revoke all on function order_audit.dispatch(boolean) from public,anon,authenticated;
select cron.schedule('shopee-clickup-audit-every-six-hours','0 */6 * * *','select order_audit.dispatch(false);');
select cron.schedule('shopee-clickup-audit-delivery-retry','*/15 * * * *','select order_audit.dispatch(true);');
