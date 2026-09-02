-- Burn Away uses one shared shape while retaining independent edible/wafer sizes.
create or replace function public.icetak_burnaway_component_metadata(
  p_item public.order_items,
  p_component_type text
) returns jsonb
language sql
stable
as $function$
  select case
    when lower(coalesce(p_item.k,p_item.product_type,'')) <> 'burnaway' then '{}'::jsonb
    else jsonb_strip_nulls(jsonb_build_object(
      'size', coalesce(
        nullif(p_item.customization#>>array['layers',lower(p_component_type),'size'],''),
        nullif(p_item.size,'')
      ),
      'shape', coalesce(
        nullif(p_item.customization->>'shape',''),
        nullif(p_item.style,''),
        nullif(p_item.customization#>>array['layers','edible','shape'],''),
        nullif(p_item.customization#>>array['layers','wafer','shape'],'')
      ),
      'wording', coalesce(
        nullif(p_item.customization#>>array['layers',lower(p_component_type),'wording'],''),
        nullif(p_item.wording,''),
        nullif(p_item.custom_text,'')
      ),
      'reference_url', coalesce(
        nullif(p_item.customization#>>array['layers',lower(p_component_type),'referenceUrl'],''),
        nullif(p_item.customization#>>array['layers',lower(p_component_type),'reference_url'],''),
        nullif(p_item.customization->>'reference_url',''),
        nullif(p_item.product_snapshot->>'image_url','')
      )
    ))
  end
$function$;

-- Normalize existing Burn Away rows to the same canonical shape for both layers.
with normalized as (
  select id,coalesce(
    nullif(customization->>'shape',''),
    nullif(style,''),
    nullif(customization#>>'{layers,edible,shape}',''),
    nullif(customization#>>'{layers,wafer,shape}',''),
    'Round / Bulat'
  ) as shared_shape
  from public.order_items
  where lower(coalesce(k,product_type,''))='burnaway'
)
update public.order_items oi
set
  style=n.shared_shape,
  customization=coalesce(oi.customization,'{}'::jsonb)||jsonb_build_object(
    'shape',n.shared_shape,
    'layers',jsonb_build_object(
      'edible',coalesce(oi.customization#>'{layers,edible}','{}'::jsonb)||jsonb_build_object('shape',n.shared_shape),
      'wafer',coalesce(oi.customization#>'{layers,wafer}','{}'::jsonb)||jsonb_build_object('shape',n.shared_shape)
    )
  ),
  updated_at=now()
from normalized n
where oi.id=n.id;

update public.production_components pc
set metadata=coalesce(pc.metadata,'{}'::jsonb)||public.icetak_burnaway_component_metadata(oi,pc.component_type),
    updated_at=now()
from public.order_items oi
where oi.id=pc.order_item_id
  and lower(coalesce(oi.k,oi.product_type,''))='burnaway';

revoke all on function public.icetak_burnaway_component_metadata(public.order_items,text) from public,anon,authenticated;
grant execute on function public.icetak_burnaway_component_metadata(public.order_items,text) to service_role;
