-- Queue remains in integration_outbox so existing admin controls keep working.
-- provider='activepieces' is a legacy storage discriminator, not a runtime dependency.
insert into public.system_settings(key,value) values('native_clickup_integration','{"creation_enabled":false,"engine":"icetak"}') on conflict(key) do nothing;
create table if not exists clickup_gate.native_events (
 event_key text primary key,
 task_id text not null,
 payload jsonb not null,
 created_at timestamptz not null default now(),
 processed_at timestamptz
);
alter table clickup_gate.native_events enable row level security;
revoke all on clickup_gate.native_events from public,anon,authenticated;
create index if not exists native_events_pending_task on clickup_gate.native_events(task_id,created_at) where processed_at is null;

create or replace function public.icetak_native_clickup_ready(p_order_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select public.icetak_order_is_production_ready(o) from public.orders o where id=p_order_id),false);
$$;
revoke all on function public.icetak_native_clickup_ready(uuid) from public,anon,authenticated;
grant execute on function public.icetak_native_clickup_ready(uuid) to service_role;

create or replace function public.icetak_native_clickup_rate_limited(p_event_id uuid,p_component_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.integration_outbox o join clickup_gate.component_dispatches d on d.outbox_id=o.id where o.id=p_event_id and d.component_id=p_component_id and o.status='processing') then return; end if;
 delete from clickup_gate.component_dispatches where component_id=p_component_id and outbox_id=p_event_id;
 update public.integration_outbox set status='retry',locked_at=null,next_attempt_at=now()+interval '1 minute',last_error='clickup_rate_limited' where id=p_event_id;
