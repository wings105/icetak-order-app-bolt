create or replace function public.icetak_guard_pickup_when_active_shipment()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if (
    (new.pickup_ready_at is not null and new.pickup_ready_at is distinct from old.pickup_ready_at)
    or (new.pickup_collected_at is not null and new.pickup_collected_at is distinct from old.pickup_collected_at)
    or (lower(coalesce(new.fulfillment_stage,'')) in ('ready_for_pickup','collected') and new.fulfillment_stage is distinct from old.fulfillment_stage)
  ) and exists (
    select 1
    from public.shipments s
    where s.order_id=new.id
      and s.cancelled_at is null
      and nullif(btrim(coalesce(s.tracking_no,'')),'') is not null
      and lower(coalesce(nullif(s.normalized_status,''),nullif(s.status_group,''),'unknown')) not in ('cancelled','canceled')
  ) then
    raise exception 'Order sudah ada shipment/tracking aktif. Gunakan Shipping flow, bukan Pickup.';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_pickup_when_active_shipment on public.orders;
create trigger trg_guard_pickup_when_active_shipment
before update of pickup_ready_at,pickup_collected_at,fulfillment_stage on public.orders
for each row execute function public.icetak_guard_pickup_when_active_shipment();

create or replace function public.shipment_sync_order_after_write()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  ns text := coalesce(nullif(new.normalized_status,''), public.normalize_shipping_status(new.status,new.status_group));
  next_status text;
  next_admin text;
  next_tab text;
  next_stage text;
  next_delivered_at timestamptz;
  courier_key text := public.icetak_shipping_courier_key(coalesce(nullif(new.courier,''),new.service_provider),new.tracking_no);
  delivery_label text;
  has_active_courier boolean;
begin
  if new.order_id is null then return new; end if;

  update public.shipment_events
  set order_id=new.order_id
  where shipment_id=new.id and order_id is distinct from new.order_id;

  has_active_courier := new.cancelled_at is null
    and nullif(btrim(coalesce(new.tracking_no,'')),'') is not null
    and courier_key in ('spx','jnt','ninja');

  delivery_label := case courier_key
    when 'spx' then 'SPX'
    when 'jnt' then 'JNT'
    when 'ninja' then 'NINJA'
    else null end;

  next_status:=case
    when ns='delivered' then 'Completed'
    when ns='out_for_delivery' then 'Out for Delivery'
    when ns in ('picked_up','in_transit','shipped') then 'Shipped'
    when ns in ('awb_created','shipment_created') then 'AWB Created'
    when ns in ('delivery_failed','failed','exception') then 'Delivery Issue'
    when ns in ('returned','return_to_sender') then 'Returned'
    when has_active_courier then 'AWB Created'
    else null end;
  next_admin:=case
    when ns='delivered' then 'Delivered'
    when ns='out_for_delivery' then 'Out for Delivery'
    when ns='in_transit' then 'In Transit'
    when ns in ('picked_up','shipped') then 'Picked Up by Courier'
    when ns in ('awb_created','shipment_created') then 'AWB Created — Waiting Courier'
    when ns in ('delivery_failed','failed','exception') then 'Delivery Issue'
    when ns in ('returned','return_to_sender') then 'Returned / Return to Sender'
    when has_active_courier then 'AWB Created — Waiting Courier'
    else null end;
  next_tab:=case
    when ns='delivered' then 'completed'
    when ns in ('picked_up','shipped','in_transit','out_for_delivery','delivery_failed','failed','exception','returned','return_to_sender') then 'receive'
    when ns in ('awb_created','shipment_created') or has_active_courier then 'progress'
    else null end;
  next_stage:=case
    when ns='delivered' then 'delivered'
    when ns in ('picked_up','shipped','in_transit','out_for_delivery') then 'in_transit'
    when ns in ('awb_created','shipment_created') or has_active_courier then 'awb_created'
    when ns in ('delivery_failed','failed','exception','returned','return_to_sender') then 'delivery_issue'
    else null end;
  next_delivered_at:=case when ns='delivered' then coalesce(new.updated_at,now()) else null end;

  update public.orders o
  set tracking=coalesce(new.tracking_no,o.tracking),
      courier=case when has_active_courier then courier_key else coalesce(new.courier,new.service_provider,o.courier) end,
      delivery=case when has_active_courier then delivery_label else o.delivery end,
      delivery_method=case when has_active_courier then courier_key else o.delivery_method end,
      tracking_link=coalesce(new.tracking_link,o.tracking_link),
      connote_url=coalesce(new.awb_pdf_url,new.connote_url,new.thermal_connote_url,o.connote_url),
      shipment_status=coalesce(new.status,o.shipment_status),
      shipment_status_group=coalesce(ns,new.status_group,o.shipment_status_group),
      shipment_updated_at=coalesce(new.updated_at,now()),
      status=coalesce(next_status,o.status),
      admin_status=coalesce(next_admin,o.admin_status),
      tab=coalesce(next_tab,o.tab),
      fulfillment_stage=coalesce(next_stage,o.fulfillment_stage),
      pickup_ready_at=case when has_active_courier then null else o.pickup_ready_at end,
      pickup_collected_at=case when has_active_courier then null else o.pickup_collected_at end,
      delivered_at=case when has_active_courier then next_delivered_at else coalesce(next_delivered_at,o.delivered_at) end,
      updated_at=greatest(coalesce(o.updated_at,'epoch'::timestamptz),coalesce(new.updated_at,now()))
  where o.id=new.order_id
    and (
      o.shipment_updated_at is null
      or coalesce(new.updated_at,now()) >= o.shipment_updated_at
      or lower(coalesce(ns,''))='delivered'
      or has_active_courier and lower(coalesce(o.delivery_method,o.delivery,'')) like '%pickup%'
    );

  return new;
