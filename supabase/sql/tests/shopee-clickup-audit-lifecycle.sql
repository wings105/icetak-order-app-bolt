begin;
do $test$
#variable_conflict use_variable
declare id uuid; id2 uuid; n jsonb; result jsonb; state text;
begin
 n:=public.shopee_clickup_audit_runtime('start',jsonb_build_object('run_key','test:'||gen_random_uuid()));
 id:=(n->>'id')::uuid;if id is null then raise exception 'start failed';end if;
 result:=public.shopee_clickup_audit_runtime('start',jsonb_build_object('run_key','another:'||gen_random_uuid()));
 if result->>'busy'<>'true' then raise exception 'concurrent audit accepted';end if;
 perform public.shopee_clickup_audit_runtime('finish',jsonb_build_object('id',id,'summary',jsonb_build_object('test',true),'issues',jsonb_build_array(jsonb_build_object('kind','missing_order','order_sn','TEST_ONLY','title','TEST ONLY','body','Rolled back test')),'message','TEST ONLY'));
 select status into state from public.shopee_clickup_audit_runs where public.shopee_clickup_audit_runs.id=id;
 if state<>'issues' then raise exception 'issue status failed';end if;
 if not exists(select 1 from jsonb_array_elements(public.marketplace_operations('snapshot')->'alerts') x where x->>'order_sn'='TEST_ONLY') then raise exception 'admin alert missing';end if;
 n:=public.shopee_clickup_audit_runtime('claim_notification');
 if n->>'id'<>id::text or n->>'phone' is null then raise exception 'notification claim failed';end if;
 perform public.shopee_clickup_audit_runtime('notification_result',jsonb_build_object('id',id,'error','template_name_required'));
 select notification_status into state from public.shopee_clickup_audit_runs where public.shopee_clickup_audit_runs.id=id;
 if state<>'pending' then raise exception 'closed window not deferred';end if;
 update public.shopee_clickup_audit_runs set next_notification_at=now() where public.shopee_clickup_audit_runs.id=id;
 perform public.shopee_clickup_audit_runtime('claim_notification');
 perform public.shopee_clickup_audit_runtime('notification_result',jsonb_build_object('id',id,'uncertain',true,'error','DELIVERY_RESULT_UNKNOWN'));
 select notification_status into state from public.shopee_clickup_audit_runs where public.shopee_clickup_audit_runs.id=id;
 if state<>'uncertain' then raise exception 'unsafe delivery retry';end if;
 n:=public.shopee_clickup_audit_runtime('start',jsonb_build_object('run_key','test:'||gen_random_uuid()));
 id2:=(n->>'id')::uuid;
 perform public.shopee_clickup_audit_runtime('finish',jsonb_build_object('id',id2,'summary',jsonb_build_object('test',true),'issues','[]'::jsonb));
 if exists(select 1 from public.shopee_clickup_audit_issues where run_id=id and status='open') then raise exception 'healthy did not resolve';end if;
end $test$;
select 'PASS: run locking, admin alerts, notification queue, window retry, uncertain stop, auto resolution' test;
rollback;
