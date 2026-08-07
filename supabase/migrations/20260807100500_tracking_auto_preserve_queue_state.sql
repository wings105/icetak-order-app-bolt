create or replace function public.icetak_refresh_shipment_tracking_state(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_shipment public.shipments%rowtype;
  v_event public.shipment_events%rowtype;
  v_base_status text;
  v_blocked_reason text;
begin
  select * into v_shipment from public.shipments where id=p_shipment_id;
  if not found then return; end if;

  select e.* into v_event
  from public.shipment_events e
  where e.shipment_id=p_shipment_id
    and public.icetak_is_first_physical_scan(e.normalized_status,e.status_group,e.status)
  order by coalesce(e.event_time,e.created_at) asc,e.created_at asc
  limit 1;

  if v_event.id is null then
    v_base_status:='not_ready';
  elsif nullif(btrim(coalesce(v_shipment.recipient_phone,'')),'') is null then
    v_base_status:='blocked'; v_blocked_reason:='MISSING_RECIPIENT_PHONE';
  elsif nullif(btrim(coalesce(v_shipment.tracking_no,'')),'') is null then
    v_base_status:='blocked'; v_blocked_reason:='MISSING_TRACKING_NUMBER';
  elsif public.icetak_tracking_link(v_shipment.tracking_no) is null then
    v_base_status:='blocked'; v_blocked_reason:='UNSUPPORTED_TRACKING_FORMAT';
  else
    v_base_status:='ready';
  end if;

  insert into public.shipment_tracking_state(
    shipment_id,first_scan_event_id,first_scan_at,first_scan_status,send_status,blocked_reason,updated_at
  ) values(
    p_shipment_id,v_event.id,coalesce(v_event.event_time,v_event.created_at),
    coalesce(v_event.status,v_event.normalized_status,v_event.status_group),v_base_status,v_blocked_reason,now()
  )
  on conflict(shipment_id) do update set
    first_scan_event_id=excluded.first_scan_event_id,
    first_scan_at=excluded.first_scan_at,
    first_scan_status=excluded.first_scan_status,
    send_status=case
      when shipment_tracking_state.send_status in ('queued','opened','sent','failed','cancelled')
        then shipment_tracking_state.send_status
      else excluded.send_status
    end,
    blocked_reason=case
      when shipment_tracking_state.send_status in ('queued','sent','failed','cancelled')
        then shipment_tracking_state.blocked_reason
      else excluded.blocked_reason
    end,
    updated_at=now();
end;
$function$;
