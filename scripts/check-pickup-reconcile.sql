-- One request as database owner. All fixture changes and queued effects roll back.
begin;
do $$
declare
 v_id uuid; v_other uuid; v_tracking text; v_order uuid; v_result jsonb; v_count integer;
 v_jobs bigint; v_messages bigint; v_order_state text; v_current_tracking text;
begin
 assert not has_function_privilege('anon','public.icetak_apply_pending_pickup_check(uuid,jsonb)','execute');
 assert not has_function_privilege('authenticated','public.icetak_pending_pickup_poll_candidates()','execute');
 assert not has_schema_privilege('authenticated','shipping_ops','usage');
 select (x->>'id')::uuid into v_id from jsonb_array_elements(public.icetak_pending_pickup_poll_candidates()) with ordinality q(x,n) order by n limit 1;
 assert v_id is not null, 'An active Pending Pickup fixture is required';
 select tracking_no,order_id into v_tracking,v_order from public.shipments where id=v_id;
 select count(*) into v_jobs from public.notification_queue;
 select count(*) into v_messages from public.whatsapp_outbox;
 v_count:=(public.icetak_pending_pickup_snapshot()->>'count')::integer;
 v_result:=public.icetak_apply_pending_pickup_check(v_id,jsonb_build_object('consign_no',v_tracking,'status','Cancel Requested by User','statusGroup','Cancel Requested by User'));
 assert v_result->>'status'='unchanged';
 v_result:=public.icetak_apply_pending_pickup_check(v_id,jsonb_build_object('consign_no','WRONG','status','Cancelled','statusGroup','Cancelled'));
 assert v_result->>'status'='identity_mismatch';
 v_result:=public.icetak_apply_pending_pickup_check(v_id,'{"error":"PROVIDER_HTTP_503"}');
 assert v_result->>'status'='error';
 assert (select cancelled_at is null from public.shipments where id=v_id);
 begin
  update public.shipment_tracking_state set first_scan_at=now() where shipment_id=v_id;
  v_result:=public.icetak_apply_pending_pickup_check(v_id,jsonb_build_object('consign_no',v_tracking,'status','Cancelled','statusGroup','Cancelled'));
  assert v_result->>'status'='no_longer_pending';
  assert (select cancelled_at is null from public.shipments where id=v_id);
  raise exception using errcode='Z0001';
 exception when sqlstate 'Z0001' then null;
 end;
 -- A replacement AWB on the same order must remain canonical after the old AWB cancels.
 begin
  select (x->>'id')::uuid into v_other from jsonb_array_elements(public.icetak_pending_pickup_poll_candidates()) x where (x->>'id')::uuid<>v_id limit 1;
  if v_order is not null and v_other is not null then
   update public.shipments set order_id=v_order,updated_at=now() where id=v_other;
   select tracking into v_current_tracking from public.orders where id=v_order;
   v_result:=public.icetak_apply_pending_pickup_check(v_id,jsonb_build_object('consign_no',v_tracking,'status','Pickup request has been cancelled','statusGroup','Canceled'));
   assert v_result->>'status'='cancelled';
   assert (select tracking=v_current_tracking from public.orders where id=v_order);
   assert (select shipment_status_group is distinct from 'cancelled' from public.orders where id=v_order);
  end if;
  raise exception using errcode='Z0001';
 exception when sqlstate 'Z0001' then null;
 end;
 select status into v_order_state from public.orders where id=v_order;
 v_result:=public.icetak_apply_pending_pickup_check(v_id,jsonb_build_object('consign_no',v_tracking,'status','Pickup request has been cancelled','statusGroup','Canceled'));
 assert v_result->>'status'='cancelled';
 assert (select cancelled_at is not null and normalized_status='cancelled' and status_group='cancelled' from public.shipments where id=v_id);
 assert (public.icetak_pending_pickup_snapshot()->>'count')::integer=v_count-1;
 assert (select status is not distinct from v_order_state from public.orders where id=v_order);
 v_result:=public.icetak_apply_pending_pickup_check(v_id,jsonb_build_object('consign_no',v_tracking,'status','Cancelled','statusGroup','Cancelled'));
 assert v_result->>'status'='already_cancelled';
 assert (select count(*) from public.shipment_events where shipment_id=v_id and source='provider_poll')=1;
 assert (select count(*) from public.notification_queue)=v_jobs;
 assert (select count(*) from public.whatsapp_outbox)=v_messages;
 assert public.icetak_pending_pickup_poll_claim('11111111-1111-4111-8111-111111111111');
 assert not public.icetak_pending_pickup_poll_claim('22222222-2222-4222-8222-222222222222');
 perform public.icetak_pending_pickup_poll_release('22222222-2222-4222-8222-222222222222');
 assert not public.icetak_pending_pickup_poll_claim('22222222-2222-4222-8222-222222222222');
 perform public.icetak_pending_pickup_poll_release('11111111-1111-4111-8111-111111111111');
 assert public.icetak_pending_pickup_poll_claim('22222222-2222-4222-8222-222222222222');
end $$;
rollback;
select 'PASS: confirmed cancellation, requested-cancel/error/identity/race guards, canonical replacement protection, replay, private access, zero customer jobs and worker lease; all changes rolled back' result;
