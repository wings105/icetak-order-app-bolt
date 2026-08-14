-- Admin V2 Order Detail: one-order fulfillment/tracking snapshot.
-- Uses the existing shipments / shipment_events / shipment_tracking_state source of truth.

create or replace function public.icetak_admin_order_fulfillment_v1(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_order public.orders%rowtype;
  v_shipment public.shipments%rowtype;
  v_state public.shipment_tracking_state%rowtype;
  v_latest_event public.shipment_events%rowtype;
  v_events jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.admin_users where auth_user_id=auth.uid() and is_active=true) then
    raise exception 'Unauthorized';
  end if;

  select o.* into v_order from public.orders o where o.id=p_order_id;
  if v_order.id is null then raise exception 'Order not found'; end if;

  select s.* into v_shipment
  from public.shipments s
  where s.order_id=p_order_id and s.archived_at is null
  order by coalesce(s.updated_at,s.created_at) desc,s.created_at desc
  limit 1;

  if v_shipment.id is not null then
    select st.* into v_state from public.shipment_tracking_state st where st.shipment_id=v_shipment.id;
    select se.* into v_latest_event
    from public.shipment_events se
    where se.shipment_id=v_shipment.id or (se.order_id=p_order_id and se.tracking_no=v_shipment.tracking_no)
    order by coalesce(se.event_time,se.created_at) desc,se.created_at desc limit 1;

    select coalesce(jsonb_agg(e.obj order by e.event_at desc),'[]'::jsonb) into v_events
    from (
      select coalesce(se.event_time,se.created_at) event_at,
        jsonb_build_object(
          'id',se.id,'status',coalesce(se.status,''),'statusGroup',coalesce(se.status_group,''),
          'normalizedStatus',coalesce(se.normalized_status,''),'eventName',coalesce(se.event_name,''),
          'at',coalesce(se.event_time,se.created_at),'location',coalesce(se.location,''),
          'description',coalesce(se.description,''),'courier',coalesce(se.courier,''),
          'source',coalesce(se.source,''),'provider',coalesce(se.provider,'')
        ) obj
      from public.shipment_events se
      where se.shipment_id=v_shipment.id or (se.order_id=p_order_id and se.tracking_no=v_shipment.tracking_no)
      order by coalesce(se.event_time,se.created_at) desc,se.created_at desc limit 12
    ) e;
  end if;

  return jsonb_build_object(
    'ok',true,
    'order',jsonb_build_object(
      'id',v_order.id,'orderNo',coalesce(nullif(v_order.order_no,''),v_order.order_id,''),
      'delivery',coalesce(v_order.delivery,v_order.delivery_method,''),'courier',coalesce(v_order.courier,''),
      'tracking',coalesce(v_order.tracking,''),'trackingLink',coalesce(v_order.tracking_link,''),
      'fulfillmentStage',coalesce(v_order.fulfillment_stage,''),'shipmentStatus',coalesce(v_order.shipment_status,''),
      'shipmentStatusGroup',coalesce(v_order.shipment_status_group,''),
      'payment',case when lower(coalesce(v_order.payment_status,'')) in ('paid','matched','payment_received') or lower(coalesce(v_order.payment,''))='paid' then 'Paid' else coalesce(nullif(v_order.payment,''),nullif(v_order.payment_status,''),'Unpaid') end,
      'paymentMethod',coalesce(v_order.payment_method,''),'productionApproved',coalesce(v_order.production_approved,false),
      'customerConfirmed',coalesce(v_order.customer_confirmed,false),'customerConfirmedAt',v_order.customer_confirmed_at,
      'createdAt',v_order.created_at,'productionCompletedAt',v_order.production_completed_at,
      'pickupReadyAt',v_order.pickup_ready_at,'pickupCollectedAt',v_order.pickup_collected_at,
      'deliveredAt',v_order.delivered_at,'updatedAt',v_order.updated_at
    ),
    'shipment',case when v_shipment.id is null then null else jsonb_build_object(
      'id',v_shipment.id,'trackingNo',coalesce(v_shipment.tracking_no,''),
      'courier',coalesce(public.icetak_tracking_courier(v_shipment.tracking_no,v_shipment.courier),v_shipment.courier,''),
      'trackingLink',coalesce(nullif(v_shipment.tracking_link,''),public.icetak_tracking_link(v_shipment.tracking_no),''),
      'connoteUrl',coalesce(v_shipment.connote_url,''),'status',coalesce(v_shipment.status,''),
      'statusGroup',coalesce(v_shipment.status_group,''),'normalizedStatus',coalesce(v_shipment.normalized_status,''),
      'awbStatus',coalesce(v_shipment.awb_status,''),'awbError',coalesce(v_shipment.awb_error,''),
      'bookedAt',v_shipment.booked_at,'shippedAt',v_shipment.shipped_at,'deliveredAt',v_shipment.delivered_at,
      'cancelledAt',v_shipment.cancelled_at,'createdAt',v_shipment.created_at,'updatedAt',v_shipment.updated_at,
      'provider',coalesce(v_shipment.provider,''),'serviceProvider',coalesce(v_shipment.service_provider,''),
      'recipientName',coalesce(v_shipment.recipient_name,''),'recipientPhone',coalesce(v_shipment.recipient_phone,''),
      'firstScanAt',v_state.first_scan_at,'firstScanStatus',coalesce(v_state.first_scan_status,''),
      'sendStatus',coalesce(v_state.send_status,'not_ready'),'trackingMessageSentAt',v_state.sent_at,
      'trackingMessageError',coalesce(v_state.last_error,'')
    ) end,
    'latestEvent',case when v_latest_event.id is null then null else jsonb_build_object(
      'id',v_latest_event.id,'status',coalesce(v_latest_event.status,''),'statusGroup',coalesce(v_latest_event.status_group,''),
      'normalizedStatus',coalesce(v_latest_event.normalized_status,''),'eventName',coalesce(v_latest_event.event_name,''),
      'at',coalesce(v_latest_event.event_time,v_latest_event.created_at),'location',coalesce(v_latest_event.location,''),
      'description',coalesce(v_latest_event.description,''),'courier',coalesce(v_latest_event.courier,''),
      'source',coalesce(v_latest_event.source,''),'provider',coalesce(v_latest_event.provider,'')
    ) end,
    'events',v_events
  );
end;
$function$;

create or replace function public.icetak_admin_order_fulfillment_by_ref_v1(p_order_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_order_id uuid;
begin
  if not exists (select 1 from public.admin_users where auth_user_id=auth.uid() and is_active=true) then
    raise exception 'Unauthorized';
  end if;
  begin v_order_id:=nullif(btrim(coalesce(p_order_ref,'')),'')::uuid;
  exception when invalid_text_representation then v_order_id:=null; end;
  if v_order_id is null then
    select o.id into v_order_id from public.orders o
    where o.order_no=p_order_ref or o.order_id=p_order_ref or o.public_token=p_order_ref
    order by o.created_at desc limit 1;
  end if;
  if v_order_id is null then raise exception 'Order not found'; end if;
  return public.icetak_admin_order_fulfillment_v1(v_order_id);
end;
$function$;

revoke all on function public.icetak_admin_order_fulfillment_v1(uuid) from public, anon;
revoke all on function public.icetak_admin_order_fulfillment_by_ref_v1(text) from public, anon;
grant execute on function public.icetak_admin_order_fulfillment_v1(uuid) to authenticated;
grant execute on function public.icetak_admin_order_fulfillment_by_ref_v1(text) to authenticated;
