-- Logistics events (30/47) may postdate the order's update_time.
-- Compare only code-3 order update_time and prior validated detail reads.
DO $fix$
DECLARE src text;
old_fragment text:=$old$ if (o.latest_provider_update_at is not null and p_provider_updated_at<o.latest_provider_update_at)$old$;
new_fragment text:=$new$ if exists(select 1 from public.marketplace_webhook_events e where e.provider='shopee' and e.order_sn=o.order_sn and e.event_code=3 and e.parsed_payload#>>'{data,update_time}' ~ '^[0-9]{1,12}$' and p_provider_updated_at < to_timestamp(case when e.parsed_payload#>>'{data,update_time}' ~ '^[0-9]{1,12}$' then (e.parsed_payload#>>'{data,update_time}')::double precision else null end))$new$;
BEGIN
 src:=pg_get_functiondef('public.apply_marketplace_order_detail(uuid,uuid,uuid,text,text,timestamptz,jsonb)'::regprocedure);
 IF strpos(src,old_fragment)=0 THEN RAISE EXCEPTION 'EXPECTED_CLOCK_GUARD_NOT_FOUND';END IF;
 EXECUTE replace(src,old_fragment,new_fragment);
END $fix$;
