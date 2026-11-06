create table render_qc.field_sync(task_id text not null,field_id uuid not null,option_id uuid not null,option_name text not null,source jsonb not null,revision int not null default 1,state text not null default 'queued' check(state in ('queued','processing','retry','synced','blocked','stale')),attempts int not null default 0,lease uuid,lease_until timestamptz,next_at timestamptz not null default now(),error text not null default '',updated_at timestamptz not null default now(),primary key(task_id,field_id));
alter table render_qc.field_sync enable row level security;
grant all on render_qc.field_sync to service_role;
create table render_qc.field_events(id bigint generated always as identity primary key,task_id text not null,field_id uuid not null,revision int not null,state text not null,detail text not null default '',created_at timestamptz not null default now());
alter table render_qc.field_events enable row level security;
grant all on render_qc.field_events to service_role;
grant usage,select on sequence render_qc.field_events_id_seq to service_role;
create function render_qc.queue_field(p_task text,p_kind text,p_state text default '',p_run uuid default null) returns boolean language plpgsql security invoker set search_path='' as $$
declare f uuid;o uuid;label text;j render_auto.jobs;r render_qc.runs;s jsonb;
begin
 select * into j from render_auto.jobs where task_id=p_task and state='completed' and attachment_id is not null;if not found then return false;end if;
 if p_kind='render' then f='01cec4ef-a30b-443d-a43a-9ab09835b78c';o='49c8b202-d985-4fa2-aae6-658ccca96433';label='Render ai';s=jsonb_build_object('kind','render','attachment_id',j.attachment_id,'source_hash',j.source_hash);
 elsif p_kind='qc' then
  select * into r from render_qc.runs where id=p_run and task_id=p_task;
  if not found or r.state<>p_state or exists(select 1 from render_qc.runs x where x.task_id=p_task and x.created_at>r.created_at) then return false;end if;
  if r.job_key<>md5(jsonb_build_array(j.task_id,j.source_hash,j.filename,j.attachment_id)::text)||':'||r.rules_version then return false;end if;
  f='4cdb78bd-4fc4-4fd6-a1dd-5b6b01ea4110';
  case p_state when 'PASS','released' then o='093279a0-80a5-49ea-bec8-a25981a87937';label='Ai QC pass';when 'HOLD' then o='60798603-fc52-43d3-91dd-b7e2e5396636';label='Ai QC hold';when 'FAIL' then o='1f772f47-060b-49f4-9241-f2b1f7fa7471';label='Ai QC fail';when 'RETRY' then o='9cccc7fb-0057-4c10-abd8-be6a416da06b';label='Ai QC retry';else return false;end case;
  s=jsonb_build_object('kind','qc','run_id',r.id,'attachment_id',j.attachment_id,'source_hash',j.source_hash);
 else raise exception 'INVALID_FIELD_KIND';end if;
 insert into render_qc.field_sync(task_id,field_id,option_id,option_name,source) values(p_task,f,o,label,s)
 on conflict(task_id,field_id) do update set option_id=excluded.option_id,option_name=excluded.option_name,source=excluded.source,revision=render_qc.field_sync.revision+1,state='queued',attempts=0,lease=null,lease_until=null,next_at=now(),error='',updated_at=now()
 where render_qc.field_sync.option_id is distinct from excluded.option_id or render_qc.field_sync.source is distinct from excluded.source;
 return true;
end $$;
create function render_qc.capture_field() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_table_name='jobs' then if new.state='completed' then perform render_qc.queue_field(new.task_id,'render');end if;
 elsif new.state in ('PASS','HOLD','FAIL','RETRY','released') then perform render_qc.queue_field(new.task_id,'qc',new.state,new.id);end if;
 return new;
