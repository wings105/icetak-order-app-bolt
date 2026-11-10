create schema if not exists acrylic_auto;
revoke all on schema acrylic_auto from public,anon,authenticated;
create table acrylic_auto.settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false,model text not null default 'gpt-image-2.5-sunburst',daily_limit integer not null default 20 check(daily_limit between 1 and 100),updated_at timestamptz not null default now(),updated_by uuid);
insert into acrylic_auto.settings(singleton) values(true);
create table acrylic_auto.jobs(task_id text primary key,source_token text not null,brief jsonb not null,eligible_at timestamptz not null,due_at timestamptz,state text not null default 'queued' check(state in ('queued','review','uncertain','completed','skipped')),stage text not null default 'prepare',data jsonb not null default '{}'::jsonb,attempts integer not null default 0,last_attempt_at timestamptz,next_attempt_at timestamptz not null default now(),lease uuid,lease_until timestamptz,last_error text not null default '',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table acrylic_auto.calls(id uuid primary key default gen_random_uuid(),task_id text not null,source_token text not null,created_at timestamptz not null default now());
create index on acrylic_auto.jobs(state,next_attempt_at,last_attempt_at);
alter table acrylic_auto.settings enable row level security;
alter table acrylic_auto.jobs enable row level security;
alter table acrylic_auto.calls enable row level security;
create function acrylic_auto.source(p_task text) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('brief',j.brief,'source_token',md5(jsonb_build_object('wording',j.brief->'wording','units',j.brief->'units','references',j.brief->'references','instruction',j.brief->'instruction','changed',j.brief->'content_changed_at','updates',j.brief->'message_updates','pending',j.brief->'pending_change_ids','default',j.brief->'default_design_reference','confirmed',r.confirmed_at)::text),'eligible_at',greatest(r.confirmed_at,j.completed_at,(j.brief->>'content_changed_at')::timestamptz)+interval '3 minutes')
 from public.clickup_order_brief_jobs j join public.clickup_autobrief_routes r using(task_id) join public.ai_clickup_work_snapshots s using(task_id)
 where j.task_id=p_task and r.profile='acrylic' and lower(btrim(s.clickup_status))='acrylic' and j.state='completed' and j.brief->>'ready'='true' and j.brief->>'confirmed'='true' and j.brief->>'state'='BRIEF_READY' and r.confirmed_at is not null and j.completed_at is not null
 and coalesce(jsonb_array_length(j.brief->'conflicts'),0)=0 and coalesce(jsonb_array_length(j.brief->'missing'),0)=0 and coalesce(jsonb_array_length(j.brief->'pending_change_ids'),0)=0;
$$;
create function public.icetak_acrylic_auto_settings(p_enabled boolean default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role text; result jsonb;
begin
 select role into v_role from public.admin_users where auth_user_id=auth.uid() and is_active=true;
 if v_role is null then raise exception 'ADMIN_REQUIRED';end if;
 if p_enabled is not null then
  if v_role not in ('owner','admin') then raise exception 'OWNER_OR_ADMIN_REQUIRED';end if;
  update acrylic_auto.settings set enabled=p_enabled,updated_at=now(),updated_by=auth.uid() where singleton;
 end if;
 select jsonb_build_object('enabled',s.enabled,'model',s.model,'delay_seconds',180,'daily_limit',s.daily_limit,'can_manage',v_role in ('owner','admin'),'used_today',(select count(*) from acrylic_auto.calls where created_at>=date_trunc('day',now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'),'counts',(select coalesce(jsonb_object_agg(state,n),'{}'::jsonb) from (select state,count(*) n from acrylic_auto.jobs group by state)x),'recent',(select coalesce(jsonb_agg(x),'[]'::jsonb) from(select task_id,state,stage,last_error,updated_at from acrylic_auto.jobs order by updated_at desc limit 5)x),'updated_at',s.updated_at) into result from acrylic_auto.settings s where singleton;
 return result;
end $$;
revoke all on function public.icetak_acrylic_auto_settings(boolean) from public,anon;
grant execute on function public.icetak_acrylic_auto_settings(boolean) to authenticated;
create function public.icetak_acrylic_auto_worker(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s acrylic_auto.settings; j acrylic_auto.jobs; c jsonb; v jsonb; t text; patch jsonb;
begin
 if p_action='config' then select * into s from acrylic_auto.settings where singleton;return to_jsonb(s)-'updated_by';end if;
 if p_action='source' then return acrylic_auto.source(p_data->>'task_id');end if;
 if p_action='sync' then
  for c in select value from jsonb_array_elements(p_data->'candidates') loop
   t:=c->>'task_id';if t !~ '^[a-zA-Z0-9_-]{1,80}$' then continue;end if;
   v:=acrylic_auto.source(t);if v is null then continue;end if;
   insert into acrylic_auto.jobs(task_id,source_token,brief,eligible_at,due_at) values(t,v->>'source_token',v->'brief',(v->>'eligible_at')::timestamptz,nullif(c->>'due_at','')::timestamptz)
   on conflict(task_id) do update set due_at=excluded.due_at;
   update acrylic_auto.jobs set source_token=v->>'source_token',brief=v->'brief',eligible_at=(v->>'eligible_at')::timestamptz,state='queued',stage='prepare',data='{}',attempts=0,last_error='',next_attempt_at=now(),updated_at=now()
    where task_id=t and source_token<>v->>'source_token' and data->>'generation_started_at' is null and data->>'storage_path' is null and data->>'attachment_id' is null and (lease_until is null or lease_until<now());
  end loop;return jsonb_build_object('ok',true);
 end if;
 if p_action='claim' then
  select * into s from acrylic_auto.settings where singleton for update;
  if not s.enabled or exists(select 1 from acrylic_auto.jobs where lease_until>now()) then return null;end if;
  select * into j from acrylic_auto.jobs where state='queued' and eligible_at<=now() and next_attempt_at<=now() and (lease_until is null or lease_until<now()) order by last_attempt_at asc nulls first,due_at asc nulls last,created_at for update skip locked limit 1;
  if not found then return null;end if;
  update acrylic_auto.jobs set lease=gen_random_uuid(),lease_until=now()+interval '10 minutes',last_attempt_at=now(),updated_at=now() where task_id=j.task_id returning * into j;
  return to_jsonb(j);
 end if;
 select * into j from acrylic_auto.jobs where task_id=p_data->>'task_id' and lease=(p_data->>'lease')::uuid and lease_until>now() for update;
 if not found then raise exception 'LEASE_LOST';end if;
 if p_action='reserve' then
  select * into s from acrylic_auto.settings where singleton for update;
  if not s.enabled then return jsonb_build_object('ok',false,'reason','DISABLED');end if;
  if j.data->>'generation_started_at' is not null then return jsonb_build_object('ok',false,'reason','GENERATION_ALREADY_STARTED');end if;
  if (select count(*) from acrylic_auto.calls where created_at>=date_trunc('day',now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur')>=s.daily_limit then return jsonb_build_object('ok',false,'reason','DAILY_LIMIT');end if;
  insert into acrylic_auto.calls(task_id,source_token) values(j.task_id,j.source_token);
  update acrylic_auto.jobs set data=data||jsonb_build_object('generation_started_at',now()),updated_at=now() where task_id=j.task_id;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='record' then
  patch:=coalesce(p_data->'patch','{}'::jsonb);
  update acrylic_auto.jobs set data=data||coalesce(patch->'data','{}'::jsonb),state=coalesce(patch->>'state',state),stage=coalesce(patch->>'stage',stage),last_error=coalesce(patch->>'error',''),attempts=attempts+case when patch->>'retry'='true' then 1 else 0 end,next_attempt_at=case when patch->>'retry'='true' then now()+interval '10 minutes' else now() end,lease=case when patch->>'release'='false' then lease else null end,lease_until=case when patch->>'release'='false' then lease_until else null end,updated_at=now() where task_id=j.task_id returning * into j;
  if j.attempts>=3 and j.state='queued' then update acrylic_auto.jobs set state='review',last_error='RETRY_LIMIT: '||last_error where task_id=j.task_id;end if;
  return jsonb_build_object('ok',true,'state',j.state,'stage',j.stage);
 end if;
 raise exception 'UNKNOWN_ACTION';
end $$;
revoke all on function public.icetak_acrylic_auto_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_acrylic_auto_worker(text,jsonb) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('acrylic-ai-output','acrylic-ai-output',false,20971520,array['image/png']) on conflict(id) do nothing;
create function acrylic_auto.dispatch() returns bigint language plpgsql security definer set search_path='' as $$
declare t text; r bigint;
begin
 if not (select enabled from acrylic_auto.settings where singleton) then return null;end if;
 if exists(select 1 from acrylic_auto.jobs where lease_until>now()) then return null;end if;
 select setting_value into t from public.private_runtime_settings where setting_key='order_brief_worker_token';
 if t is null then return null;end if;
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/acrylic-auto-image',body:='{"action":"run"}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',t),timeout_milliseconds:=300000) into r;return r;
end $$;
revoke all on all functions in schema acrylic_auto from public,anon,authenticated;
select cron.schedule('icetak-acrylic-auto-image','* * * * *','select acrylic_auto.dispatch();');