end $$;
revoke all on function public.icetak_native_clickup_rate_limited(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icetak_native_clickup_rate_limited(uuid,uuid) to service_role;

create or replace function clickup_gate.dispatch_native_creation() returns bigint
language plpgsql security definer set search_path='' as $$
declare k text; rid bigint;
begin
 if not exists(select 1 from public.system_settings where key='native_clickup_integration' and value->>'creation_enabled'='true') then return null; end if;
 if not exists(select 1 from public.integration_outbox where provider='activepieces' and event_type='clickup.production.create' and status in ('pending','retry','processing','failed')) then return null; end if;
 select decrypted_secret into k from vault.decrypted_secrets where name='clickup_order_gate_worker';
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-production-outbox',headers:=jsonb_build_object('content-type','application/json','x-gate-worker-key',k),body:='{}',timeout_milliseconds:=55000) into rid;
 return rid;
end $$;
revoke all on function clickup_gate.dispatch_native_creation() from public,anon,authenticated;
select cron.schedule('icetak-native-clickup-create','* * * * *','select clickup_gate.dispatch_native_creation();');
select cron.schedule('icetak-native-clickup-events-retention','37 19 * * *', $$delete from clickup_gate.native_events where processed_at < now()-interval '14 days'$$);

CREATE OR REPLACE FUNCTION public.clickup_order_gate_auto(p_action text, p_body jsonb DEFAULT '{}'::jsonb, p_secret text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b jsonb; wid text; tid text; o text; r public.clickup_order_creation_registry%rowtype; rows jsonb; n integer; v_tasks jsonb; hash text; v_expected integer;
begin
 if p_action='worker_auth' then
  return jsonb_build_object('ok',exists(select 1 from vault.decrypted_secrets where name='clickup_order_gate_worker' and decrypted_secret=coalesce(p_secret,'')));
 elsif p_action='enqueue' then
  if length(coalesce(p_body->>'raw',''))>32768 then return jsonb_build_object('ok',false,'http_status',413); end if;
  b:=(p_body->>'raw')::jsonb;wid:=b->>'webhook_id';tid:=b->>'task_id';
  if tid !~ '^[a-zA-Z0-9_-]{1,80}$' or tid is null then return jsonb_build_object('ok',false,'http_status',400); end if;
  if not exists(select 1 from clickup_gate.native_webhooks where id=wid and encode(extensions.hmac(p_body->>'raw',secret,'sha256'),'hex')=lower(coalesce(p_body->>'signature',''))) then return jsonb_build_object('ok',false,'http_status',401); end if;
  insert into clickup_gate.native_events(event_key,task_id,payload)
  values(encode(extensions.digest(coalesce(b->>'task_id','')||':'||coalesce(b->>'event','')||':'||coalesce((b->'history_items')::text,p_body->>'raw'),'sha256'),'hex'),tid,b)
  on conflict(event_key) do nothing;
  update clickup_gate.native_webhooks set last_received_at=now(),received_count=received_count+1 where id=wid;
  insert into clickup_gate.task_queue(task_id,event_type,run_after) values(tid,b->>'event',now()+interval '15 seconds')
   on conflict(task_id) do update set event_type=excluded.event_type,last_at=now(),run_after=least(clickup_gate.task_queue.first_at+interval '60 seconds',now()+interval '15 seconds');
  return jsonb_build_object('ok',true,'queued',true);
 elsif p_action='work' then
  with picked as (select task_id from clickup_gate.task_queue where run_after<=now() and attempts<8 order by run_after limit 12 for update skip locked),
  leased as (update clickup_gate.task_queue q set run_after=now()+interval '2 minutes',attempts=attempts+1 from picked p where q.task_id=p.task_id returning q.task_id,q.event_type,q.last_at)
  select coalesce(jsonb_agg(to_jsonb(leased)),'[]') into rows from leased;
  with picked as (select order_id from public.clickup_order_creation_registry where auto_verify and status<>'task_complete_created' and next_verify_at<=now() and auto_attempts<30 order by next_verify_at limit 5 for update skip locked),
  leased as (update public.clickup_order_creation_registry g set next_verify_at=now()+interval '2 minutes',auto_attempts=auto_attempts+1 from picked p where g.order_id=p.order_id returning g.order_id,g.expected_tasks),
  products as (select l.order_id,l.expected_tasks,(select jsonb_agg(jsonb_build_object('sku',x->>'prodsku','variation',x->>'variationname','variation_sku',x->>'variationsku')) from jsonb_array_elements(case when jsonb_typeof(m.raw_detail->'product')='array' then m.raw_detail->'product' else '[]'::jsonb end) x) products from leased l left join public.marketplace_orders m on m.provider='shopee' and m.order_sn=l.order_id)
  select jsonb_build_object('tasks',rows,'orders',coalesce(jsonb_agg(to_jsonb(pj)),'[]')) into b from products pj;
  return b;
 elsif p_action='task_result' then
  tid:=p_body->>'task_id';o:=p_body->>'order_id';
  if p_body->>'last_at' is not null and exists(select 1 from clickup_gate.task_queue where task_id=tid and last_at>(p_body->>'last_at')::timestamptz) then
    update clickup_gate.task_queue set attempts=0,run_after=now() where task_id=tid;
    return jsonb_build_object('ok',true,'newer_event_pending',true);
  end if;
  if p_body->>'event_type'='taskDeleted' then
   delete from clickup_gate.task_queue where task_id=tid;
   update public.clickup_order_creation_registry g set status='needs_check',last_error='REGISTERED_TASK_REMOVED',completed_at=null,next_verify_at=now(),auto_attempts=0,updated_at=now() where exists(select 1 from jsonb_each(g.tasks) e where e.value->>'task_id'=tid);
   return jsonb_build_object('ok',true);
  end if;
  if p_body->>'error' is not null then
   update clickup_gate.task_queue set last_error=left(p_body->>'error',100),run_after=now()+interval '2 minutes' where task_id=tid;
   return jsonb_build_object('ok',true);
  end if;
  if exists(select 1 from clickup_gate.native_events where task_id=tid and processed_at is null) then
   update clickup_gate.task_queue set run_after=now(),attempts=0 where task_id=tid;
   return jsonb_build_object('ok',true,'pending_events',true);
  end if;
  delete from clickup_gate.task_queue where task_id=tid;
  if o ~ '^[0-9]{6}[A-Z0-9]{6,20}$' then
   select * into r from public.clickup_order_creation_registry where order_id=o for update;
   if found then
    if p_body->>'event_type'='taskDeleted' then
     update public.clickup_order_creation_registry set status='needs_check',last_error='REGISTERED_TASK_REMOVED',next_verify_at=now(),auto_attempts=0,completed_at=null where order_id=o;
    else
     update public.clickup_order_creation_registry set observed_tasks=jsonb_set(observed_tasks,array[tid],jsonb_build_object('confirmed_at',now(),'source','native_clickup_webhook'),true),
      next_verify_at=case when status='task_complete_created' and exists(select 1 from jsonb_each(tasks) where value->>'task_id'=tid) then next_verify_at else now() end,
      auto_attempts=case when status='task_complete_created' and exists(select 1 from jsonb_each(tasks) where value->>'task_id'=tid) then auto_attempts else 0 end,
      status=case when status='task_complete_created' and not exists(select 1 from jsonb_each(tasks) where value->>'task_id'=tid) then 'partial' else status end,
      updated_at=now() where order_id=o;
    end if;
   end if;
  end if;
  return jsonb_build_object('ok',true);
 elsif p_action='events_for_task' then
  return jsonb_build_object('events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at),'[]') from (select event_key,payload,created_at from clickup_gate.native_events where task_id=p_body->>'task_id' and processed_at is null order by created_at limit 100) e));
 elsif p_action='event_done' then
  update clickup_gate.native_events set processed_at=now() where event_key=p_body->>'event_key' or event_key in (select jsonb_array_elements_text(coalesce(p_body->'event_keys','[]'::jsonb)));
  return jsonb_build_object('ok',true);
 elsif p_action='snapshot' then
  o:=p_body->>'order_id';select * into r from public.clickup_order_creation_registry where order_id=o for update;
  if not found then return jsonb_build_object('ok',false); end if;
  if p_body->>'error' is not null then
   update public.clickup_order_creation_registry set auto_checked_at=now(),last_error=left(p_body->>'error',150),next_verify_at=now()+interval '2 minutes',status=case when auto_attempts>=30 then 'needs_check' else status end where order_id=o;
   return jsonb_build_object('ok',true,'verified',false);
  end if;
  v_tasks:=coalesce(p_body->'tasks','{}');select count(*) into n from jsonb_each(v_tasks);
  select jsonb_array_length(raw_detail->'product') into v_expected from public.marketplace_orders where provider='shopee' and order_sn=o and jsonb_typeof(raw_detail->'product')='array' limit 1;
  v_expected:=coalesce(r.expected_tasks,v_expected);
  hash:=encode(extensions.digest(coalesce(p_body->>'fingerprint',''),'sha256'),'hex');
  if n>0 and v_expected=n and p_body->>'coverage_ok'='true' and r.snapshot_hash=hash and r.snapshot_seen_at<=now()-interval '60 seconds' and r.claimed_at<=now()-interval '90 seconds' then
   update public.clickup_order_creation_registry set tasks=v_tasks,expected_tasks=v_expected,
    status='task_complete_created',completed_at=now(),flow_finished_at=coalesce(flow_finished_at,now()),auto_checked_at=now(),last_error=null,confirmation_source='automatic_clickup_api',updated_at=now()
    where order_id=o;
  else
   update public.clickup_order_creation_registry set tasks=coalesce(p_body->'tasks','{}'),expected_tasks=v_expected,auto_checked_at=now(),
    snapshot_seen_at=case when snapshot_hash=hash then snapshot_seen_at else now() end,snapshot_hash=hash,
    status=case when (v_expected is not null and n>v_expected) or auto_attempts>=30 then 'needs_check' when n>0 then 'partial' else 'processing' end,
    completed_at=null,last_error=case when v_expected is null then 'WAITING_ORDER_DETAIL' when n>v_expected then 'EXTRA_TASKS_DETECTED' when n=0 then 'WAITING_CLICKUP_TASKS' when p_body->>'coverage_ok'<>'true' then 'ITEM_MATCH_PENDING' else null end,
    next_verify_at=now()+interval '1 minute',updated_at=now() where order_id=o;
  end if;
  select status into o from public.clickup_order_creation_registry where order_id=r.order_id;
  return jsonb_build_object('ok',true,'status',o,'task_count',n,'expected_tasks',v_expected);
 end if;
 return jsonb_build_object('ok',false,'error','INVALID_ACTION');
end $function$

