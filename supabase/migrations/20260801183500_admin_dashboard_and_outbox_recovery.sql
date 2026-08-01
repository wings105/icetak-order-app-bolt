-- Add useful sync/shipping fields without changing existing frontend keys.
create or replace function public.icetak_admin_dashboard_data()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
select jsonb_build_object(
  'orders',coalesce(jsonb_agg(jsonb_build_object(
    'dbId',o.id,'id',coalesce(o.order_id,o.order_no,''),'orderToken',coalesce(o.public_token,''),
    'customerToken',coalesce(o.customer_token,c.public_token,''),'customerName',coalesce(c.name,o.delivery_name,''),
    'customerPhone',coalesce(c.phone,o.delivery_phone,''),'adminStatus',coalesce(o.admin_status,o.status,'New Order'),
    'lastAction','','dateNeedRaw',coalesce(o.date_need::text,''),'dateNeed',coalesce(o.date_need::text,''),
    'created',coalesce(o.created_at::date::text,''),'total',coalesce(o.total,0),'deliveryFee',coalesce(o.delivery_fee,0),
    'payment',coalesce(o.payment,o.payment_status,'Unpaid'),'paymentMethod',coalesce(o.payment_method,''),
    'paymentTransactionId',coalesce(o.payment_transaction_id,''),'paymentVerifiedAt',o.payment_verified_at,
    'paymentVerifiedBy',coalesce(o.payment_verified_by,''),'delivery',coalesce(o.delivery,o.delivery_method,''),
    'status',coalesce(o.status,''),'actionCount',0,'tracking',coalesce(o.tracking,''),'trackingLink',coalesce(o.tracking_link,''),
    'connoteUrl',coalesce(o.connote_url,''),'shipmentStatus',coalesce(o.shipment_status,''),
    'canCancel',case when lower(coalesce(o.status,'')) like '%cancel%' then false else true end,
    'customerConfirmed',coalesce(o.customer_confirmed,false),'adminRemark',coalesce(o.admin_remark,''),
    'productionApproved',coalesce(o.production_approved,false),
    'componentsTotal',(select count(*) from public.production_components pc where pc.order_id=o.id),
    'componentsLinked',(select count(*) from public.production_components pc where pc.order_id=o.id and pc.clickup_task_id is not null),
    'clickupSyncStatus',case
      when not exists(select 1 from public.production_components pc where pc.order_id=o.id) then 'not_required'
      when not exists(select 1 from public.production_components pc where pc.order_id=o.id and pc.clickup_task_id is null) then 'linked'
      when exists(select 1 from public.integration_outbox x where x.order_id=o.id and x.event_type='clickup.production.create' and x.status in ('retry','error')) then 'error'
      else 'queued' end,
    'tab',case
      when lower(coalesce(o.payment,o.payment_status,'')) not like '%paid%' and lower(coalesce(o.status,''))<>'payment_received' then 'to_pay'
      when lower(coalesce(o.shipment_status_group,o.shipment_status,o.status,'')) in ('delivered','completed') then 'completed'
      when lower(coalesce(o.shipment_status_group,o.shipment_status,'')) in ('shipped','in_transit','out_for_delivery','awb_created') then 'receive'
      else 'progress' end,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'k',coalesce(i.k,i.product_type,'edible'),'title',coalesce(i.title,i.product_type,'Item'),
      'qty',coalesce(i.qty,1),'size',coalesce(i.size,''),'style',coalesce(i.style,''),'price',coalesce(i.price,0),
      'workflow',coalesce(i.workflow,'pending'),'reviewRequired',coalesce(i.review_required,false),
      'customText',coalesce(i.custom_text,i.wording,''),'previewUrl',coalesce(i.design_preview_url,''),
      'components',coalesce((select jsonb_agg(jsonb_build_object(
        'id',pc.id,'type',coalesce(pc.component_type,''),'label',coalesce(pc.label,''),
        'workflow',coalesce(pc.workflow,''),'reviewRequired',coalesce(pc.review_required,false),
        'reviewStatus',coalesce(pc.review_status,''),'previewUrl',coalesce(pc.preview_url,''),
        'clickupTaskId',coalesce(pc.clickup_task_id,''),'clickupStatus',coalesce(pc.clickup_status,''),
        'lastSyncedAt',case when pc.last_synced_at is null then 0 else extract(epoch from pc.last_synced_at)*1000 end
      ) order by pc.created_at,pc.id) from public.production_components pc where pc.order_item_id=i.id),'[]'::jsonb)
    ) order by i.updated_at nulls last) from public.order_items i where i.order_id=o.id),'[]'::jsonb)
  ) order by o.created_at desc),'[]'::jsonb)
)
from public.orders o left join public.customers c on c.id=o.customer_id;
$$;

revoke all on function public.icetak_admin_customer_lookup(text) from public;
revoke all on function public.icetak_admin_create_whatsapp_paid_order(jsonb) from public;
revoke all on function public.icetak_admin_order_sync_status(uuid) from public;
grant execute on function public.icetak_admin_customer_lookup(text) to authenticated;
grant execute on function public.icetak_admin_create_whatsapp_paid_order(jsonb) to authenticated;
grant execute on function public.icetak_admin_order_sync_status(uuid) to authenticated;

-- Recover abandoned Activepieces leases before claiming new work.
create or replace function public.claim_clickup_production_outbox(p_limit integer default 10)
returns setof public.integration_outbox
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  update public.integration_outbox
  set status='retry',locked_at=null,next_attempt_at=now(),
      last_error=coalesce(last_error,'stale_processing_lease_recovered')
  where provider='activepieces' and event_type='clickup.production.create'
    and status='processing' and locked_at<now()-interval '10 minutes';

  return query
  with picked as (
    select id from public.integration_outbox
    where provider='activepieces' and event_type='clickup.production.create'
      and status in ('pending','retry') and coalesce(next_attempt_at,now())<=now()
    order by created_at limit greatest(1,least(coalesce(p_limit,10),50))
    for update skip locked
  )
  update public.integration_outbox o set status='processing',locked_at=now(),attempts=coalesce(attempts,0)+1
  from picked where o.id=picked.id returning o.*;
end;
$$;

create or replace function public.claim_clickup_shipping_outbox(p_limit integer default 10)
returns setof public.integration_outbox
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  update public.integration_outbox
  set status='retry',locked_at=null,next_attempt_at=now(),
      last_error=coalesce(last_error,'stale_processing_lease_recovered')
  where provider='activepieces' and event_type='clickup.shipping.update'
    and status='processing' and locked_at<now()-interval '10 minutes';

  return query
  with picked as (
    select id from public.integration_outbox
    where provider='activepieces' and event_type='clickup.shipping.update'
      and status in ('pending','retry') and coalesce(next_attempt_at,now())<=now()
    order by created_at limit greatest(1,least(coalesce(p_limit,10),50))
    for update skip locked
  )
  update public.integration_outbox o set status='processing',locked_at=now(),attempts=coalesce(attempts,0)+1
  from picked where o.id=picked.id returning o.*;
end;
$$;
