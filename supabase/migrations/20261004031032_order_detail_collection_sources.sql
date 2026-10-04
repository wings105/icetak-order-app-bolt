create or replace function public.icetak_order_detail_sources(p_keys jsonb default '[]') returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
with selected as materialized (
 select s.task_id,s.order_id,s.marketplace_order_id,coalesce(w.raw_payload->'task',w.raw_payload#>'{data,task}',w.raw_payload->'current_task') task
 from ai_clickup_work_snapshots s
 left join lateral(select raw_payload from clickup_webhook_events w where w.task_id=s.task_id
 and jsonb_typeof(coalesce(w.raw_payload#>'{task,custom_fields}',w.raw_payload#>'{data,task,custom_fields}',w.raw_payload#>'{current_task,custom_fields}'))='array'
 order by w.task_updated_at desc nulls last,w.received_at desc limit 1) w on true
 where jsonb_array_length(p_keys)=0 or p_keys ? ('icetak:'||s.order_id::text) or p_keys ? ('shopee:'||s.marketplace_order_id::text)
), details as (
 select task_id,jsonb_build_object(
 'customize_name',(select f->>'value' from jsonb_array_elements(coalesce(task->'custom_fields','[]')) f where lower(trim(f->>'name'))='customize name' limit 1),
 'confirmed',(select f->'value' from jsonb_array_elements(coalesce(task->'custom_fields','[]')) f where lower(trim(f->>'name'))='confirmed' limit 1),
 'sku',(select f->>'value' from jsonb_array_elements(coalesce(task->'custom_fields','[]')) f where lower(trim(f->>'name'))='sku' limit 1)) detail from selected
)
select jsonb_build_object('tasks',coalesce((select jsonb_object_agg(task_id,detail) from details),'{}'),
 'links',coalesce((select jsonb_object_agg('shopee:'||m.id::text,jsonb_build_object('internal_order_id',m.internal_order_id)) from marketplace_orders m where jsonb_array_length(p_keys)=0 or p_keys ? ('shopee:'||m.id::text)),'{}'));
$$;
revoke all on function public.icetak_order_detail_sources(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_order_detail_sources(jsonb) to service_role;
