-- Designer writes are explicit and separate from native work and fulfillment.
create table public.task_clickup_actions (
 request_id uuid primary key, task_id text not null, actor text not null,
 kind text not null check(kind in ('status','comment')), fingerprint text not null,
 payload jsonb not null, state text not null default 'processing' check(state in ('processing','succeeded','failed','unknown')),
 step text not null default 'claimed', result jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(task_id,kind,fingerprint)
);
create index task_clickup_actions_task_idx on public.task_clickup_actions(task_id,created_at desc);
alter table public.task_clickup_actions enable row level security;
revoke all on public.task_clickup_actions from public,anon,authenticated;
grant select,insert,update on public.task_clickup_actions to service_role;

create function public.icetak_claim_task_clickup_action(p_request uuid,p_task text,p_actor text,p_kind text,p_fingerprint text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare existing public.task_clickup_actions; source public.ai_clickup_work_snapshots;
begin
 if not exists(select 1 from public.admin_users a left join public.admin_permissions p using(username)
  where a.username=p_actor and a.is_active and (a.role='owner' or coalesce(p.permissions,'{}') && array['edit_order','approve_production','manage_admins'])) then raise exception 'WORK_PERMISSION_REQUIRED'; end if;
 if p_kind not in ('status','comment') or p_fingerprint !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_ACTION'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_task,7821));
 select * into existing from public.task_clickup_actions where request_id=p_request;
 if found then
  if existing.task_id<>p_task or existing.actor<>p_actor or existing.kind<>p_kind or existing.fingerprint<>p_fingerprint or existing.payload<>p_payload then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('claimed',false,'receipt',to_jsonb(existing));
 end if;
 select * into existing from public.task_clickup_actions where task_id=p_task and kind=p_kind and fingerprint=p_fingerprint;
 if found then raise exception 'DUPLICATE_ACTION'; end if;
 select * into source from public.ai_clickup_work_snapshots where task_id=p_task;
 if not found or source.list_id<>'18375902' or lower(source.clickup_status) in ('complete','closed','cancelled','canceled','prospect','lain2') then raise exception 'TASK_NOT_ACTIVE'; end if;
 if exists(select 1 from public.clickup_webhook_events e where e.task_id=p_task and lower(e.event_type) in ('taskdeleted','task_deleted') and e.received_at>=source.observed_at) then raise exception 'TASK_NOT_ACTIVE'; end if;
 if p_kind='comment' and nullif(p_payload->>'file_id','') is not null and not exists(select 1 from public.task_workspace_files f where f.id::text=p_payload->>'file_id' and f.task_id=p_task) then raise exception 'INVALID_TASK_FILE'; end if;
 if exists(select 1 from public.task_clickup_actions where task_id=p_task and state='processing' and updated_at>now()-interval '2 minutes') then raise exception 'TASK_ACTION_BUSY'; end if;
 insert into public.task_clickup_actions(request_id,task_id,actor,kind,fingerprint,payload)
 values(p_request,p_task,p_actor,p_kind,p_fingerprint,p_payload) returning * into existing;
 return jsonb_build_object('claimed',true,'receipt',to_jsonb(existing));
end $fn$;
revoke all on function public.icetak_claim_task_clickup_action(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_claim_task_clickup_action(uuid,text,text,text,text,jsonb) to service_role;
