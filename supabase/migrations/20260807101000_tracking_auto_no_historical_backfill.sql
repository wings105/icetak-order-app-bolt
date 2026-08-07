create or replace function public.icetak_enqueue_auto_tracking(p_shipment_id uuid,p_event_id uuid,p_event_created_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  s public.shipments%rowtype;
  st public.shipment_tracking_state%rowtype;
  cfg public.tracking_system_settings%rowtype;
  v_phone text;
  v_link text;
  v_message text;
  v_idem text;
  v_qid uuid;
begin
  select * into cfg from public.tracking_system_settings where singleton=true;
  if cfg.auto_send_enabled is not true or cfg.provider_ready is not true or cfg.auto_send_activated_at is null then return null; end if;
  if coalesce(p_event_created_at,now()) < cfg.auto_send_activated_at then return null; end if;

  perform public.icetak_refresh_shipment_tracking_state(p_shipment_id);
  select * into s from public.shipments where id=p_shipment_id;
  select * into st from public.shipment_tracking_state where shipment_id=p_shipment_id for update;

  if s.id is null or st.shipment_id is null or st.send_status <> 'ready' then return null; end if;
  if st.first_scan_at is null or st.first_scan_at < cfg.auto_send_activated_at then return null; end if;

  v_phone := public.icetak_normalize_phone(s.recipient_phone);
  v_link := public.icetak_tracking_link(s.tracking_no);
  if v_phone !~ '^601[0-9]{8,9}$' or nullif(v_link,'') is null then return null; end if;

  v_message := public.icetak_tracking_message(s.tracking_no);
  v_idem := 'shipment_auto_tracking:' || s.id::text;

  insert into public.notification_queue(event_type,channel,order_id,customer_id,phone,payload,status,attempts,scheduled_at,created_at,idempotency_key)
  values(
    'shipment_auto_tracking','whatsapp',s.order_id,(select customer_id from public.orders where id=s.order_id),v_phone,
    jsonb_build_object(
      'event_type','shipment_auto_tracking','phone',v_phone,'mode','auto','text',v_message,
      'template_name','tracking_update','template_language','ms',
      'template_params',jsonb_build_array('customer_name','courier','tracking_number','tracking_link'),
      'vars',jsonb_build_object(
        'customer_name',coalesce(nullif(btrim(s.recipient_name),''),'Customer'),
        'courier',upper(coalesce(public.icetak_tracking_courier(s.tracking_no,s.courier),'Courier')),
        'tracking_number',s.tracking_no,'tracking_link',v_link,'shipment_id',s.id::text
      ),
      'source','tracking_auto','idempotency_key',v_idem,'shipment_id',s.id,'shipment_event_id',p_event_id
    ),
    'pending',0,now(),now(),v_idem
  )
  on conflict(idempotency_key) do nothing
  returning id into v_qid;

  if v_qid is not null then
    update public.shipment_tracking_state
    set send_status='queued',auto_queue_id=v_qid,auto_queued_at=now(),auto_attempted_at=null,
        provider_message_id=null,send_method='wasapflow_api',last_error=null,updated_at=now()
    where shipment_id=s.id and send_status='ready';
  end if;
  return v_qid;
end;
$function$;
