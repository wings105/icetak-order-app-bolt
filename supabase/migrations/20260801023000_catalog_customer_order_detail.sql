create or replace function public.icetak_customer_order_detail(p_order_token text)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
 'order',jsonb_build_object(
  'id',o.id,'order_id',coalesce(o.order_id,o.order_no),'order_token',o.public_token,'status',o.status,
  'payment_status',o.payment_status,'total',o.total,'date_need',o.date_need,'delivery',coalesce(o.delivery,o.delivery_method),
  'tracking',coalesce(o.tracking,''),'courier',coalesce(o.courier,''),'tracking_link',coalesce(o.tracking_link,''),'created_at',o.created_at
 ),
 'items',coalesce((select jsonb_agg(jsonb_build_object(
  'id',i.id,'title',coalesce(i.title,'Item'),'product_type',coalesce(i.product_type,i.k,''),'qty',coalesce(i.qty,1),
  'unit_price',coalesce(i.price,0),'size',coalesce(i.size,''),'style',coalesce(i.style,''),'wording_mode',coalesce(i.wording_mode,''),
  'wording',coalesce(i.custom_text,i.wording,''),'customization',coalesce(i.customization,'{}'::jsonb),
  'product_snapshot',coalesce(i.product_snapshot,'{}'::jsonb),'catalog_slug',coalesce(i.catalog_slug,''),
  'review_required',coalesce(i.review_required,false),'workflow',coalesce(i.workflow,''),'preview_url',coalesce(i.design_preview_url,''),
  'components',coalesce((select jsonb_agg(jsonb_build_object(
   'id',pc.id,'type',pc.component_type,'label',pc.label,'workflow',coalesce(pc.workflow,''),
   'review_required',coalesce(pc.review_required,false),'review_status',coalesce(pc.review_status,''),
   'preview_url',coalesce(pc.preview_url,''),'clickup_status',coalesce(pc.clickup_status,'')
  ) order by pc.created_at) from public.production_components pc where pc.order_item_id=i.id),'[]'::jsonb)
 ) order by i.updated_at nulls last) from public.order_items i where i.order_id=o.id),'[]'::jsonb)
)
from public.orders o where o.public_token=p_order_token limit 1;
$$;
revoke all on function public.icetak_customer_order_detail(text) from public;
grant execute on function public.icetak_customer_order_detail(text) to anon,authenticated,service_role;
comment on function public.icetak_customer_order_detail(text) is 'Customer order dashboard payload including catalogue configuration snapshots and production components.';
