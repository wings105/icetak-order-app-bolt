create or replace function public.finance_admin_qrpay_order_progress(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
with component_rows as (
  select
    pc.*,
    case lower(coalesce(pc.customer_stage,''))
      when 'order received' then 10
      when 'design editing' then 20
      when 'waiting review' then 30
      when 'approved' then 40
      when 'production' then 50
      when 'finishing' then 60
      when 'ready' then 70
      when 'delivered' then 80
      else case
        when lower(coalesce(pc.clickup_status,''))='complete' or coalesce(pc.progress_percent,0)>=100 then 70
        else 10
      end
    end stage_rank,
    (
      lower(coalesce(pc.clickup_status,''))='complete'
      or coalesce(pc.progress_percent,0)>=100
      or lower(coalesce(pc.customer_stage,'')) in ('ready','delivered')
    ) is_complete
  from public.production_components pc
  where pc.order_id=p_order_id
), component_summary as (
  select
    count(*)::integer total,
    count(*) filter(where is_complete)::integer complete,
    coalesce(round(avg(greatest(0,least(100,coalesce(progress_percent,0))))),0)::integer progress,
    coalesce((array_agg(
      coalesce(nullif(customer_label,''),nullif(customer_stage,''),nullif(clickup_status,''),'Order Received')
      order by stage_rank,set_index nulls last,created_at,id
    ))[1],'Order Received') bottleneck_label,
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',id,
      'label',coalesce(nullif(label,''),nullif(component_type,''),'Component'),
      'customer_stage',nullif(customer_stage,''),
      'customer_label',coalesce(nullif(customer_label,''),nullif(customer_stage,''),'Order Received'),
      'progress_percent',greatest(0,least(100,coalesce(progress_percent,0))),
      'clickup_task_id',nullif(clickup_task_id,''),
      'clickup_status',nullif(clickup_status,''),
      'task_url',case when nullif(clickup_task_id,'') is null then null else 'https://app.clickup.com/t/3747262/'||clickup_task_id end,
      'is_complete',is_complete
    )) order by set_index nulls last,created_at,id) filter(where id is not null),'[]'::jsonb) components
  from component_rows
), shipment as (
  select s.status,s.status_group,s.tracking_no,s.tracking_link,s.courier,s.updated_at
  from public.shipments s
  where s.order_id=p_order_id and s.cancelled_at is null
  order by s.updated_at desc nulls last,s.created_at desc
  limit 1
), progress as (
  select
    o.*,
    cs.total components_total,
    cs.complete components_complete,
    cs.progress progress_percent,
    cs.bottleneck_label,
    cs.components,
    coalesce(nullif(o.shipment_status,''),nullif(s.status,'')) current_shipment_status,
    coalesce(nullif(o.shipment_status_group,''),nullif(s.status_group,'')) current_shipment_group,
    coalesce(nullif(o.tracking,''),nullif(s.tracking_no,'')) current_tracking,
    coalesce(nullif(o.tracking_link,''),nullif(s.tracking_link,'')) current_tracking_link,
    coalesce(nullif(o.courier,''),nullif(s.courier,'')) current_courier,
    lower(coalesce(o.delivery_method,o.delivery,'')) delivery_value,
    lower(coalesce(o.payment_status,o.payment,'')) payment_value,
    (
      lower(coalesce(o.status,'')) like '%cancel%'
      or lower(coalesce(o.admin_status,'')) like '%cancel%'
      or lower(coalesce(o.fulfillment_stage,''))='cancelled'
    ) is_cancelled
  from public.orders o
  cross join component_summary cs
  left join shipment s on true
  where o.id=p_order_id
)
select jsonb_strip_nulls(jsonb_build_object(
  'order_status',status,
  'admin_status',admin_status,
  'fulfillment_stage',fulfillment_stage,
  'delivery_method',coalesce(delivery_method,delivery),
  'production_approved',coalesce(production_approved,false),
  'production_completed_at',production_completed_at,
  'pickup_ready_at',pickup_ready_at,
  'pickup_collected_at',pickup_collected_at,
  'delivered_at',delivered_at,
  'components_total',components_total,
  'components_complete',components_complete,
  'progress_percent',progress_percent,
  'components',components,
  'shipment_status',current_shipment_status,
  'shipment_status_group',current_shipment_group,
  'tracking_number',current_tracking,
  'tracking_link',current_tracking_link,
  'courier',current_courier,
  'overall_label',case
    when is_cancelled then 'Cancelled'
    when pickup_collected_at is not null or lower(coalesce(fulfillment_stage,''))='collected' then 'Customer Collected'
    when delivered_at is not null or lower(coalesce(current_shipment_group,''))='delivered' then 'Delivered'
    when lower(coalesce(current_shipment_group,''))='out_for_delivery' then 'Out for Delivery'
    when lower(coalesce(current_shipment_group,'')) in ('picked_up','shipped','in_transit') then
      case when lower(coalesce(current_shipment_group,''))='picked_up' then 'Picked Up' else 'In Transit' end
    when lower(coalesce(current_shipment_group,''))='awb_created' or current_tracking is not null then 'AWB Created'
    when pickup_ready_at is not null or lower(coalesce(fulfillment_stage,''))='ready_for_pickup' then 'Ready for Pickup'
    when components_total>0 then bottleneck_label
    when coalesce(production_approved,false) then coalesce(nullif(admin_status,''),nullif(status,''),'Production')
    else coalesce(nullif(admin_status,''),nullif(status,''),'Order Received')
  end,
  'overall_tone',case
    when is_cancelled then 'error'
    when pickup_collected_at is not null or delivered_at is not null or lower(coalesce(current_shipment_group,''))='delivered' then 'success'
    when pickup_ready_at is not null or lower(coalesce(current_shipment_group,'')) in ('out_for_delivery','picked_up','shipped','in_transit') then 'info'
    when components_total>0 and components_complete=components_total then 'success'
    when components_total>0 then 'warning'
    else 'neutral'
  end,
  'available_actions',to_jsonb(array_remove(array[
    case when not is_cancelled
      and not coalesce(production_approved,false)
      and payment_value similar to '%(paid|matched|payment_received)%'
      and (customer_confirm_token is null or coalesce(customer_confirmed,false))
      then 'approve_production' end,
    case when not is_cancelled
      and delivery_value like '%pickup%'
      and payment_value similar to '%(paid|matched|payment_received)%'
      and coalesce(production_approved,false)
      and pickup_ready_at is null and pickup_collected_at is null
      and (components_total=0 or components_complete=components_total)
      then 'ready_pickup' end,
    case when not is_cancelled
      and delivery_value like '%pickup%'
      and payment_value similar to '%(paid|matched|payment_received)%'
      and pickup_ready_at is not null and pickup_collected_at is null
      then 'pickup_collected' end
  ]::text[],null)),
  'task_status_source','clickup_webhook',
  'shipment_status_source','parceldaily'
))
from progress;
$$;

