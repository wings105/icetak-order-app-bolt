-- Native claims only; no ClickUp calls. All temporary receipts roll back.
begin;
do $$
declare actor_name text; task text; request uuid:=gen_random_uuid(); result jsonb; blocked boolean;
 payload jsonb:='{"field_id":"01cec4ef-a30b-443d-a43a-9ab09835b78c","value":null,"expected_value":null,"qa_panel_20261023":true}';
begin
 if has_function_privilege('authenticated','public.icetak_claim_task_clickup_action(uuid,text,text,text,text,jsonb)','EXECUTE')
  or has_table_privilege('authenticated','public.task_clickup_actions','INSERT') then raise exception 'Browser grant widened'; end if;
 select username into actor_name from public.admin_users where is_active and role='owner' limit 1;
 select task_id into task from public.ai_clickup_work_snapshots s where list_id='18375902'
  and lower(clickup_status) not in ('complete','closed','prospect','lain2','cancelled','canceled')
  and not exists(select 1 from public.task_clickup_actions a where a.task_id=s.task_id and a.state='processing' and a.updated_at>now()-interval '2 minutes')
  and not exists(select 1 from public.inbox_clickup_actions a where a.task_id=s.task_id and a.state='processing' and a.updated_at>now()-interval '2 minutes') limit 1;
 if actor_name is null or task is null then raise exception 'No eligible rollback fixture'; end if;
 result:=public.icetak_claim_task_clickup_action(request,task,actor_name,'field',repeat('a',64),payload);
 if not (result->>'claimed')::boolean then raise exception 'Field was not claimed'; end if;
 result:=public.icetak_claim_task_clickup_action(request,task,actor_name,'field',repeat('a',64),payload);
 if (result->>'claimed')::boolean then raise exception 'Duplicate was reclaimed'; end if;
 blocked:=false;
 begin perform public.icetak_claim_task_clickup_action(request,task,actor_name,'field',repeat('b',64),payload); exception when others then if sqlerrm='REQUEST_CONFLICT' then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'Request conflict accepted'; end if;
 blocked:=false;
 begin perform public.icetak_claim_task_clickup_action(gen_random_uuid(),task,actor_name,'field',repeat('c',64),payload||'{"field_id":"other"}'); exception when others then if sqlerrm='INVALID_FIELD' then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'Non-review field accepted'; end if;
 blocked:=false;
 begin perform public.icetak_claim_task_clickup_action(gen_random_uuid(),task,actor_name,'status',repeat('d',64),'{"status":"complete"}'); exception when others then if sqlerrm='TASK_ACTION_BUSY' then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'Concurrent provider action accepted'; end if;
 update public.task_clickup_actions set state='failed',step='field_rejected' where request_id=request;
 result:=public.icetak_claim_task_clickup_action(request,task,actor_name,'field',repeat('a',64),payload);
 if not (result->>'claimed')::boolean then raise exception 'Known rejected write could not retry'; end if;
 update public.task_clickup_actions set state='unknown' where request_id=request;
 result:=public.icetak_claim_task_clickup_action(request,task,actor_name,'field',repeat('a',64),payload);
 if (result->>'claimed')::boolean then raise exception 'Unknown write was resent'; end if;
end $$;
rollback;
select json_build_object('rolled_back',true,'remaining_qa_receipts',(select count(*) from public.task_clickup_actions where payload ? 'qa_panel_20261023')) as verification;
