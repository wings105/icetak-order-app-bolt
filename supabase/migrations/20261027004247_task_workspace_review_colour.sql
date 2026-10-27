CREATE OR REPLACE FUNCTION public.icetak_task_workspace_read(p_task_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with eligible as materialized (
 select s.*,w.stage native_stage,w.version,w.assignee,w.note,w.source_revision,w.updated_by,w.updated_at work_updated_at
 from public.ai_clickup_work_snapshots s left join public.task_workspace_state w using(task_id)
 where (p_task_id is null and s.list_id='18375902' and lower(trim(s.clickup_status)) not in ('lain2','prospect','complete','closed','cancelled','canceled'))
 or (p_task_id is not null and s.task_id=p_task_id)
), bounded as (select * from eligible order by source_updated_at desc,task_id limit 1001),
rows as (
 select s.task_id,s.task_name title,s.order_reference,s.order_id,s.marketplace_order_id,s.component_id,s.mapping_status,
 s.clickup_status source_status,s.source_updated_at,s.observed_at,s.set_labels sets,s.review_status,
 case when s.source_revision=s.source_updated_at and s.native_stage is not null then s.native_stage else s.clickup_status end status,
 (s.source_revision=s.source_updated_at and s.native_stage is not null) native_status,
 coalesce(s.version,0) version,coalesce(s.assignee,'') assignee,coalesce(s.note,'') note,s.updated_by,s.work_updated_at,
 coalesce(o.delivery_phone,f.fields->>'phone','') phone,
 coalesce(o.delivery_name,m.buyer_username,'') customer,
 coalesce(o.courier,m.courier_name,f.fields->>'courier','') courier,
 coalesce(o.payment_status,m.payment_status,'') payment_status,
 coalesce(o.fulfillment_stage,m.fulfillment_status,'') fulfillment_status,
 o.date_need needed_at,m.ship_by_at,
 case when o.id is not null then 'iCetak' when m.id is not null then 'Shopee' else 'ClickUp' end source,
 coalesce(oi.custom_text,oi.wording,f.fields->>'customize name',f.fields->>'customise name','') wording,
 (select opt->>'color' from jsonb_array_elements(coalesce(raw.task->'custom_fields','[]')) cf cross join lateral jsonb_array_elements(coalesce(cf#>'{type_config,options}','[]')) opt where cf->>'id'='01cec4ef-a30b-443d-a43a-9ab09835b78c' and opt->>'name'=s.review_status limit 1) review_color,
 coalesce(f.fields->>'awb link','') awb_link,coalesce(f.fields->>'order_link','') order_link,
 coalesce(f.fields->>'sku','') sku,raw.task->>'due_date' due_date,
 coalesce(p.attachments,'[]') attachments,coalesce(p.comment_images,'[]') comment_images,
 (select count(*) from public.task_workspace_files tf where tf.task_id=s.task_id) file_count,
 case when p_task_id is not null then coalesce((select jsonb_agg(to_jsonb(tf) order by tf.created_at desc) from public.task_workspace_files tf where tf.task_id=s.task_id),'[]') else '[]'::jsonb end files,
 case when p_task_id is not null then coalesce((select jsonb_agg(jsonb_build_object('actor',e.actor,'at',e.created_at,'stage',e.payload->>'stage','note',e.payload->>'note','kind',case when e.payload ? 'file' then 'upload' else 'save' end) order by e.created_at desc) from (select * from public.task_workspace_events ev where ev.task_id=s.task_id order by ev.created_at desc limit 30) e),'[]') else '[]'::jsonb end history
 from bounded s
 left join public.orders o on o.id=s.order_id
 left join public.marketplace_orders m on m.id=s.marketplace_order_id
 left join public.production_components pc on pc.id=s.component_id
 left join public.order_items oi on oi.id=pc.order_item_id
 left join public.clickup_awb_preview_tasks p on p.task_id=s.task_id
 left join lateral (
  select coalesce(e.raw_payload->'task',e.raw_payload#>'{data,task}',e.raw_payload->'current_task') task
  from public.clickup_webhook_events e where e.task_id=s.task_id
   and jsonb_typeof(coalesce(e.raw_payload#>'{task,custom_fields}',e.raw_payload#>'{data,task,custom_fields}',e.raw_payload#>'{current_task,custom_fields}'))='array'
  order by e.task_updated_at desc nulls last,e.received_at desc limit 1
 ) raw on true
 left join lateral (
  select jsonb_object_agg(lower(trim(f->>'name')),case
   when f->>'type'='drop_down' then (select coalesce(opt->>'name',opt->>'label') from jsonb_array_elements(coalesce(f#>'{type_config,options}','[]')) opt where opt->>'id'=f->>'value' or opt->>'orderindex'=f->>'value' limit 1)
   else f->>'value' end) fields
  from jsonb_array_elements(coalesce(raw.task->'custom_fields','[]')) f
  where lower(trim(f->>'name')) in ('phone','sku','customize name','customise name','courier','awb link','order_link')
 ) f on true
 where not exists(select 1 from public.clickup_webhook_events d where d.task_id=s.task_id and lower(d.event_type) in ('taskdeleted','task_deleted') and d.received_at>=s.observed_at)
 order by s.source_updated_at desc,s.task_id limit 1000
)
select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)) from rows r),'[]'),
 'truncated',(select count(*)>1000 from bounded),
 'last_webhook_at',(select max(received_at) from public.clickup_webhook_events where list_id='18375902'),
 'staff',coalesce((select jsonb_agg(jsonb_build_object('username',username,'name',coalesce(display_name,username)) order by username) from public.admin_users where is_active),'[]'));
$function$
