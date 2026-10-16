-- Read-only production view over the existing ClickUp ingestion. No source replay,
-- lifecycle changes, new cron or public client access.
create function public.icetak_acrylic_production_snapshot()
returns jsonb language sql stable security invoker set search_path='' as $fn$
with active as materialized (
 select s.* from public.ai_clickup_work_snapshots s
 where lower(trim(s.clickup_status)) in ('acrylic','artpaper','review','cake topper - printing')
), snapshots as materialized (
 select s.*,raw.task,raw.received_at as raw_received_at
 from active s
 join lateral (
  select coalesce(e.raw_payload->'task',e.raw_payload->'data'->'task',e.raw_payload->'current_task') task,e.received_at
  from public.clickup_webhook_events e where e.task_id=s.task_id and
   jsonb_typeof(coalesce(e.raw_payload#>'{task,custom_fields}',e.raw_payload#>'{data,task,custom_fields}',e.raw_payload#>'{current_task,custom_fields}'))='array'
  order by e.task_updated_at desc nulls last,e.received_at desc limit 1
 ) raw on true
 where not exists (select 1 from public.clickup_webhook_events d where d.task_id=s.task_id
  and lower(d.event_type) in ('taskdeleted','task_deleted') and d.received_at>=raw.received_at)
), fields as materialized (
 select s.*,
  coalesce((select jsonb_agg(coalesce(opt->>'label',opt->>'name'))
   from jsonb_array_elements(s.task->'custom_fields') f
   cross join lateral jsonb_array_elements(coalesce(f->'type_config'->'options','[]')) opt
   where (lower(trim(f->>'name'))='job' or f->>'id'='83c94d47-6886-4c89-a55f-301f958b9879')
    and (case when jsonb_typeof(f->'value')='array' then (f->'value') ? (opt->>'id')
      else f->>'value' in (opt->>'id',opt->>'orderindex') end)), '[]') jobs,
  (select f->>'value' from jsonb_array_elements(s.task->'custom_fields') f where lower(trim(f->>'name'))='sku' and jsonb_typeof(f->'value')='string' limit 1) sku,
  (select case when jsonb_typeof(f->'value')='string' and f->>'type' not in ('drop_down','labels') then f->>'value'
    else (select string_agg(coalesce(opt->>'label',opt->>'name'),', ') from jsonb_array_elements(coalesce(f->'type_config'->'options','[]')) opt
     where case when jsonb_typeof(f->'value')='array' then (f->'value') ? (opt->>'id') else f->>'value' in (opt->>'id',opt->>'orderindex') end) end
   from jsonb_array_elements(s.task->'custom_fields') f where lower(trim(f->>'name')) in ('acrylic color','acrylic colour','color acrylic','colour acrylic','warna acrylic','colour','color') limit 1) colour_field,
  (select f->>'value' from jsonb_array_elements(s.task->'custom_fields') f where lower(trim(f->>'name')) in ('size','saiz') and jsonb_typeof(f->'value')='string' limit 1) size_field,
  (select f->>'value' from jsonb_array_elements(s.task->'custom_fields') f where lower(trim(f->>'name')) in ('quantity','qty','kuantiti') and (f->>'value') ~ '^[1-9][0-9]*$' limit 1) quantity_field
 from snapshots s
), selected as materialized (
 select * from fields f where exists(select 1 from jsonb_array_elements_text(f.jobs) j where lower(trim(j)) in ('acrylic cake topper','artpaper'))
), bounded as (select * from selected order by source_updated_at desc nulls last,task_id limit 501),
rows as (
 select s.task_id,s.task_name title,s.clickup_status status,s.order_reference,s.jobs,s.set_labels sets,
  coalesce(s.sku,'') sku,s.task->>'due_date' due_date,s.colour_field,s.size_field,s.quantity_field,
  greatest(s.observed_at,s.raw_received_at,p.received_at) updated_at,
  coalesce(p.attachments,'[]') attachments,coalesce(p.comment_images,'[]') comment_images,
  coalesce((select jsonb_agg(jsonb_build_object('colour',i.colour,'size',i.size,'qty',i.qty)) from (
   select finance.acrylic_colour_name(oi.style) colour,oi.size,oi.qty
    from public.production_components pc join public.order_items oi on oi.id=pc.order_item_id
    where (pc.id=s.component_id or pc.clickup_task_id=s.task_id) and oi.product_type in ('acrylic','mirror')
   union all
   select finance.acrylic_colour(mi.variation_name,mi.variation_sku,mi.title),mi.variation_name,mi.quantity
    from public.marketplace_order_items mi where mi.order_id=s.marketplace_order_id and mi.is_current
    and (lower(coalesce(mi.item_sku,'')) like '%acrylic%' or lower(mi.title) like '%acrylic%' or lower(mi.title) like '%artpaper%')
    and (nullif(s.sku,'') is null or mi.item_sku=s.sku or mi.variation_sku=s.sku)
  ) i),'[]') db_items
 from bounded s left join public.clickup_awb_preview_tasks p on p.task_id=s.task_id
 order by s.source_updated_at desc nulls last,s.task_id limit 500
)
select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r)) from rows r),'[]'),
 'truncated',(select count(*)>500 from bounded));
$fn$;
revoke all on function public.icetak_acrylic_production_snapshot() from public,anon,authenticated;
grant execute on function public.icetak_acrylic_production_snapshot() to service_role;
