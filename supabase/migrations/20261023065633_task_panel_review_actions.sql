-- Extend existing private designer receipts; retain Inbox cross-surface locking.
alter table public.task_clickup_actions drop constraint task_clickup_actions_kind_check;
alter table public.task_clickup_actions add constraint task_clickup_actions_kind_check check(kind in ('status','comment','field'));

create or replace function public.icetak_claim_task_clickup_action(p_request uuid,p_task text,p_actor text,p_kind text,p_fingerprint text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare existing public.task_clickup_actions; source public.ai_clickup_work_snapshots;
begin
 if not exists(select 1 from public.admin_users a left join public.admin_permissions p using(username)
  where a.username=p_actor and a.is_active and (a.role='owner' or coalesce(p.permissions,'{}') && array['edit_order','approve_production','manage_admins'])) then raise exception 'WORK_PERMISSION_REQUIRED'; end if;
 if p_kind not in ('status','comment','field') or p_fingerprint !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_ACTION'; end if;
 if p_kind='field' and (p_payload->>'field_id' is distinct from '01cec4ef-a30b-443d-a43a-9ab09835b78c' or not (p_payload ? 'value') or not (p_payload ? 'expected_value')) then raise exception 'INVALID_FIELD'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_task,7821));
 select * into existing from public.task_clickup_actions where request_id=p_request;
 if found then
  if existing.task_id<>p_task or existing.actor<>p_actor or existing.kind<>p_kind or existing.fingerprint<>p_fingerprint or existing.payload<>p_payload then raise exception 'REQUEST_CONFLICT'; end if;
  if existing.state='failed' and existing.step in ('claimed','status_rejected','field_rejected') then
   update public.task_clickup_actions set state='processing',updated_at=now() where request_id=p_request returning * into existing;
   return jsonb_build_object('claimed',true,'receipt',to_jsonb(existing));
  end if;
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
