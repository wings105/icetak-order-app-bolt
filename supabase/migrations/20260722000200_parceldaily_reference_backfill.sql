with refs as (
  select distinct on (coalesce(payload->>'consign_no',payload#>>'{data,consign_no}'))
    coalesce(payload->>'consign_no',payload#>>'{data,consign_no}') tracking_no,
    coalesce(payload->>'reference',payload#>>'{data,reference}') reference,
    coalesce(payload->>'orderId',payload#>>'{data,orderId}') provider_order_id,
    coalesce(payload->>'connoteURL',payload#>>'{data,connoteURL}') connote_url,
    coalesce(payload->>'thermalConnoteURL',payload#>>'{data,thermalConnoteURL}') thermal_connote_url,
    coalesce(
      payload#>>'{serviceProviderInfo,tracking_link}',
      payload#>>'{data,serviceProviderInfo,tracking_link}'
    ) tracking_link
  from public.shipping_webhook_events
  where provider='parceldaily'
    and coalesce(payload->>'consign_no',payload#>>'{data,consign_no}') is not null
    and nullif(coalesce(payload->>'reference',payload#>>'{data,reference}'),'') is not null
  order by coalesce(payload->>'consign_no',payload#>>'{data,consign_no}'), received_at desc
)
update public.shipments s
set reference=coalesce(nullif(s.reference,''),r.reference),
    provider_order_id=coalesce(nullif(s.provider_order_id,''),r.provider_order_id),
    connote_url=coalesce(nullif(s.connote_url,''),r.connote_url),
    thermal_connote_url=coalesce(nullif(s.thermal_connote_url,''),r.thermal_connote_url),
    tracking_link=coalesce(nullif(s.tracking_link,''),r.tracking_link),
    updated_at=now()
from refs r
where s.provider='parceldaily' and s.tracking_no=r.tracking_no;

update public.shipment_events
set normalized_status=public.normalize_shipping_status(status,status_group),
    status_group=public.normalize_shipping_status(status,status_group)
where provider='parceldaily';

update public.shipments
set normalized_status=public.normalize_shipping_status(status,status_group),
    status_group=public.normalize_shipping_status(status,status_group),
    delivered_at=case
      when public.normalize_shipping_status(status,status_group)='delivered'
      then coalesce(delivered_at,updated_at)
      else null
    end,
    updated_at=now()
where provider='parceldaily';

update public.shipping_webhook_events w
set reference=coalesce(nullif(w.reference,''),s.reference),
    shipment_id=coalesce(w.shipment_id,s.id),
    order_id=s.order_id,
    resolution_status=case when s.order_id is not null then 'matched_order' else 'shipment_only' end
from public.shipments s
where w.provider='parceldaily'
  and s.provider='parceldaily'
  and coalesce(w.payload->>'consign_no',w.payload#>>'{data,consign_no}')=s.tracking_no;

update public.shipments s
set pod_count=x.good,
    pod_status=case
      when x.total=0 then 'none'
      when x.failed=0 then 'archived'
      when x.good>0 then 'partial'
      else 'failed'
    end,
    pod_archived_at=case when x.good>0 then coalesce(s.pod_archived_at,now()) else s.pod_archived_at end,
    pod_error=case when x.failed>0 then x.failed::text||' POD file(s) failed' else null end
from (
  select shipment_id,
         count(*) total,
         count(*) filter(where archive_status in ('archived_db','archived_storage')) good,
         count(*) filter(where archive_status='failed') failed
  from public.shipment_pod_files
  group by shipment_id
) x
where s.id=x.shipment_id;
