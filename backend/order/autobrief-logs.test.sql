begin;
do $$
declare result jsonb; n bigint;
begin
 if has_function_privilege('anon','public.icetak_autobrief_logs(text,text,text,integer,text)','EXECUTE') or has_function_privilege('authenticated','public.icetak_autobrief_logs(text,text,text,integer,text)','EXECUTE') then raise exception 'browser RPC grant'; end if;
 if has_table_privilege('authenticated','public.autobrief_followup_events','SELECT') then raise exception 'browser history grant'; end if;
 if not (select relrowsecurity from pg_class where oid='public.autobrief_followup_events'::regclass) then raise exception 'RLS missing'; end if;
 insert into public.clickup_order_brief_jobs(task_id,order_reference,state,brief)
 values('qa-autobrief-logs','QA-LOG-ONLY','review','{"sku":"CN1001","followup":{"enabled":true,"due_at":"2026-11-02T06:00:00Z","checked_at":"one","first":{"state":"manual","updated_at":"one","request_id":"qa-manual"}}}');
 select count(*) into n from public.autobrief_followup_events where task_id='qa-autobrief-logs';
 if n<>1 then raise exception 'initial transition missing'; end if;
 update public.clickup_order_brief_jobs set brief=jsonb_set(jsonb_set(brief,'{followup,checked_at}','"two"'),'{followup,first,updated_at}','"two"') where task_id='qa-autobrief-logs';
 if (select count(*) from public.autobrief_followup_events where task_id='qa-autobrief-logs')<>n then raise exception 'poll spam'; end if;
 update public.clickup_order_brief_jobs set brief=jsonb_set(brief,'{followup,first}','{"state":"sent","request_id":"qa-reconciled","provider_message_id":"qa-provider","attempts":0}') where task_id='qa-autobrief-logs';
 if (select count(*) from public.autobrief_followup_events where task_id='qa-autobrief-logs')<>2 then raise exception 'receipt reconciliation missing'; end if;
 result:=public.icetak_autobrief_logs('QA-LOG-ONLY','first','sent',0,'');
 if result->>'total'<>'1' or result->'rows'->0->'receipt'->>'provider_message_id'<>'qa-provider' then raise exception 'receipt filter or projection'; end if;
 if (public.icetak_autobrief_logs('QA-LOG-ONLY','first','manual',0,'')->>'total')<>'0' then raise exception 'state filter'; end if;
 if jsonb_array_length(public.icetak_autobrief_logs('QA-LOG-ONLY','','',30,'')->'rows')<>0 then raise exception 'pagination'; end if;
 if jsonb_array_length(public.icetak_autobrief_logs('','','',0,'qa-autobrief-logs')->'events')<>2 then raise exception 'exact task history'; end if;
 update public.clickup_order_brief_jobs set brief=jsonb_set(brief,'{wording}','"Sample Child"') where task_id='qa-autobrief-logs';
 if (select count(*) from public.autobrief_followup_events where task_id='qa-autobrief-logs')<>3 then raise exception 'detail transition missing'; end if;
 if (public.icetak_autobrief_logs('QA-LOG-ONLY','deadline','skipped',0,'')->>'total')<>'1' then raise exception 'detail cancels pending'; end if;
update public.clickup_order_brief_jobs set brief='{}',last_error='QA_WORKER_FAILURE' where task_id='qa-autobrief-logs';
 result:=public.icetak_autobrief_logs('QA-LOG-ONLY','first','sent',0,'');
 if result->>'total'<>'1' or result->'rows'->0->>'is_historical'<>'true' or result->'rows'->0->>'last_error'<>'QA_WORKER_FAILURE' then raise exception 'failed job lost prior receipt'; end if;
end $$;
rollback;
select 'PASS rollback: native transitions, no poll spam, manual reconciliation, private ACL/RLS, exact filters, pagination and detail receipt history' as result;
