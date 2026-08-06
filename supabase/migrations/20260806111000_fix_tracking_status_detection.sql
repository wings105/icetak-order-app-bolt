create or replace function public.icetak_is_first_physical_scan(
  p_normalized_status text,
  p_status_group text,
  p_status text
)
returns boolean
language sql
immutable
set search_path = public
as $function$
  select case
    when lower(trim(coalesce(p_normalized_status,''))) in (
      'shipment_created','awb_created','pending_pickup','pending'
    ) then false
    when lower(trim(coalesce(p_status_group,''))) in (
      'shipment_created','awb_created','pending_pickup','pending'
    ) then false
    when lower(coalesce(p_status,'')) like '%shipment data received%' then false
    when lower(coalesce(p_status,'')) like '%pending pickup%' then false
    when lower(trim(coalesce(p_normalized_status,''))) in (
      'picked_up','accepted_by_courier','in_transit','out_for_delivery','delivered'
    ) then true
    when lower(trim(coalesce(p_status_group,''))) in (
      'picked_up','accepted_by_courier','in_transit','out_for_delivery','delivered'
    ) then true
    when lower(coalesce(p_status,'')) like '%picked up by%' then true
    when lower(coalesce(p_status,'')) like '%accepted by courier%' then true
    when lower(coalesce(p_status,'')) like '%received by courier%' then true
    when lower(coalesce(p_status,'')) like '%in transit%' then true
    when lower(coalesce(p_status,'')) like '%departed to hub%' then true
    when lower(coalesce(p_status,'')) like '%arrived hub%' then true
    when lower(coalesce(p_status,'')) like '%on its way for delivery%' then true
    when lower(coalesce(p_status,'')) = 'delivering' then true
    when lower(coalesce(p_status,'')) = 'delivered' then true
    when lower(coalesce(p_status,'')) like '%parcel has been received%' then true
    else false
  end;
$function$;

do $block$
declare
  v_shipment record;
begin
  for v_shipment in select id from public.shipments loop
    perform public.icetak_refresh_shipment_tracking_state(v_shipment.id);
  end loop;
end;
$block$;
