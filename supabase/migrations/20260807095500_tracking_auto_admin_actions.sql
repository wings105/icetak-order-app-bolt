create or replace function public.icetak_admin_tracking_action(p_shipment_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=public
as $function$
declare
  v_state public.shipment_tracking_state%rowtype;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_queue_id uuid;
begin
  if not public.icetak_admin_can_manage_shipping_messages() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.icetak_refresh_shipment_tracking_state(p_shipment_id);
  select * into v_state from public.shipment_tracking_state where shipment_id=p_shipment_id for update;
  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;

  if v_action='opened' then
    if v_state.send_status not in ('ready','opened','sent','failed') then raise exception 'TRACKING_NOT_READY'; end if;
    update public.notification_queue set status='cancelled',processed_at=now(),locked_at=null,last_error='Manual WhatsApp opened by admin'
    where event_type='shipment_auto_tracking' and payload->>'shipment_id'=p_shipment_id::text and status in ('pending','processing');
    update public.shipment_tracking_state set
      send_status=case when send_status='sent' then 'sent' else 'opened' end,
      manual_opened_at=now(),manual_opened_by=auth.uid(),auto_queue_id=null,auto_queued_at=null,updated_at=now()
    where shipment_id=p_shipment_id;

  elsif v_action='sent' then
    if v_state.send_status not in ('ready','opened','sent','failed') then raise exception 'TRACKING_NOT_READY'; end if;
    update public.notification_queue set status='cancelled',processed_at=now(),locked_at=null,last_error='Marked sent manually by admin'
    where event_type='shipment_auto_tracking' and payload->>'shipment_id'=p_shipment_id::text and status in ('pending','processing');
    update public.shipment_tracking_state set send_status='sent',sent_at=coalesce(sent_at,now()),sent_by=auth.uid(),
      send_method='manual_whatsapp_link',auto_queue_id=null,auto_queued_at=null,last_error=null,updated_at=now()
    where shipment_id=p_shipment_id;

  elsif v_action='cancel' then
    update public.notification_queue set status='cancelled',processed_at=now(),locked_at=null,last_error='Tracking cancelled manually in iCetak'
    where event_type='shipment_auto_tracking' and payload->>'shipment_id'=p_shipment_id::text and status in ('pending','processing');
    update public.shipment_tracking_state set
      pre_cancel_send_status=case when send_status='cancelled' then pre_cancel_send_status else send_status end,
      send_status='cancelled',manual_cancelled_at=coalesce(manual_cancelled_at,now()),
      manual_cancelled_by=coalesce(manual_cancelled_by,auth.uid()),manual_cancel_reason='Cancelled manually in iCetak',
      auto_queue_id=null,auto_queued_at=null,last_error=null,updated_at=now()
    where shipment_id=p_shipment_id;

  elsif v_action='restore' then
    if v_state.send_status<>'cancelled' then raise exception 'TRACKING_NOT_CANCELLED'; end if;
    update public.shipment_tracking_state st set
      send_status=case
        when st.pre_cancel_send_status='sent' then 'sent'
        when st.pre_cancel_send_status='opened' and st.first_scan_at is not null
          and nullif(btrim(coalesce(s.recipient_phone,'')),'') is not null
          and public.icetak_tracking_link(s.tracking_no) is not null then 'opened'
        when st.first_scan_at is null then 'not_ready'
        when nullif(btrim(coalesce(s.recipient_phone,'')),'') is null then 'blocked'
        when public.icetak_tracking_link(s.tracking_no) is null then 'blocked'
        else 'ready' end,
      blocked_reason=case
        when st.pre_cancel_send_status in ('sent','opened') then null
        when st.first_scan_at is null then null
        when nullif(btrim(coalesce(s.recipient_phone,'')),'') is null then 'MISSING_RECIPIENT_PHONE'
        when public.icetak_tracking_link(s.tracking_no) is null then 'UNSUPPORTED_TRACKING_FORMAT'
        else null end,
      manual_cancelled_at=null,manual_cancelled_by=null,manual_cancel_reason=null,pre_cancel_send_status=null,
      auto_queue_id=null,auto_queued_at=null,last_error=null,updated_at=now()
    from public.shipments s where st.shipment_id=p_shipment_id and s.id=st.shipment_id;

  elsif v_action='retry_auto' then
    if not exists(select 1 from public.tracking_system_settings where singleton=true and auto_send_enabled and provider_ready) then
      raise exception 'AUTO_SEND_NOT_ENABLED';
    end if;
    if v_state.send_status not in ('ready','failed') then raise exception 'TRACKING_NOT_RETRYABLE'; end if;
    select id into v_queue_id from public.notification_queue
    where event_type='shipment_auto_tracking' and idempotency_key='shipment_auto_tracking:'||p_shipment_id::text limit 1 for update;
    if v_queue_id is null then
      select public.icetak_enqueue_auto_tracking(p_shipment_id,null,now()) into v_queue_id;
    else
      update public.notification_queue set status='pending',attempts=0,last_error=null,scheduled_at=now(),sent_at=null,
        processed_at=null,locked_at=null,provider_message_id=null,decision_mode=null,decision_reason=null
      where id=v_queue_id;
      update public.shipment_tracking_state set send_status='queued',auto_queue_id=v_queue_id,auto_queued_at=now(),
        auto_attempted_at=null,provider_message_id=null,send_method='wasapflow_api',last_error=null,updated_at=now()
      where shipment_id=p_shipment_id;
    end if;

  elsif v_action='reopen' then
    if v_state.send_status='cancelled' then raise exception 'TRACKING_CANCELLED'; end if;
    update public.shipment_tracking_state st set
      send_status=case when st.first_scan_at is null then 'not_ready'
        when nullif(btrim(coalesce(s.recipient_phone,'')),'') is null then 'blocked'
        when public.icetak_tracking_link(s.tracking_no) is null then 'blocked' else 'ready' end,
      blocked_reason=case when st.first_scan_at is null then null
        when nullif(btrim(coalesce(s.recipient_phone,'')),'') is null then 'MISSING_RECIPIENT_PHONE'
        when public.icetak_tracking_link(s.tracking_no) is null then 'UNSUPPORTED_TRACKING_FORMAT' else null end,
      manual_opened_at=null,manual_opened_by=null,sent_at=null,sent_by=null,send_method=null,
      auto_queue_id=null,auto_queued_at=null,provider_message_id=null,last_error=null,updated_at=now()
    from public.shipments s where st.shipment_id=p_shipment_id and s.id=st.shipment_id;
  else
    raise exception 'UNSUPPORTED_ACTION';
  end if;

  select * into v_state from public.shipment_tracking_state where shipment_id=p_shipment_id;
  return to_jsonb(v_state);
end;
$function$;

grant execute on function public.icetak_admin_tracking_action(uuid,text) to authenticated;