end $$;
revoke all on function render_qc.capture_field() from public,anon,authenticated;
create trigger render_done_clickup_field after update of state on render_auto.jobs for each row when(new.state='completed') execute function render_qc.capture_field();
create trigger qc_done_clickup_field after update of state on render_qc.runs for each row when(new.state in ('PASS','HOLD','FAIL','RETRY','released')) execute function render_qc.capture_field();
create function public.icetak_designflow_sync(p_action text,p_task text default '',p_field uuid default null,p_revision int default null,p_lease uuid default null,p_data jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare r render_qc.field_sync;v boolean;j render_auto.jobs;q render_qc.runs;s text;
begin
 if p_action='claim' then
  select * into r from render_qc.field_sync where (state in ('queued','retry') or state='processing' and lease_until<now()) and next_at<=now() and attempts<5 order by updated_at for update skip locked limit 1;if not found then return null;end if;
  update render_qc.field_sync set state='processing',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now() where task_id=r.task_id and field_id=r.field_id returning * into r;return to_jsonb(r);
 end if;
 select * into r from render_qc.field_sync where task_id=p_task and field_id=p_field for update;
 if not found or r.revision is distinct from p_revision or r.lease is distinct from p_lease or r.lease_until<now() or r.state<>'processing' then return jsonb_build_object('valid',false,'saved',false);end if;
 select * into j from render_auto.jobs where task_id=r.task_id;
 v:=coalesce(j.state='completed' and j.attachment_id=r.source->>'attachment_id' and j.source_hash=r.source->>'source_hash',false);
 if r.source->>'kind'='qc' then
  select * into q from render_qc.runs where id=(r.source->>'run_id')::uuid;
  v:=v and q.state in ('PASS','HOLD','FAIL','RETRY','released') and not exists(select 1 from render_qc.runs x where x.task_id=r.task_id and x.created_at>q.created_at);
  v:=v and (case q.state when 'released' then 'Ai QC pass' else 'Ai QC '||lower(q.state) end)=r.option_name;
 end if;
 if p_action='check' then return jsonb_build_object('valid',coalesce(v,false));end if;
 if p_action<>'ack' then raise exception 'INVALID_SYNC_ACTION';end if;
 s:=case when not coalesce(v,false) then 'stale' when p_data->>'ok'='true' then 'synced' when r.attempts>=5 then 'blocked' else 'retry' end;
 update render_qc.field_sync set state=s,error=left(coalesce(p_data->>'error',''),180),lease=null,lease_until=null,next_at=now()+interval '1 minute',updated_at=now() where task_id=r.task_id and field_id=r.field_id;
 insert into render_qc.field_events(task_id,field_id,revision,state,detail) values(r.task_id,r.field_id,r.revision,s,left(coalesce(p_data->>'error',''),180));return jsonb_build_object('saved',true,'state',s);
end $$;
revoke all on function public.icetak_designflow_sync(text,text,uuid,int,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_designflow_sync(text,text,uuid,int,uuid,jsonb) to service_role;
create function render_qc.dispatch_fields() returns bigint language plpgsql security invoker set search_path='' as $$declare t text;r bigint;begin
 with expired as(update render_qc.field_sync set state='blocked',lease=null,lease_until=null,error='SYNC_ATTEMPTS_EXHAUSTED',updated_at=now() where state='processing' and lease_until<now() and attempts>=5 returning *) insert into render_qc.field_events(task_id,field_id,revision,state,detail) select task_id,field_id,revision,'blocked','SYNC_ATTEMPTS_EXHAUSTED' from expired;
 if not exists(select 1 from render_qc.field_sync where state in ('queued','retry','processing') and attempts<5 and next_at<=now() and coalesce(lease_until,'-infinity')<=now()) then return null;end if;
 select setting_value into t from public.private_runtime_settings where setting_key='order_brief_worker_token';
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-designflow-sync',headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',t),body:='{"action":"run"}',timeout_milliseconds:=110000) into r;return r;
end $$;
revoke all on function render_qc.queue_field(text,text,text,uuid),render_qc.dispatch_fields() from public,anon,authenticated;
grant execute on function render_qc.queue_field(text,text,text,uuid),render_qc.dispatch_fields() to service_role;
select cron.schedule('icetak-designflow-sync','* * * * *','select render_qc.dispatch_fields();');
