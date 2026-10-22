-- Uses an existing exact task only as a read reference. All receipts roll back.
begin;
set local role service_role;
do $$
declare c uuid;t text;ch text;r uuid:=gen_random_uuid();actor uuid:='00000000-0000-4000-8000-000000000081';
 summary uuid:='00000000-0000-4000-8000-000000000082';v jsonb;bad boolean;owner_name text;
begin
 select w.id,j->>'id',case when w.kind='shopee' then 'shopee' else 'whatsapp' end into c,t,ch
 from public.ai_order_work_source w cross join lateral jsonb_array_elements(w.production_tasks) j
 join public.ai_clickup_work_snapshots s on s.task_id=j->>'id'
 where s.list_id='18375902' and lower(s.clickup_status) not in ('complete','closed','cancelled','canceled','prospect','lain2')
 and not exists(select 1 from public.task_clickup_actions a where a.task_id=j->>'id' and a.state='processing' and a.updated_at>now()-interval '2 minutes')
 and not exists(select 1 from public.inbox_clickup_actions a where a.task_id=j->>'id' and a.state='processing' and a.updated_at>now()-interval '2 minutes') limit 1;
 if t is null then raise exception 'No safe read-only source fixture';end if;
 v:=public.icetak_claim_inbox_clickup_action(r,t,actor,summary,c,ch,'upload',repeat('1',64),'{"comment":"Native QA rollback","file":null}');
 if not (v->>'claimed')::boolean then raise exception 'Initial claim failed';end if;
 v:=public.icetak_claim_inbox_clickup_action(r,t,actor,summary,c,ch,'upload',repeat('1',64),'{"comment":"Native QA rollback","file":null}');
 if (v->>'claimed')::boolean then raise exception 'Replay was claimed';end if;
 bad:=false;begin perform public.icetak_claim_inbox_clickup_action(r,t,actor,summary,c,ch,'upload',repeat('1',64),'{"comment":"changed"}');exception when others then if sqlerrm='REQUEST_CONFLICT' then bad:=true;else raise;end if;end;
 if not bad then raise exception 'Conflicting payload accepted';end if;
 bad:=false;begin perform public.icetak_claim_inbox_clickup_action(gen_random_uuid(),t,actor,summary,c,ch,'status',repeat('2',64),'{"status":"review"}');exception when others then if sqlerrm='TASK_BUSY' then bad:=true;else raise;end if;end;
 if not bad then raise exception 'Concurrent task write accepted';end if;
 bad:=false;begin perform public.icetak_claim_inbox_clickup_action(gen_random_uuid(),'qa-unlinked-task',actor,summary,c,ch,'upload',repeat('3',64),'{}');exception when others then if sqlerrm='INVALID_TASK' then bad:=true;else raise;end if;end;
 if not bad then raise exception 'Unrelated task accepted';end if;
 select a.username into owner_name from public.admin_users a where a.is_active and a.role='owner' limit 1;
 if owner_name is not null then
  bad:=false;begin perform public.icetak_claim_task_clickup_action(gen_random_uuid(),t,owner_name,'comment',repeat('4',64),'{"comment":"native rollback"}');exception when others then if sqlerrm='TASK_ACTION_BUSY' then bad:=true;else raise;end if;end;
  if not bad then raise exception 'Admin write raced Inbox claim';end if;
 end if;
 update public.inbox_clickup_actions set state='unknown',step='attachment_saved',result='{"attachment":{"id":"qa-no-provider-write","url":"https://attachments.clickup.com/qa"}}' where request_id=r;
 if not public.icetak_resume_inbox_clickup_comment(r,actor) then raise exception 'Definite partial upload cannot resume';end if;
 if public.icetak_resume_inbox_clickup_comment(r,actor) then raise exception 'Comment resume dispatched twice';end if;
 if public.icetak_resume_inbox_clickup_comment(r,gen_random_uuid()) then raise exception 'Different actor resumed upload';end if;
 if has_table_privilege('authenticated','public.inbox_clickup_actions','SELECT') or has_table_privilege('anon','public.inbox_clickup_actions','SELECT')
  or has_function_privilege('authenticated','public.icetak_resume_inbox_clickup_comment(uuid,uuid)','EXECUTE')
  or has_function_privilege('anon','public.icetak_claim_inbox_clickup_action(uuid,text,uuid,uuid,uuid,text,text,text,jsonb)','EXECUTE') then raise exception 'Private receipt API exposed';end if;
end $$;
rollback;
select count(*)=0 as no_qa_receipts_retained from public.inbox_clickup_actions where actor_id='00000000-0000-4000-8000-000000000081';
