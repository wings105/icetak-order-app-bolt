-- Follow-up for manual AWB reconciliation: expose match suggestions in Admin V2,
-- preserve ParcelDaily reference on manual link, and refresh states that were blocked before NinjaVan support.

create or replace function public.icetak_admin_link_shipment_order(p_shipment_id uuid,p_order_ref text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare s public.shipments%rowtype; o public.orders%rowtype; v_order_id uuid; v_actor text;
begin
  if not public.icetak_admin_can_manage_shipping_messages() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into s from public.shipments where id=p_shipment_id for update;
  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;
  v_order_id:=public.resolve_shipping_order_reference(btrim(coalesce(p_order_ref,'')));
  if v_order_id is null then select id into v_order_id from public.orders where id::text=btrim(coalesce(p_order_ref,'')) limit 1; end if;
  if v_order_id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  select * into o from public.orders where id=v_order_id for update;
  if s.order_id is not null and s.order_id<>v_order_id then raise exception 'SHIPMENT_ALREADY_LINKED_TO_ANOTHER_ORDER'; end if;
  if nullif(btrim(coalesce(o.tracking,'')),'') is not null and o.tracking<>s.tracking_no then raise exception 'ORDER_ALREADY_HAS_DIFFERENT_TRACKING'; end if;
  update public.shipments
  set order_id=v_order_id,
      tracking_link=coalesce(nullif(tracking_link,''),public.icetak_tracking_link(tracking_no)),
      updated_at=greatest(coalesce(updated_at,'epoch'::timestamptz),now())
  where id=p_shipment_id;
  update public.shipment_events set order_id=v_order_id where shipment_id=p_shipment_id and order_id is distinct from v_order_id;
  perform public.icetak_refresh_shipment_tracking_state(p_shipment_id);
  select username into v_actor from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(v_order_id::text,coalesce(o.order_no,o.order_id),'link_shipment_order',v_actor,
    jsonb_build_object('shipmentId',p_shipment_id,'trackingNo',s.tracking_no,'previousOrderId',s.order_id,'referencePreserved',s.reference));
  return jsonb_build_object('ok',true,'shipmentId',p_shipment_id,'orderDbId',v_order_id,'orderNo',coalesce(o.order_no,o.order_id),'trackingNo',s.tracking_no,'trackingLink',public.icetak_tracking_link(s.tracking_no));
end;
$$;

create or replace function public.icetak_admin_tracking_dashboard(p_search text default null,p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_result jsonb;
  v_search text:=nullif(lower(btrim(coalesce(p_search,''))),'');
  v_limit integer:=least(greatest(coalesce(p_limit,500),1),1000);
begin
  if not public.icetak_admin_can_manage_shipping_messages() then raise exception 'ADMIN_REQUIRED'; end if;
  select jsonb_build_object(
    'settings',jsonb_build_object(
      'auto_send_enabled',cfg.auto_send_enabled,'provider_mode',cfg.provider_mode,'provider_name',cfg.provider_name,
      'provider_ready',cfg.provider_ready,'template_name',cfg.template_name,'auto_send_activated_at',cfg.auto_send_activated_at,
      'updated_at',cfg.updated_at,'provider_error',cfg.provider_error,'provider_status',public.icetak_tracking_auto_provider_status()
    ),
    'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select s.id,s.order_id,o.order_no,s.reference,s.tracking_no,
        public.icetak_tracking_courier(s.tracking_no,s.courier) courier,
        public.icetak_tracking_link(s.tracking_no) tracking_link,
        s.status,s.normalized_status,s.provider,s.service_provider,s.recipient_phone,s.recipient_name,s.recipient_address_text,
        s.shipped_at,s.delivered_at,s.created_at,s.updated_at,
        st.first_scan_at,st.first_scan_status,coalesce(st.send_status,'not_ready') send_status,st.blocked_reason,
        st.manual_opened_at,st.sent_at,st.send_method,st.manual_cancelled_at,st.manual_cancel_reason,
        st.auto_queue_id,st.auto_queued_at,st.auto_attempted_at,st.provider_message_id,st.last_error,
        q.status auto_queue_status,q.attempts auto_attempts,q.scheduled_at auto_next_retry_at,
        public.icetak_tracking_message(s.tracking_no) message_body,
        case when s.order_id is null then public.icetak_shipment_match_suggestion(s.id) else null end match_suggestion
      from public.shipments s
      left join public.orders o on o.id=s.order_id
      left join public.shipment_tracking_state st on st.shipment_id=s.id
      left join public.notification_queue q on q.id=st.auto_queue_id
      where nullif(btrim(coalesce(s.tracking_no,'')),'') is not null
        and (v_search is null
          or lower(coalesce(s.tracking_no,'')) like '%'||v_search||'%'
          or lower(coalesce(s.recipient_phone,'')) like '%'||v_search||'%'
          or lower(coalesce(s.recipient_name,'')) like '%'||v_search||'%'
          or lower(coalesce(s.reference,'')) like '%'||v_search||'%'
          or lower(coalesce(o.order_no,'')) like '%'||v_search||'%'
          or lower(coalesce(s.status,'')) like '%'||v_search||'%')
      order by s.created_at desc limit v_limit
    ) x),'[]'::jsonb)
  ) into v_result
  from public.tracking_system_settings cfg where cfg.singleton=true;
  return coalesce(v_result,jsonb_build_object('settings','{}'::jsonb,'rows','[]'::jsonb));
end;
$$;

do $$
declare r record;
begin
  for r in
    select s.id
    from public.shipments s
    join public.shipment_tracking_state st on st.shipment_id=s.id
    where st.send_status='blocked'
      and st.blocked_reason='UNSUPPORTED_TRACKING_FORMAT'
      and public.icetak_tracking_link(s.tracking_no) is not null
  loop
    perform public.icetak_refresh_shipment_tracking_state(r.id);
  end loop;
end $$;
