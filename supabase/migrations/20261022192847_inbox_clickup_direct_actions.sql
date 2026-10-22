-- Provider receipts only. Binary design files are never persisted in Postgres/Storage.
create table public.inbox_clickup_actions (
 request_id uuid primary key, task_id text not null check(task_id ~ '^[a-zA-Z0-9_-]{1,80}$'),
 actor_id uuid not null, summary_id uuid not null, canonical_id uuid not null,
 source_channel text not null check(source_channel in ('whatsapp','shopee')),
 kind text not null check(kind in ('upload','status')), fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<12000),
 state text not null default 'processing' check(state in ('processing','succeeded','failed','unknown')),
 step text not null default 'claimed', result jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(task_id,kind,fingerprint)
);
create index inbox_clickup_actions_order_idx on public.inbox_clickup_actions(canonical_id,summary_id,created_at desc);
alter table public.inbox_clickup_actions enable row level security;
revoke all on public.inbox_clickup_actions from public,anon,authenticated;
grant select,insert,update on public.inbox_clickup_actions to service_role;

create function public.icetak_claim_inbox_clickup_action(p_request uuid,p_task text,p_actor uuid,p_summary uuid,p_canonical uuid,p_channel text,p_kind text,p_fingerprint text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.inbox_clickup_actions;
begin
 if p_request is null or p_actor is null or p_summary is null or p_canonical is null or p_task !~ '^[a-zA-Z0-9_-]{1,80}$'
  or p_kind not in ('upload','status') or p_channel not in ('whatsapp','shopee') or p_fingerprint !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>=12000 then raise exception 'INVALID_REQUEST';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_task,7821));
 select * into existing from public.inbox_clickup_actions where request_id=p_request;
 if found then
  if existing.task_id<>p_task or existing.actor_id<>p_actor or existing.summary_id<>p_summary or existing.canonical_id<>p_canonical
   or existing.source_channel<>p_channel or existing.kind<>p_kind or existing.fingerprint<>p_fingerprint or existing.payload<>p_payload then raise exception 'REQUEST_CONFLICT';end if;
  if existing.state='failed' and (existing.step in ('claimed','attachment_rejected','status_rejected') or existing.step='comment_rejected' and existing.result->'attachment'->>'id' is null) then
   update public.inbox_clickup_actions set state='processing',updated_at=now() where request_id=p_request returning * into existing;
   return jsonb_build_object('claimed',true,'receipt',to_jsonb(existing));
  end if;
  return jsonb_build_object('claimed',false,'receipt',to_jsonb(existing));
 end if;
 select * into existing from public.inbox_clickup_actions where task_id=p_task and kind=p_kind and fingerprint=p_fingerprint;
 if found then
  -- Only the same authenticated staff/context may obtain a replay receipt.
  if existing.actor_id<>p_actor or existing.summary_id<>p_summary or existing.canonical_id<>p_canonical then raise exception 'REQUEST_CONFLICT';end if;
  return jsonb_build_object('claimed',false,'receipt',to_jsonb(existing));
 end if;
 if not exists(select 1 from public.ai_order_work_source w cross join lateral jsonb_array_elements(w.production_tasks)t
  where w.id=p_canonical and w.kind=case when p_channel='shopee' then 'shopee' else 'icetak' end and t->>'id'=p_task) then raise exception 'INVALID_TASK';end if;
 if exists(select 1 from public.inbox_clickup_actions where task_id=p_task and state='processing' and updated_at>now()-interval '2 minutes')
  or exists(select 1 from public.task_clickup_actions where task_id=p_task and state='processing' and updated_at>now()-interval '2 minutes') then raise exception 'TASK_BUSY';end if;
 insert into public.inbox_clickup_actions(request_id,task_id,actor_id,summary_id,canonical_id,source_channel,kind,fingerprint,payload)
 values(p_request,p_task,p_actor,p_summary,p_canonical,p_channel,p_kind,p_fingerprint,p_payload) returning * into existing;
 return jsonb_build_object('claimed',true,'receipt',to_jsonb(existing));
end $$;
revoke all on function public.icetak_claim_inbox_clickup_action(uuid,text,uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_claim_inbox_clickup_action(uuid,text,uuid,uuid,uuid,text,text,text,jsonb) to service_role;

create function public.icetak_resume_inbox_clickup_comment(p_request uuid,p_actor uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.inbox_clickup_actions;
begin
 select * into r from public.inbox_clickup_actions where request_id=p_request and actor_id=p_actor;
 if not found then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(r.task_id,7821));
 update public.inbox_clickup_actions set state='processing',step='comment',updated_at=now()
 where request_id=p_request and actor_id=p_actor and kind='upload' and result->'attachment'->>'id' is not null
  and step in ('attachment','attachment_saved','comment_rejected')
  and (state in ('failed','unknown') or state='processing' and updated_at<now()-interval '2 minutes');
 return found;
end $$;
revoke all on function public.icetak_resume_inbox_clickup_comment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icetak_resume_inbox_clickup_comment(uuid,uuid) to service_role;

create or replace function public.icetak_claim_task_clickup_action(p_request uuid,p_task text,p_actor text,p_kind text,p_fingerprint text,p_payload jsonb)
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
 if exists(select 1 from public.inbox_clickup_actions where task_id=p_task and state='processing' and updated_at>now()-interval '2 minutes') then raise exception 'TASK_ACTION_BUSY'; end if;
 insert into public.task_clickup_actions(request_id,task_id,actor,kind,fingerprint,payload)
 values(p_request,p_task,p_actor,p_kind,p_fingerprint,p_payload) returning * into existing;
 return jsonb_build_object('claimed',true,'receipt',to_jsonb(existing));
end $fn$;

notify pgrst,'reload schema';