end;
$function$;

with latest as (
  select distinct on (s.order_id)
    s.order_id,s.tracking_no,s.tracking_link,s.courier,s.service_provider,s.status,s.status_group,
    coalesce(nullif(s.normalized_status,''),public.normalize_shipping_status(s.status,s.status_group)) ns,
    s.updated_at,
    public.icetak_shipping_courier_key(coalesce(nullif(s.courier,''),s.service_provider),s.tracking_no) courier_key
  from public.shipments s
  where s.order_id is not null
    and s.cancelled_at is null
    and nullif(btrim(coalesce(s.tracking_no,'')),'') is not null
  order by s.order_id,s.updated_at desc nulls last,s.created_at desc
)
update public.orders o
set delivery=case l.courier_key when 'spx' then 'SPX' when 'jnt' then 'JNT' when 'ninja' then 'NINJA' else o.delivery end,
    delivery_method=case when l.courier_key in ('spx','jnt','ninja') then l.courier_key else o.delivery_method end,
    courier=case when l.courier_key in ('spx','jnt','ninja') then l.courier_key else coalesce(l.courier,l.service_provider,o.courier) end,
    tracking=coalesce(l.tracking_no,o.tracking),
    tracking_link=coalesce(l.tracking_link,public.icetak_tracking_link(l.tracking_no),o.tracking_link),
    shipment_status=coalesce(l.status,o.shipment_status),
    shipment_status_group=coalesce(l.ns,l.status_group,o.shipment_status_group),
    shipment_updated_at=coalesce(l.updated_at,o.shipment_updated_at,now()),
    status=case when l.ns='delivered' then 'Completed' when l.ns='out_for_delivery' then 'Out for Delivery' when l.ns in ('picked_up','in_transit','shipped') then 'Shipped' when l.ns in ('awb_created','shipment_created') then 'AWB Created' else o.status end,
    admin_status=case when l.ns='delivered' then 'Delivered' when l.ns='out_for_delivery' then 'Out for Delivery' when l.ns='in_transit' then 'In Transit' when l.ns in ('picked_up','shipped') then 'Picked Up by Courier' when l.ns in ('awb_created','shipment_created') then 'AWB Created — Waiting Courier' else o.admin_status end,
    tab=case when l.ns='delivered' then 'completed' when l.ns in ('picked_up','shipped','in_transit','out_for_delivery') then 'receive' when l.ns in ('awb_created','shipment_created') then 'progress' else o.tab end,
    fulfillment_stage=case when l.ns='delivered' then 'delivered' when l.ns in ('picked_up','shipped','in_transit','out_for_delivery') then 'in_transit' when l.ns in ('awb_created','shipment_created') then 'awb_created' else o.fulfillment_stage end,
    pickup_ready_at=null,
    pickup_collected_at=null,
    delivered_at=case when l.ns='delivered' then coalesce(l.updated_at,o.delivered_at,now()) else null end,
    updated_at=greatest(coalesce(o.updated_at,'epoch'::timestamptz),coalesce(l.updated_at,now()))
from latest l
where o.id=l.order_id
  and l.courier_key in ('spx','jnt','ninja')
  and lower(coalesce(o.delivery_method,o.delivery,'')) like '%pickup%';