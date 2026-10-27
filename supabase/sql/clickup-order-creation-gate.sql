create schema if not exists clickup_gate;
revoke all on schema clickup_gate from public, anon, authenticated;
create table clickup_gate.config(key text primary key, secret_hash text not null);
alter table clickup_gate.config enable row level security;
create table public.clickup_order_creation_registry(
 order_id text primary key check(order_id ~ '^[0-9]{6}[A-Z0-9]{6,20}$'),
 status text not null default 'processing' check(status in ('processing','partial','task_complete_created','needs_check')),
 run_id uuid not null default gen_random_uuid(),
 claimed_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
 duplicate_count integer not null default 0,
 expected_tasks integer check(expected_tasks between 1 and 100),
 tasks jsonb not null default '{}'::jsonb, observed_tasks jsonb not null default '{}'::jsonb,
 flow_finished_at timestamptz, completed_at timestamptz, last_error text,
 updated_at timestamptz not null default now()
);
alter table public.clickup_order_creation_registry enable row level security;
revoke all on public.clickup_order_creation_registry from public,anon,authenticated;
grant select,insert,update on public.clickup_order_creation_registry to service_role;

create function clickup_gate.recalculate(p_order text) returns void language plpgsql set search_path='' as $$
declare r public.clickup_order_creation_registry%rowtype; n integer; confirmed integer;
begin
 select * into r from public.clickup_order_creation_registry where order_id=p_order for update;
 if not found then return; end if;
 select count(*),count(*) filter(where value->>'confirmed_at' is not null) into n,confirmed from jsonb_each(r.tasks);
 update public.clickup_order_creation_registry set
 status=case when r.status='needs_check' then 'needs_check'
  when r.flow_finished_at is not null and r.expected_tasks=n and confirmed=n then 'task_complete_created'
  when n>0 then 'partial' else 'processing' end,
 completed_at=case when r.status<>'needs_check' and r.flow_finished_at is not null and r.expected_tasks=n and confirmed=n then coalesce(r.completed_at,now()) else null end,
 updated_at=now() where order_id=p_order;
end $$;
revoke all on function clickup_gate.recalculate(text) from public,anon,authenticated;

