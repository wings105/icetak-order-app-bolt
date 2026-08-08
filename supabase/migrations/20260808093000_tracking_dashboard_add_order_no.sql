create or replace function public.icetak_admin_tracking_dashboard(p_search text default null::text, p_limit integer default 500)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_result jsonb; v_search text := nullif(lower(btrim(coalesce(p_search,''))),''); v_limit integer := least(greatest(coalesce(p_limit,500),1),1000);
begin
  if not public.icetak_admin_can_manage_shipping_messages() then raise exception 'ADMIN_REQUIRED'; end if;
  select jsonb_build_object(
    'settings',jsonb_build_object('auto_send_enabled',cfg.auto_send_enabled,'provider_mode',cfg.provider_mode,
      'provider_name',cfg.provider_name,'provider_ready',cfg.provider_ready,'template_name',cfg.template_name,
      'auto_send_activated_at',cfg.auto_send_activated_at,'updated_at',cfg.updated_at,'provider_error',cfg.provider_error,
      'provider_status',public.icetak_tracking_auto_provider_status()),
    'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select s.id,s.order_id,o.order_no,s.reference,s.tracking_no,public.icetak_tracking_courier(s.tracking_no,s.courier) courier,
        public.icetak_tracking_link(s.tracking_no) tracking_link,s.status,s.normalized_status,s.provider,s.service_provider,
        s.recipient_phone,s.recipient_name,s.recipient_address_text,s.shipped_at,s.delivered_at,s.created_at,s.updated_at,
        st.first_scan_at,st.first_scan_status,coalesce(st.send_status,'not_ready') send_status,st.blocked_reason,
        st.manual_opened_at,st.sent_at,st.send_method,st.manual_cancelled_at,st.manual_cancel_reason,
        st.auto_queue_id,st.auto_queued_at,st.auto_attempted_at,st.provider_message_id,st.last_error,
        q.status auto_queue_status,q.attempts auto_attempts,q.scheduled_at auto_next_retry_at,
        public.icetak_tracking_message(s.tracking_no) message_body
      from public.shipments s
      left join public.orders o on o.id=s.order_id
      left join public.shipment_tracking_state st on st.shipment_id=s.id
      left join public.notification_queue q on q.id=st.auto_queue_id
      where nullif(btrim(coalesce(s.tracking_no,'')),'') is not null
        and (v_search is null or lower(coalesce(s.tracking_no,'')) like '%'||v_search||'%'
          or lower(coalesce(s.recipient_phone,'')) like '%'||v_search||'%'
          or lower(coalesce(s.recipient_name,'')) like '%'||v_search||'%'
          or lower(coalesce(s.reference,'')) like '%'||v_search||'%'
          or lower(coalesce(o.order_no,'')) like '%'||v_search||'%'
          or lower(coalesce(s.status,'')) like '%'||v_search||'%')
      order by s.created_at desc limit v_limit) x),'[]'::jsonb)
  ) into v_result from public.tracking_system_settings cfg where cfg.singleton=true;
  return coalesce(v_result,jsonb_build_object('settings','{}'::jsonb,'rows','[]'::jsonb));
end;
$function$;
