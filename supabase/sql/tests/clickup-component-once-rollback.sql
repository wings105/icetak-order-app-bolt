begin;
do $test$
declare v_order uuid; v_job uuid; v_first uuid; v_second uuid; v_count integer; v_status text;
begin
 select pc.order_id into v_order from public.production_components pc
 where exists(select 1 from public.integration_outbox b where b.order_id=pc.order_id and b.provider='activepieces' and b.event_type='clickup.production.create' and b.status='processed')
 group by pc.order_id having count(*)=2 order by pc.order_id limit 1;
 if v_order is null then raise exception 'test_requires_processed_two_component_order'; end if;
 select id into v_job from public.integration_outbox where order_id=v_order and provider='activepieces' and event_type='clickup.production.create' limit 1 for update;
 delete from clickup_gate.component_dispatches where order_id=v_order;
 update public.production_components set clickup_task_id=null where order_id=v_order;
 update public.integration_outbox set status='pending',attempts=0,locked_at=null,next_attempt_at=now() where id=v_job;
 select count(*) into v_count from public.claim_clickup_production_outbox_event(v_job,2,null);
 if v_count<>1 then raise exception 'first_dispatch_failed'; end if;
 select (payload->>'dispatched_component_id')::uuid into v_first from public.integration_outbox where id=v_job;
 -- A lost callback and a manual Retry must not produce another dispatch.
 update public.integration_outbox set status='retry',locked_at=null,next_attempt_at=now() where id=v_job;
 select count(*) into v_count from public.claim_clickup_production_outbox_event(v_job,2,null);
 if v_count<>0 then raise exception 'duplicate_dispatch_allowed'; end if;
 select status into v_status from public.integration_outbox where id=v_job;
 if v_status<>'failed' then raise exception 'duplicate_not_held'; end if;
 -- A confirmed first component allows the next actual component.
 update public.production_components set clickup_task_id='verification-only' where id=v_first;
 update public.integration_outbox set status='retry',locked_at=null,next_attempt_at=now() where id=v_job;
 select count(*) into v_count from public.claim_clickup_production_outbox_event(v_job,1,null);
 if v_count<>1 then raise exception 'second_component_blocked'; end if;
 select (payload->>'dispatched_component_id')::uuid into v_second from public.integration_outbox where id=v_job;
 if v_first=v_second then raise exception 'same_component_dispatched_twice'; end if;
 -- Missing confirmation must stop, even below five attempts.
 update public.integration_outbox set status='processing',locked_at=now()-interval '4 minutes',attempts=1 where id=v_job;
 update public.clickup_webhook_events set webapp_component_id=null where webapp_component_id in (select id::text from public.production_components where order_id=v_order);
 perform public.icetak_clickup_production_outbox_watchdog();
 select status into v_status from public.integration_outbox where id=v_job;
 if v_status<>'failed' then raise exception 'unsafe_stale_retry'; end if;
end $test$;
select 'PASS: first claim, duplicate blocked, next component allowed, stale held' test;
rollback;