begin;
do $test$
declare sid uuid; qid uuid; n integer;
begin
 select s.id into sid from public.shipments s join public.shipment_tracking_state st on st.shipment_id=s.id join public.orders o on o.id=s.order_id
 where st.shipment_id::text in (select jsonb_object_keys(setting_value::jsonb) from public.private_runtime_settings where setting_key='spx_alphabetic_suffix_recovery_20261103')
 and st.send_status='ready' and o.whatsapp_opt_in=true and not public.icetak_order_is_cancelled(o.id) limit 1;
 if sid is null then raise exception 'NO_ELIGIBLE_ROLLBACK_FIXTURE';end if;
 if public.icetak_enqueue_auto_tracking(sid,null,now()) is not null then raise exception 'HISTORICAL_HOLD_BYPASSED';end if;
 update public.shipment_tracking_state set auto_send_enabled=true where shipment_id=sid;
 qid:=public.icetak_enqueue_auto_tracking(sid,null,now());
 if qid is null then raise exception 'SUFFIX_B_NOT_QUEUEABLE_WHEN_ENABLED';end if;
 if (select payload#>>'{vars,tracking_link}' from public.notification_queue where id=qid) is distinct from (select public.icetak_tracking_link(tracking_no) from public.shipments where id=sid) then raise exception 'WRONG_QUEUE_LINK';end if;
 perform public.icetak_enqueue_auto_tracking(sid,null,now());
 select count(*) into n from public.notification_queue where idempotency_key='shipment_auto_tracking:'||sid::text;
 if n<>1 then raise exception 'QUEUE_DUPLICATED';end if;
end $test$;
rollback;
select 'PASS: historical hold prevents queue; enabled B tracking queues valid link once; all fixture changes rolled back' as tests;
