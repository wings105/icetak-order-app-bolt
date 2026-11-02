-- Run as the database owner in one request. Every queue/HTTP side effect is rolled back.
begin;
do $$
declare
 day_myt date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
 snapshot jsonb := public.icetak_pending_pickup_snapshot();
 a jsonb; b jsonb; job public.notification_queue; candidate uuid;
begin
 assert not has_function_privilege('anon','public.icetak_pending_pickup_snapshot()','execute');
 assert not has_function_privilege('authenticated','public.icetak_pending_pickup_enqueue(date)','execute');
 assert not has_schema_privilege('authenticated','shipping_ops','usage');
 assert (snapshot->>'count')::integer > 0, 'Requires an active unscanned AWB fixture';
 assert not exists(select 1 from jsonb_array_elements(snapshot->'items') x
   join public.shipment_events e on e.shipment_id=(x->>'id')::uuid
   where public.icetak_is_first_physical_scan(e.normalized_status,e.status_group,e.status));
 assert not exists(select 1 from jsonb_array_elements(snapshot->'items') x
   join public.shipments s on s.id=(x->>'id')::uuid
   left join public.shipment_tracking_state st on st.shipment_id=s.id
   where s.cancelled_at is not null or s.delivered_at is not null or st.manual_cancelled_at is not null or st.first_scan_at is not null);
 -- Subtransactions prove empty/paused gates without retaining fixture changes.
 begin
   insert into public.shipment_tracking_state(shipment_id,first_scan_at)
   select (x->>'id')::uuid,now() from jsonb_array_elements(snapshot->'items') x
   on conflict(shipment_id) do update set first_scan_at=now();
   assert (public.icetak_pending_pickup_snapshot()->>'count')::integer=0;
   a:=public.icetak_pending_pickup_enqueue(day_myt);
   assert a->>'status'='empty';
   assert not exists(select 1 from public.notification_queue where event_type='admin_pending_pickup');
   raise exception using errcode='Z0001';
 exception when sqlstate 'Z0001' then null;
 end;
 begin
   update public.whatsapp_settings set text_value='false' where key='enabled';
   a:=public.icetak_pending_pickup_enqueue(day_myt);
   assert a->>'status'='paused';
   assert not exists(select 1 from public.notification_queue where event_type='admin_pending_pickup');
   raise exception using errcode='Z0001';
 exception when sqlstate 'Z0001' then null;
 end;
 candidate:=(snapshot->'items'->0->>'id')::uuid;
 begin
   update public.shipment_tracking_state set manual_cancelled_at=now() where shipment_id=candidate;
   assert not exists(select 1 from jsonb_array_elements(public.icetak_pending_pickup_snapshot()->'items') x where (x->>'id')::uuid=candidate);
   raise exception using errcode='Z0001';
 exception when sqlstate 'Z0001' then null;
 end;
 a:=public.icetak_pending_pickup_enqueue(day_myt);
 b:=public.icetak_pending_pickup_enqueue(day_myt);
 assert a->>'status'='queued' and b->>'duplicate'='true';
 assert a->>'queue_id'=b->>'queue_id';
 select * into job from public.notification_queue where id=(a->>'queue_id')::uuid;
 assert job.phone=(select regexp_replace(text_value,'[^0-9]','','g') from public.whatsapp_settings where key='admin_order_notify_phone');
 assert job.order_id is null and job.customer_id is null;
 assert job.event_type='admin_pending_pickup' and job.payload->>'mode'='auto';
 assert job.payload->>'template_name'='icetak_pending_pickup_digest_ms';
 assert (job.payload->'vars'->>'count')::integer=(snapshot->>'count')::integer;
 assert position('AWB BELUM SCAN' in job.payload->>'text')>0;
 assert (select count(*) from public.notification_queue where event_type='admin_pending_pickup')=1;
 -- Only known pre-provider template rejections may reuse the same daily job.
 update public.notification_queue set status='failed',last_error='template_not_approved:icetak_pending_pickup_digest_ms:ms' where id=job.id;
 b:=public.icetak_pending_pickup_enqueue(day_myt);
 assert b->>'status'='queued' and b->>'queue_id'=job.id::text;
 update public.notification_queue set status='failed',last_error='network timeout: delivery unknown' where id=job.id;
 b:=public.icetak_pending_pickup_enqueue(day_myt);
 assert b->>'status'='failed' and b->>'duplicate'='true';
 assert (select status from public.notification_queue where id=job.id)='failed';
end $$;
rollback;
select 'PASS: exclusions, empty/master pause, admin-only payload, once daily replay, safe template-only retry and privacy; all side effects rolled back' as result;