create function public.clickup_order_gate(p_action text,p_body jsonb,p_secret text,p_verified boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o text:=upper(btrim(coalesce(p_body->>'order_id',p_body->>'orderno','')));
 r public.clickup_order_creation_registry%rowtype; inserted text; k text; tid text; n integer; v jsonb;
begin
 if not exists(select 1 from clickup_gate.config where key='make' and secret_hash=encode(extensions.digest(coalesce(p_secret,''),'sha256'),'hex')) then
  return jsonb_build_object('ok',false,'error','UNAUTHORIZED','http_status',401);
 end if;
 if p_action='authorize' then return jsonb_build_object('ok',true); end if;
 if o !~ '^[0-9]{6}[A-Z0-9]{6,20}$' then return jsonb_build_object('ok',false,'error','INVALID_ORDER_ID','http_status',400); end if;
 if p_action='claim' then
  n:=nullif(p_body->>'expected_tasks','')::integer;
  if n is not null and (n<1 or n>100) then raise exception 'INVALID_EXPECTED_TASKS'; end if;
  insert into public.clickup_order_creation_registry(order_id,expected_tasks) values(o,n) on conflict(order_id) do nothing returning order_id into inserted;
  if inserted is null then
   update public.clickup_order_creation_registry set duplicate_count=duplicate_count+1,last_seen_at=now(),updated_at=now() where order_id=o returning * into r;
   return jsonb_build_object('ok',true,'order_id',o,'allow_create',false,'reason','order_already_claimed','status',r.status,'duplicate_count',r.duplicate_count,'needs_check',r.status<>'task_complete_created' and r.claimed_at<now()-interval '30 minutes');
  end if;
  select * into r from public.clickup_order_creation_registry where order_id=o;
  return jsonb_build_object('ok',true,'order_id',o,'allow_create',true,'run_id',r.run_id,'status',r.status);
 end if;
 select * into r from public.clickup_order_creation_registry where order_id=o for update;
 if not found then return jsonb_build_object('ok',false,'error','ORDER_NOT_CLAIMED','http_status',404); end if;
 if p_action='status' then
  return jsonb_build_object('ok',true,'order_id',o,'status',r.status,'expected_tasks',r.expected_tasks,'tasks',r.tasks,'flow_finished_at',r.flow_finished_at,'completed_at',r.completed_at,'duplicate_count',r.duplicate_count,'last_error',r.last_error);
 end if;
 if coalesce(p_body->>'run_id','')<>r.run_id::text then return jsonb_build_object('ok',false,'error','RUN_ID_MISMATCH','http_status',409); end if;
 if p_action='set_expected' or p_action='finish' then
  n:=coalesce(nullif(p_body->>'expected_tasks','')::integer,r.expected_tasks);
  if n is null or n<1 or n>100 then return jsonb_build_object('ok',false,'error','EXPECTED_TASKS_REQUIRED','http_status',400); end if;
  if r.expected_tasks is not null and r.expected_tasks<>n then return jsonb_build_object('ok',false,'error','EXPECTED_TASKS_CONFLICT','http_status',409); end if;
  if (select count(*) from jsonb_each(r.tasks))>n then return jsonb_build_object('ok',false,'error','TOO_MANY_TASKS','http_status',409); end if;
  update public.clickup_order_creation_registry set expected_tasks=n,flow_finished_at=case when p_action='finish' then coalesce(flow_finished_at,now()) else flow_finished_at end where order_id=o;
 elsif p_action='register_task' then
  k:=btrim(coalesce(p_body->>'task_key',''));tid:=btrim(coalesce(p_body->>'clickup_task_id',''));
  if k='' or length(k)>200 or tid !~ '^[a-zA-Z0-9_-]{1,80}$' then return jsonb_build_object('ok',false,'error','INVALID_TASK','http_status',400); end if;
  if not p_verified then return jsonb_build_object('ok',false,'error','CLICKUP_VERIFICATION_REQUIRED','http_status',409); end if;
  if r.tasks ? k and r.tasks#>>array[k,'task_id']<>tid then return jsonb_build_object('ok',false,'error','TASK_KEY_CONFLICT','http_status',409); end if;
  if exists(select 1 from jsonb_each(r.tasks) where key<>k and value->>'task_id'=tid) then return jsonb_build_object('ok',false,'error','TASK_ID_ALREADY_REGISTERED','http_status',409); end if;
  if not (r.tasks ? k) and r.expected_tasks is not null and (select count(*) from jsonb_each(r.tasks))>=r.expected_tasks then return jsonb_build_object('ok',false,'error','TOO_MANY_TASKS','http_status',409); end if;
  v:=jsonb_build_object('task_id',tid,'registered_at',coalesce(r.tasks#>array[k,'registered_at'],to_jsonb(now())),'confirmed_at',coalesce(r.tasks#>array[k,'confirmed_at'],to_jsonb(now())),'confirmed_source','clickup_api');
  update public.clickup_order_creation_registry set tasks=jsonb_set(tasks,array[k],v,true) where order_id=o;
 elsif p_action='fail' then
  update public.clickup_order_creation_registry set status='needs_check',last_error=left(coalesce(p_body->>'error','MAKE_FLOW_FAILED'),500),updated_at=now() where order_id=o;
  return jsonb_build_object('ok',true,'order_id',o,'status','needs_check','allow_create',false);
 else return jsonb_build_object('ok',false,'error','INVALID_ACTION','http_status',400);
 end if;
 perform clickup_gate.recalculate(o);
 select * into r from public.clickup_order_creation_registry where order_id=o;
 select count(*) into n from jsonb_each(r.tasks);
 return jsonb_build_object('ok',true,'order_id',o,'status',r.status,'expected_tasks',r.expected_tasks,'registered_tasks',n,'complete',r.status='task_complete_created');
exception when invalid_text_representation or numeric_value_out_of_range or check_violation then
 return jsonb_build_object('ok',false,'error','INVALID_INPUT','http_status',400);
end $$;
revoke all on function public.clickup_order_gate(text,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.clickup_order_gate(text,jsonb,text,boolean) to service_role;

create function clickup_gate.observe_event() returns trigger language plpgsql security definer set search_path='' as $$
declare fields jsonb; o text; r public.clickup_order_creation_registry%rowtype; item record;
begin
 if coalesce(new.list_id,'') not in ('18375902','901612769752') then return new; end if;
 if lower(new.event_type) in ('taskdeleted','taskmerged') then
  update public.clickup_order_creation_registry g set status='needs_check',last_error='REGISTERED_TASK_REMOVED',completed_at=null,updated_at=now()
   where exists(select 1 from jsonb_each(g.tasks) where value->>'task_id'=new.task_id);
  return new;
 end if;
 fields:=coalesce(new.raw_payload#>'{task,custom_fields}',new.raw_payload->'custom_fields',new.raw_payload#>'{data,task,custom_fields}',new.raw_payload#>'{data,custom_fields}');
 if jsonb_typeof(fields)='array' then
  select upper(btrim(value->>'value')) into o from jsonb_array_elements(fields) where value->>'id'='a8996f77-fcf9-4804-84bb-89f97905473d' limit 1;
 end if;
 if o is null and new.custom_field_id='a8996f77-fcf9-4804-84bb-89f97905473d' then o:=upper(btrim(case when jsonb_typeof(new.after_value)='string' then new.after_value#>>'{}' else new.after_value->>'value' end)); end if;
 if o is null then return new; end if;
 select * into r from public.clickup_order_creation_registry where order_id=o for update;
 if not found then return new; end if;
 update public.clickup_order_creation_registry set observed_tasks=jsonb_set(observed_tasks,array[new.task_id],jsonb_build_object('event_id',new.id,'confirmed_at',new.received_at),true),updated_at=now() where order_id=o;
 for item in select key,value from jsonb_each(r.tasks) where value->>'task_id'=new.task_id loop
  update public.clickup_order_creation_registry set tasks=jsonb_set(tasks,array[item.key],item.value||jsonb_build_object('webhook_seen_at',new.received_at,'webhook_event_id',new.id),true) where order_id=o;
 end loop;
 perform clickup_gate.recalculate(o);
 return new;
end $$;
revoke all on function clickup_gate.observe_event() from public,anon,authenticated;
create trigger clickup_order_gate_observe after insert on public.clickup_webhook_events for each row execute function clickup_gate.observe_event();
