create or replace function public.icetak_customer_order_dashboard(p_order_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_order public.orders%rowtype;
  v_shipment public.shipments%rowtype;
begin
  select * into v_order from public.orders where public_token=p_order_token limit 1;
  if v_order.id is null then
    return jsonb_build_object('success',false,'error',jsonb_build_object('code','ORDER_NOT_FOUND'));
  end if;
  select * into v_shipment
  from public.shipments
  where order_id=v_order.id or (v_order.tracking is not null and tracking_no=v_order.tracking)
  order by created_at desc limit 1;

  return jsonb_build_object(
    'success',true,
    'order',jsonb_build_object(
      'id',v_order.id,'order_no',coalesce(v_order.order_no,v_order.order_id),'status',v_order.status,
      'admin_status',v_order.admin_status,'payment_status',v_order.payment_status,'total',v_order.total,
      'date_need',v_order.date_need,'delivery_method',v_order.delivery_method,'customer_name',v_order.delivery_name,
      'courier',coalesce(v_shipment.courier,v_order.courier),'tracking_no',coalesce(v_shipment.tracking_no,v_order.tracking),
      'tracking_link',coalesce(v_shipment.tracking_link,v_order.tracking_link),'shipment_status',coalesce(v_shipment.status,v_order.shipment_status),
      'shipment_status_group',coalesce(v_shipment.status_group,v_order.shipment_status_group),'created_at',v_order.created_at,'updated_at',v_order.updated_at
    ),
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'title',i.title,'product_type',coalesce(i.product_type,i.k),'qty',i.qty,'price',i.price,
        'size',i.size,'style',i.style,'wording',coalesce(i.wording,i.custom_text),'workflow',i.workflow,
        'review_required',i.review_required,'design_preview_url',i.design_preview_url,
        'product_id',i.product_id,'product_variant_id',i.product_variant_id,'catalog_slug',i.catalog_slug,
        'catalog_clickup_task_id',i.catalog_clickup_task_id,'wording_mode',i.wording_mode,
        'customization',i.customization,'product_snapshot',i.product_snapshot,
        'image_url',coalesce(nullif(i.product_snapshot->>'image_url',''),i.design_preview_url)
      ) order by i.id)
      from public.order_items i where i.order_id=v_order.id
    ),'[]'::jsonb),
    'shipment',case when v_shipment.id is null then null else jsonb_build_object(
      'id',v_shipment.id,'courier',v_shipment.courier,'tracking_no',v_shipment.tracking_no,
      'tracking_link',v_shipment.tracking_link,'status',v_shipment.status,'status_group',v_shipment.status_group,
      'normalized_status',v_shipment.normalized_status,'awb_pdf_url',coalesce(v_shipment.awb_pdf_url,v_shipment.connote_url),
      'booked_at',v_shipment.booked_at,'shipped_at',v_shipment.shipped_at,'delivered_at',v_shipment.delivered_at,
      'updated_at',v_shipment.updated_at,'pod_status',v_shipment.pod_status,'pod_count',v_shipment.pod_count,
      'proof_of_delivery_available',v_shipment.pod_count>0,'public_tracking_token',v_shipment.public_tracking_token
    ) end,
    'events',case when v_shipment.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'status',e.status,'status_group',e.status_group,'normalized_status',e.normalized_status,
        'event_name',e.event_name,'event_time',e.event_time,'location',e.location,'description',e.description
      ) order by coalesce(e.event_time,e.created_at),e.created_at)
      from public.shipment_events e where e.shipment_id=v_shipment.id
    ),'[]'::jsonb) end,
    'pod',case when v_shipment.id is null then '[]'::jsonb else public.shipping_pod_metadata(v_shipment.id,v_shipment.public_tracking_token) end
  );
end;
$function$;
