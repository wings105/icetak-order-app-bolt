create or replace function public.icetak_admin_order_detail_v3(p_order_ref text)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $function$
declare base jsonb; enriched jsonb;
begin
  base:=public.icetak_admin_order_detail_v2(p_order_ref);
  if base is null then return null; end if;
  select coalesce(jsonb_agg(
    elem||jsonb_build_object(
      'process',coalesce(nullif(oi.customization->>'admin_process',''),nullif(elem->>'process',''),'Pre-order'),
      'review',case when coalesce(oi.review_required,false) then 'Need Review' else 'No Review' end,
      'referenceUrl',coalesce(nullif(oi.customization->>'reference_url',''),nullif(oi.product_snapshot->>'image_url',''),''),
      'previewUrl',coalesce(nullif(elem->>'previewUrl',''),nullif(oi.design_preview_url,''),nullif(oi.customization->>'reference_url',''),nullif(oi.product_snapshot->>'image_url',''),''),
      'customization',coalesce(oi.customization,'{}'::jsonb),
      'components',coalesce((select jsonb_agg(jsonb_build_object(
        'id',pc.id,'label',coalesce(pc.label,''),'workflow',coalesce(pc.workflow,''),'customerLabel',coalesce(pc.customer_label,''),
        'reviewStatus',coalesce(pc.review_status,''),'previewUrl',coalesce(pc.preview_url,''),'progressPercent',coalesce(pc.progress_percent,0),
        'clickupTaskId',coalesce(pc.clickup_task_id,''),'clickupStatus',coalesce(pc.clickup_status,''),'metadata',coalesce(pc.metadata,'{}'::jsonb)
      ) order by pc.created_at,pc.id) from public.production_components pc where pc.order_item_id=oi.id),'[]'::jsonb)
    ) order by ord
  ),'[]'::jsonb) into enriched
  from jsonb_array_elements(coalesce(base->'items','[]'::jsonb)) with ordinality e(elem,ord)
  left join public.order_items oi on oi.id=nullif(elem->>'id','')::uuid;
  return jsonb_set(base,'{items}',enriched,true);
end
$function$;

revoke all on function public.icetak_admin_order_detail_v3(text) from public,anon;
grant execute on function public.icetak_admin_order_detail_v3(text) to authenticated,service_role;
