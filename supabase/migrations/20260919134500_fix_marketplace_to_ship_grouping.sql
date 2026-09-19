-- Admin V2: align Marketplace To Ship with Shopee grouping.
-- TO_SHIP = READY_TO_SHIP + PROCESSED, with subcounts exposed for To Process / Processed.

CREATE OR REPLACE FUNCTION public.icetak_admin_marketplace_orders(p_search text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_provider text DEFAULT 'all'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_q text := lower(trim(coalesce(p_search,'')));
  v_digits text := regexp_replace(lower(trim(coalesce(p_search,''))),'[^0-9]','','g');
  v_limit int := greatest(1,least(coalesce(p_limit,50),100));
  v_offset int := greatest(0,coalesce(p_offset,0));
  v_total bigint;
  v_rows jsonb;
begin
  if not (
    public.icetak_admin_crm_can_view()
    or public.icetak_admin_has_permission('view_orders')
    or public.icetak_admin_has_permission('approve_production')
    or public.icetak_admin_has_permission('view_finance')
    or public.icetak_admin_has_permission('manage_finance')
  ) then raise exception 'Forbidden'; end if;

  with filtered as (
    select o.id
    from public.marketplace_orders o
    left join public.marketplace_customers mc on mc.id=o.buyer_customer_id
    left join public.customer_master cm on cm.id=mc.customer_master_id
    where (coalesce(p_provider,'all')='all' or lower(o.provider)=lower(p_provider))
      and (
        coalesce(p_status,'all')='all'
        or (upper(coalesce(p_status,''))='TO_SHIP' and upper(coalesce(o.current_status,'')) in ('READY_TO_SHIP','PROCESSED'))
        or (upper(coalesce(p_status,''))<>'TO_SHIP' and lower(coalesce(o.current_status,''))=lower(p_status))
      )
      and (
        v_q=''
        or lower(coalesce(o.order_sn,'')) like '%'||v_q||'%'
        or lower(coalesce(o.buyer_username,'')) like '%'||v_q||'%'
        or lower(coalesce(o.courier_name,'')) like '%'||v_q||'%'
        or lower(coalesce(cm.display_name,'')) like '%'||v_q||'%'
        or lower(coalesce(cm.admin_name_override,'')) like '%'||v_q||'%'
        or (v_digits<>'' and lower(coalesce(cm.primary_phone_normalized,'')) like '%'||v_digits||'%')
        or exists (
          select 1 from public.marketplace_order_items i
          where i.order_id=o.id and i.is_current=true
            and (
              lower(coalesce(i.title,'')) like '%'||v_q||'%'
              or lower(coalesce(i.item_sku,'')) like '%'||v_q||'%'
              or lower(coalesce(i.variation_sku,'')) like '%'||v_q||'%'
              or lower(coalesce(i.variation_name,'')) like '%'||v_q||'%'
            )
        )
        or exists (
          select 1 from public.marketplace_shipments s
          where s.order_id=o.id
            and (
              lower(coalesce(s.tracking_number,'')) like '%'||v_q||'%'
              or lower(coalesce(s.package_number,'')) like '%'||v_q||'%'
              or lower(coalesce(s.courier_name,'')) like '%'||v_q||'%'
            )
        )
      )
  )
  select count(*) into v_total from filtered;

  with filtered as (
    select o.*
    from public.marketplace_orders o
    left join public.marketplace_customers mc on mc.id=o.buyer_customer_id
    left join public.customer_master cm on cm.id=mc.customer_master_id
    where (coalesce(p_provider,'all')='all' or lower(o.provider)=lower(p_provider))
      and (
        coalesce(p_status,'all')='all'
        or (upper(coalesce(p_status,''))='TO_SHIP' and upper(coalesce(o.current_status,'')) in ('READY_TO_SHIP','PROCESSED'))
        or (upper(coalesce(p_status,''))<>'TO_SHIP' and lower(coalesce(o.current_status,''))=lower(p_status))
      )
      and (
        v_q=''
        or lower(coalesce(o.order_sn,'')) like '%'||v_q||'%'
        or lower(coalesce(o.buyer_username,'')) like '%'||v_q||'%'
        or lower(coalesce(o.courier_name,'')) like '%'||v_q||'%'
        or lower(coalesce(cm.display_name,'')) like '%'||v_q||'%'
        or lower(coalesce(cm.admin_name_override,'')) like '%'||v_q||'%'
        or (v_digits<>'' and lower(coalesce(cm.primary_phone_normalized,'')) like '%'||v_digits||'%')
        or exists (
          select 1 from public.marketplace_order_items i
          where i.order_id=o.id and i.is_current=true
            and (
              lower(coalesce(i.title,'')) like '%'||v_q||'%'
              or lower(coalesce(i.item_sku,'')) like '%'||v_q||'%'
              or lower(coalesce(i.variation_sku,'')) like '%'||v_q||'%'
              or lower(coalesce(i.variation_name,'')) like '%'||v_q||'%'
            )
        )
        or exists (
          select 1 from public.marketplace_shipments s
          where s.order_id=o.id
            and (
              lower(coalesce(s.tracking_number,'')) like '%'||v_q||'%'
              or lower(coalesce(s.package_number,'')) like '%'||v_q||'%'
              or lower(coalesce(s.courier_name,'')) like '%'||v_q||'%'
            )
        )
      )
    order by coalesce(o.placed_at,o.created_at) desc, o.id
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'provider',f.provider,'orderSn',f.order_sn,
    'buyerUsername',coalesce(f.buyer_username,''),'status',coalesce(f.current_status,''),
    'paymentStatus',coalesce(f.payment_status,''),'fulfillmentStatus',coalesce(f.fulfillment_status,''),
    'courier',coalesce(f.courier_name,''),'placedAt',f.placed_at,'shipByAt',f.ship_by_at,
    'updatedAt',f.updated_at,'detailComplete',coalesce(f.detail_complete,false),
    'customerMasterId',cm.id,
    'customerName',coalesce(nullif(cm.admin_name_override,''),nullif(cm.display_name,''),f.buyer_username,''),
    'phone',coalesce(cm.primary_phone_normalized,''),
    'buyerPaid',coalesce(fin.buyer_paid,0),'currency',coalesce(fin.currency,f.currency,'MYR'),
    'paymentMethod',coalesce(fin.payment_method,''),'tracking',coalesce(ship.tracking_number,''),
    'shipmentStatus',coalesce(ship.shipment_status,''),'itemCount',coalesce(items.item_count,0),
    'items',coalesce(items.items,'[]'::jsonb)
  ) order by coalesce(f.placed_at,f.created_at) desc),'[]'::jsonb)
  into v_rows
  from filtered f
  left join public.marketplace_customers mc on mc.id=f.buyer_customer_id
  left join public.customer_master cm on cm.id=mc.customer_master_id
  left join public.marketplace_order_financials fin on fin.order_id=f.id
  left join lateral (
    select s.tracking_number,s.shipment_status
    from public.marketplace_shipments s
    where s.order_id=f.id
    order by coalesce(s.last_event_at,s.updated_at,s.created_at) desc
    limit 1
  ) ship on true
  left join lateral (
    select count(*)::int item_count,
      jsonb_agg(jsonb_build_object(
        'title',i.title,'sku',coalesce(i.item_sku,''),'variation',coalesce(i.variation_name,''),
        'qty',i.quantity,'imageUrl',coalesce(i.image_url,'')
      ) order by i.line_no) items
    from public.marketplace_order_items i
    where i.order_id=f.id and i.is_current=true
  ) items on true;

  return jsonb_build_object(
    'ok',true,'total',v_total,'limit',v_limit,'offset',v_offset,'rows',v_rows,
    'summary',jsonb_build_object(
      'all',(select count(*) from public.marketplace_orders),
      'toShip',(select count(*) from public.marketplace_orders where current_status in ('READY_TO_SHIP','PROCESSED')),
      'toProcess',(select count(*) from public.marketplace_orders where current_status='READY_TO_SHIP'),
      'processed',(select count(*) from public.marketplace_orders where current_status='PROCESSED'),
      'readyToShip',(select count(*) from public.marketplace_orders where current_status='READY_TO_SHIP'),
      'shipped',(select count(*) from public.marketplace_orders where current_status='SHIPPED'),
      'completed',(select count(*) from public.marketplace_orders where current_status='COMPLETED'),
      'cancelled',(select count(*) from public.marketplace_orders where lower(coalesce(current_status,'')) like '%cancel%')
    )
  );
end
$function$
;

revoke all on function public.icetak_admin_marketplace_orders(text,text,text,integer,integer) from public, anon;
grant execute on function public.icetak_admin_marketplace_orders(text,text,text,integer,integer) to authenticated;
