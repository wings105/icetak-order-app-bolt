-- Run in one transaction with this migration, then roll back all fixtures/network queues.
update finance.shopee_finance_dispatch_config set enabled=false where singleton;
set local role service_role;
do $$
declare e uuid;o uuid;v_due timestamptz:=now()+interval '3 days';v_old timestamptz:=now()-interval '1 hour';r jsonb;j jsonb;begin
 select event_id into e from public.capture_marketplace_webhook(p_provider=>'shopee',p_event_key=>'qa-ops-notification',p_event_code=>5,p_shop_id=>'188218638',p_parsed_payload=>jsonb_build_object('code',5,'data',jsonb_build_array(jsonb_build_object('title','Reminder: Buyer Waiting for Reply','content','QA'))));
 if not exists(select 1 from marketplace_ops.alerts where source_event_id=e and kind='reply_reminder') then raise exception 'reminder_not_processed';end if;
 perform * from public.capture_marketplace_webhook(p_provider=>'shopee',p_event_key=>'qa-ops-notification',p_event_code=>5,p_shop_id=>'188218638',p_parsed_payload=>'{}');
 if (select count(*) from marketplace_ops.alerts where source_event_id=e)<>1 then raise exception 'duplicate_alert';end if;
 select event_id into e from public.capture_marketplace_webhook(p_provider=>'shopee',p_event_key=>'qa-ops-status',p_event_code=>3,p_shop_id=>'1635364464',p_order_sn=>'QAOPS000001',p_occurred_at=>now(),p_parsed_payload=>jsonb_build_object('code',3,'data',jsonb_build_object('ordersn','QAOPS000001','status','READY_TO_SHIP')));
 select id into o from public.marketplace_orders where order_sn='QAOPS000001';
 if not exists(select 1 from public.marketplace_orders where id=o and region='SG' and currency='SGD' and payment_status='paid') then raise exception 'shop_currency_mismatch';end if;
 perform * from public.capture_marketplace_webhook(p_provider=>'shopee',p_event_key=>'qa-ops-deadline',p_event_code=>47,p_shop_id=>'1635364464',p_order_sn=>'QAOPS000001',p_package_number=>'QAOPS-PACKAGE',p_occurred_at=>now(),p_parsed_payload=>jsonb_build_object('code',47,'data',jsonb_build_object('order_sn','QAOPS000001','package_number','QAOPS-PACKAGE','changed_fields',jsonb_build_array('ship_by_date'),'new',jsonb_build_object('ship_by_date',extract(epoch from v_due)::bigint))));
 perform * from public.capture_marketplace_webhook(p_provider=>'shopee',p_event_key=>'qa-ops-old-deadline',p_event_code=>47,p_shop_id=>'1635364464',p_order_sn=>'QAOPS000001',p_package_number=>'QAOPS-PACKAGE',p_occurred_at=>v_old,p_parsed_payload=>jsonb_build_object('code',47,'data',jsonb_build_object('order_sn','QAOPS000001','package_number','QAOPS-PACKAGE','changed_fields',jsonb_build_array('ship_by_date'),'new',jsonb_build_object('ship_by_date',extract(epoch from (v_due-interval '1 day'))::bigint))));
 if abs(extract(epoch from ((select ship_by_at from public.marketplace_orders where id=o)-v_due)))>1 then raise exception 'late_deadline_regression';end if;
 perform * from public.capture_marketplace_webhook(p_provider=>'shopee',p_event_key=>'qa-ops-return',p_event_code=>29,p_shop_id=>'1635364464',p_order_sn=>'QAOPS000001',p_occurred_at=>now(),p_parsed_payload=>jsonb_build_object('code',29,'data',jsonb_build_object('order_sn','QAOPS000001','return_sn','QAOPSRETURN001','updated_values',jsonb_build_array(jsonb_build_object('update_field','return_solution','new_value','REFUND_ONLY','update_time',extract(epoch from now())::bigint)))));
 if not exists(select 1 from public.marketplace_returns where order_id=o and return_solution='REFUND_ONLY') then raise exception 'return_solution_missing';end if;
 select event_id into e from public.capture_marketplace_webhook(p_provider=>'shopee',p_event_key=>'qa-ops-listing',p_event_code=>16,p_shop_id=>'188218638',p_parsed_payload=>jsonb_build_object('code',16,'data',jsonb_build_object('item_id',123,'item_name','QA listing','item_status','SHOPEE_DELETE','item_status_details',jsonb_build_array(jsonb_build_object('violation_reason','QA reason','fix_deadline_time',extract(epoch from v_due)::bigint)))));
 if not exists(select 1 from marketplace_ops.alerts where source_event_id=e and severity='critical' and deadline is not null) then raise exception 'listing_alert_missing';end if;
 select event_id into e from public.capture_marketplace_webhook(p_provider=>'shopee',p_event_key=>'qa-ops-chat',p_event_code=>10,p_shop_id=>'188218638',p_parsed_payload=>jsonb_build_object('code',10,'data',jsonb_build_object('type','message')));
 if not exists(select 1 from marketplace_ops.jobs where event_id=e and status='pending') then raise exception 'durable_job_missing';end if;
 if has_function_privilege('anon','public.marketplace_operations(text,jsonb,text)','execute') or has_function_privilege('authenticated','public.claim_marketplace_recovery(integer)','execute') then raise exception 'private_rpc_exposed';end if;
 r:=public.marketplace_operations('snapshot',jsonb_build_object('shop_id','1635364464'),null);
 if (r->'events') is null or (r->'finance') is null then raise exception 'monitor_snapshot_missing';end if;
end $$;
reset role;
select 'ORDER_OPS_ROLLBACK_PASS' result;