create or replace function public.finance_admin_qrpay_range_with_progress(p_from date default null,p_to date default null)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
with base as (
  select public.finance_admin_qrpay_range(p_from,p_to) value
), enriched_rows as (
  select coalesce(jsonb_agg(
    r.value || jsonb_build_object(
      'order_progress',case
        when nullif(r.value->>'order_id','') is null then null
        else public.finance_admin_qrpay_order_progress((r.value->>'order_id')::uuid)
      end
    ) order by r.ordinality
  ),'[]'::jsonb) value
  from base b
  cross join lateral jsonb_array_elements(coalesce(b.value->'rows','[]'::jsonb)) with ordinality r(value,ordinality)
)
select b.value || jsonb_build_object('rows',e.value)
from base b cross join enriched_rows e;
$$;

create or replace function public.finance_admin_qrpay_order_action(p_order_id uuid,p_action text)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_action text:=lower(trim(coalesce(p_action,'')));
begin
  if p_order_id is null or v_action not in ('approve_production','ready_pickup','pickup_collected') then
    raise exception 'Unsupported QRPay order action';
  end if;

  if v_action='ready_pickup' and exists(
    select 1
    from public.production_components pc
    where pc.order_id=p_order_id
      and not (
        lower(coalesce(pc.clickup_status,''))='complete'
        or coalesce(pc.progress_percent,0)>=100
        or lower(coalesce(pc.customer_stage,'')) in ('ready','delivered')
      )
  ) then
    raise exception 'Semua production task mesti complete sebelum Ready Pickup';
  end if;

  return public.icetak_admin_order_action(jsonb_build_object(
    'order_db_id',p_order_id,
    'action',v_action
  ));
end;
$$;

revoke all on function public.finance_admin_qrpay_order_progress(uuid) from public,anon,authenticated;
revoke all on function public.finance_admin_qrpay_range_with_progress(date,date) from public,anon,authenticated;
revoke all on function public.finance_admin_qrpay_order_action(uuid,text) from public,anon;
grant execute on function public.finance_admin_qrpay_order_progress(uuid) to service_role;
grant execute on function public.finance_admin_qrpay_range_with_progress(date,date) to service_role;
grant execute on function public.finance_admin_qrpay_order_action(uuid,text) to authenticated;

comment on function public.finance_admin_qrpay_order_progress(uuid) is 'Canonical order, production component and courier progress payload for the owner QRPay review.';
comment on function public.finance_admin_qrpay_range_with_progress(date,date) is 'QRPay date range enriched with linked order and component progress.';
comment on function public.finance_admin_qrpay_order_action(uuid,text) is 'Authenticated audited QRPay quick actions; task completion guard applies before Ready Pickup.';
