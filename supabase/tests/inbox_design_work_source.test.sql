-- Native task-only queue checks. No provider writes; all source/queue changes roll back.
begin;
do $$declare t public.ai_clickup_work_snapshots; v_at timestamptz; v_other uuid;begin
 select * into t from public.ai_clickup_work_snapshots where order_id is not null and list_id='18375902' limit 1 for update;
 if t.task_id is null then raise exception 'No linked direct fixture available';end if;
 v_at:=clock_timestamp();
 update public.ai_clickup_work_snapshots set clickup_status=case when clickup_status='complete' then 'new custom' else 'complete' end where task_id=t.task_id;
 if not exists(select 1 from inbox_sync.jobs where source='direct' and order_id=t.order_id and requested_at>=v_at) then raise exception 'Direct status-only change not queued';end if;
 v_at:=clock_timestamp();
 update public.ai_clickup_work_snapshots set review_status='QA review changed' where task_id=t.task_id;
 if not exists(select 1 from inbox_sync.jobs where source='direct' and order_id=t.order_id and requested_at>=v_at) then raise exception 'Review-only change not queued';end if;

 select * into t from public.ai_clickup_work_snapshots where marketplace_order_id is not null and list_id='18375902' limit 1 for update;
 if t.task_id is null then raise exception 'No linked marketplace fixture available';end if;
 v_at:=clock_timestamp();
 update public.ai_clickup_work_snapshots set clickup_status=case when clickup_status='complete' then 'new custom' else 'complete' end where task_id=t.task_id;
 if not exists(select 1 from inbox_sync.jobs where source='marketplace' and order_id=t.marketplace_order_id and requested_at>=v_at) then raise exception 'Marketplace task change not queued';end if;
 select id into v_other from public.marketplace_orders where id<>t.marketplace_order_id limit 1;
 v_at:=clock_timestamp();
 update public.ai_clickup_work_snapshots set marketplace_order_id=v_other where task_id=t.task_id;
 if (select count(*) from inbox_sync.jobs where source='marketplace' and order_id in (v_other,t.marketplace_order_id) and requested_at>=v_at)<>2 then raise exception 'Both sides of task remap must refresh';end if;
 v_at:=clock_timestamp();
 delete from public.ai_clickup_work_snapshots where task_id=t.task_id;
 if not exists(select 1 from inbox_sync.jobs where source='marketplace' and order_id=v_other and requested_at>=v_at) then raise exception 'Task deletion not queued';end if;
end $$;
rollback;
