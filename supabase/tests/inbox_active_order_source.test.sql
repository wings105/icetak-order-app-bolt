-- Controlled regression; every fixture/projection change is rolled back. No provider sends.
begin;
do $$declare r record;begin
 select s.task_id,s.order_id,s.clickup_status into r from public.ai_clickup_work_snapshots s
 join public.active_order_summary v on v.order_system_order_id=s.order_id
 where v.active_order and (v.metadata->>'clickup_open_task_count')::int=1
 and v.metadata->'clickup_open_task_ids' ? s.task_id limit 1;
 if r.task_id is null then raise exception 'No single-task fixture candidate';end if;
 update public.ai_clickup_work_snapshots set clickup_status='complete',source_updated_at=clock_timestamp() where task_id=r.task_id;
 if exists(select 1 from public.active_order_summary where order_system_order_id=r.order_id and active_order) then raise exception 'Completing only task left order active';end if;
 if not exists(select 1 from inbox_sync.jobs where source='direct' and order_id=r.order_id and requested_at>=now()) then raise exception 'Task-only update did not enqueue Inbox sync';end if;
 update public.ai_clickup_work_snapshots set clickup_status=r.clickup_status,source_updated_at=clock_timestamp() where task_id=r.task_id;
 if not exists(select 1 from public.active_order_summary where order_system_order_id=r.order_id and active_order) then raise exception 'Reopened task not active';end if;
end $$;
rollback;

