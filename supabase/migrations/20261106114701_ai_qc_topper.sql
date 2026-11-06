create schema render_qc;
revoke all on schema render_qc from public,anon,authenticated;
grant usage on schema render_qc to service_role;
create table render_qc.settings(id boolean primary key default true check(id),enabled boolean not null default true,auto_release boolean not null default false,rollout_at timestamptz not null default now());
insert into render_qc.settings(id) values(true);
create table render_qc.runs(id uuid primary key default gen_random_uuid(),task_id text not null,job_key text not null unique,state text not null default 'queued' check(state in ('queued','processing','PASS','HOLD','FAIL','RETRY','released')),attempts int not null default 0,lease uuid,lease_until timestamptz,next_at timestamptz not null default now(),result jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index on render_qc.runs(state,next_at);
create table render_qc.events(id bigint generated always as identity primary key,run_id uuid references render_qc.runs(id),state text not null,result jsonb not null,created_at timestamptz not null default now());
alter table render_qc.settings enable row level security;
alter table render_qc.runs enable row level security;
alter table render_qc.events enable row level security;
grant all on all tables in schema render_qc to service_role;
grant usage,select on all sequences in schema render_qc to service_role;
create function render_qc.enqueue(p_task text,p_selected boolean default false) returns uuid language plpgsql security invoker set search_path='' as $$
declare j render_auto.jobs;r uuid;
begin
 select * into j from render_auto.jobs where task_id=p_task and state='completed' and attachment_id is not null;
 if not found or (not p_selected and j.updated_at<(select rollout_at from render_qc.settings where id)) then return null;end if;
 if j.brief->>'sku' not in ('YS0312','YS0315') then return null;end if;
 insert into render_qc.runs(task_id,job_key) values(p_task,md5(jsonb_build_array(j.task_id,j.source_hash,j.filename,j.attachment_id)::text)) on conflict(job_key) do nothing returning id into r;
 return r;
end $$;
create function render_qc.capture() returns trigger language plpgsql security definer set search_path='' as $$begin perform render_qc.enqueue(new.task_id);return new;end $$;
revoke all on function render_qc.capture() from public,anon,authenticated;
create trigger render_qc_after_render after update of state on render_auto.jobs for each row when(new.state='completed') execute function render_qc.capture();
create function public.icetak_ai_qc(p_action text,p_id uuid default null,p_lease uuid default null,p_data jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare r render_qc.runs; j render_auto.jobs; decision text;
begin
 if p_action='status' then return jsonb_build_object('settings',(select to_jsonb(s) from render_qc.settings s where id),'runs',(select coalesce(jsonb_agg(x),'[]') from(select id,task_id,state,attempts,result,updated_at from render_qc.runs order by updated_at desc limit 40)x));end if;
 if p_action='claim' then
  if not(select enabled from render_qc.settings where id) then return null;end if;
  select * into r from render_qc.runs where (state in ('queued','RETRY') or state='processing' and lease_until<now()) and next_at<=now() and attempts<3 order by created_at for update skip locked limit 1;
  if not found then return null;end if;
  update render_qc.runs set state='processing',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '6 minutes',updated_at=now() where id=r.id returning * into r;
  select * into j from render_auto.jobs where task_id=r.task_id;
  return jsonb_build_object('run',r,'job',j,'auto_release',(select auto_release from render_qc.settings where id));
 end if;
 if p_action='record' then
  decision=p_data->>'state';if decision not in ('PASS','HOLD','FAIL','RETRY','released') then raise exception 'INVALID_QC_STATE';end if;
  select * into r from render_qc.runs where id=p_id for update;
  if r.lease is distinct from p_lease or r.lease_until<now() or r.state<>'processing' then return jsonb_build_object('saved',false);end if;
  select * into j from render_auto.jobs where task_id=r.task_id;
  if r.job_key is distinct from md5(jsonb_build_array(j.task_id,j.source_hash,j.filename,j.attachment_id)::text) or j.state<>'completed' then decision='HOLD';p_data=jsonb_build_object('state','HOLD','reason','RENDER_CHANGED');end if;
  update render_qc.runs set state=decision,result=p_data,lease=null,lease_until=null,next_at=now()+interval '3 minutes',updated_at=now() where id=r.id;
  insert into render_qc.events(run_id,state,result) values(r.id,decision,p_data);
  return jsonb_build_object('saved',true,'state',decision);
 end if;
 raise exception 'INVALID_ACTION';
end $$;
revoke all on function public.icetak_ai_qc(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_ai_qc(text,uuid,uuid,jsonb) to service_role;
create function render_qc.dispatch() returns bigint language plpgsql security invoker set search_path='' as $$declare req bigint;t text;begin
 if not exists(select 1 from render_qc.settings where id and enabled) then return null;end if;
 if not exists(select 1 from render_qc.runs where (state in ('queued','RETRY') or state='processing' and lease_until<now()) and next_at<=now() and attempts<3) then return null;end if;
 select setting_value into t from public.private_runtime_settings where setting_key='order_brief_worker_token';
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/ai-qc',headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',t),body:='{"action":"run"}',timeout_milliseconds:=120000) into req;return req;
end $$;
revoke all on all functions in schema render_qc from public,anon,authenticated;
grant execute on all functions in schema render_qc to service_role;
select cron.schedule('icetak-ai-qc-topper','* * * * *','select render_qc.dispatch();');
create function public.icetak_ai_qc_source(p_task_id text) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('job',j,'brief',b,'template',t,'valid',
 b.state='completed' and b.brief->>'confirmed'='true' and j.source_hash=md5(jsonb_build_object('sku',b.brief->>'sku','wording',b.brief->>'wording','instruction',b.brief->>'instruction','pending',b.brief->'pending_change_ids','changes',b.brief->'change_detected','media',b.brief->'media_count','review',b.brief->'review_requested')::text)
 and (exists(select 1 from public.marketplace_orders m where m.order_sn=j.order_reference and m.payment_status='paid' and m.current_status in ('READY_TO_SHIP','PROCESSED','RETRY_SHIP')) or exists(select 1 from public.orders o where (o.order_no=j.order_reference or o.order_id=j.order_reference) and o.payment_status='paid' and lower(coalesce(o.status,'')) not in ('cancelled','canceled','complete','completed','shipped','delivered') and lower(coalesce(o.shipment_status_group,'')) not in ('shipped','in_transit','delivered','cancelled'))))
 from render_auto.jobs j join public.clickup_order_brief_jobs b using(task_id) join public.render_templates t on t.sku=j.brief->>'sku' where j.task_id=p_task_id;
$$;
revoke all on function public.icetak_ai_qc_source(text) from public,anon,authenticated;
grant execute on function public.icetak_ai_qc_source(text) to service_role;
