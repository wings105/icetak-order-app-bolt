-- Order System only. Keep complete read coverage and the existing service-only RPC.
-- Index latest full ClickUp snapshots in exactly the order used by the panel.
-- The predicate preserves latest qualifying event semantics; it does not rewrite history.
set local lock_timeout='5s';
set local statement_timeout='55s';
create index if not exists clickup_events_focus_full_task_latest
 on public.clickup_webhook_events(task_id,task_updated_at desc nulls last,received_at desc)
 where jsonb_typeof(coalesce(raw_payload#>'{task,custom_fields}',raw_payload#>'{data,task,custom_fields}',raw_payload#>'{current_task,custom_fields}'))='array';
-- Global max(received_at) must not scan the archive on every refresh.
create index if not exists clickup_events_focus_received_latest on public.clickup_webhook_events(received_at desc);

-- Build the task date map once instead of re-scanning it for every order.
CREATE OR REPLACE FUNCTION public.icetak_customer_focus_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with task_dates as materialized (
 select s.task_id,
 case when task->>'due_date' ~ '^\d{10,16}$' then to_timestamp((task->>'due_date')::numeric/1000) end due_at,
 (select min(case when f->>'value' ~ '^\d{10,16}$' then to_timestamp((f->>'value')::numeric/1000) end)
 from jsonb_array_elements(coalesce(task->'custom_fields','[]')) f where lower(trim(f->>'name')) in ('date needed','tarikh perlu')) needed_at
 from ai_clickup_work_snapshots s left join lateral (
 select coalesce(w.raw_payload->'task',w.raw_payload#>'{data,task}',w.raw_payload->'current_task') task from clickup_webhook_events w
 where w.task_id=s.task_id and jsonb_typeof(coalesce(w.raw_payload#>'{task,custom_fields}',w.raw_payload#>'{data,task,custom_fields}',w.raw_payload#>'{current_task,custom_fields}'))='array'
 order by w.task_updated_at desc nulls last,w.received_at desc limit 1
 ) latest on true
), date_map as materialized (
 select coalesce(jsonb_object_agg(task_id,jsonb_build_object(
  'due_at',case when due_at>'2020-01-01' and due_at<'2100-01-01' then due_at end,
  'needed_at',case when needed_at>'2020-01-01' and needed_at<'2100-01-01' then needed_at end)),'{}'::jsonb) dates
 from task_dates
), eligible as (
 select s.*,
 coalesce((select jsonb_agg(t.value||coalesce((select dates from date_map)->(t.value->>'id'),jsonb_build_object('due_at',null,'needed_at',null))) from jsonb_array_elements(s.production_tasks) t),'[]') dated_tasks,
 coalesce(o.created_at,m.placed_at,m.created_at) created_at,
 case when s.kind='icetak' then o.total else f.buyer_paid end amount,
 case when s.kind='icetak' then o.date_need end customer_needed,
 case when s.kind='shopee' then s.deadline end platform_deadline,
 coalesce(m.buyer_message,o.admin_remark) order_note,
 case when s.kind='icetak' then
  coalesce((select jsonb_agg(jsonb_build_object('title',i.title,'quantity',i.qty,'size',i.size,'wording',i.wording,'sku',i.catalog_slug)) from order_items i where i.order_id=s.id),'[]')
 else coalesce((select jsonb_agg(jsonb_build_object('title',i.title,'quantity',i.quantity,'size',i.variation_name,'sku',coalesce(i.variation_sku,i.item_sku))) from marketplace_order_items i where i.order_id=s.id and i.is_current),'[]') end items
 from ai_order_work_source s
 left join orders o on s.kind='icetak' and o.id=s.id
 left join marketplace_orders m on s.kind='shopee' and m.id=s.id
 left join lateral(select buyer_paid from marketplace_order_financials where order_id=m.id limit 1) f on true
 where not(s.kind='icetak' and exists(select 1 from marketplace_orders mirror where mirror.internal_order_id=s.id and coalesce(mirror.metadata->>'dashboard_excluded','false')<>'true'))
), bounded as (select * from eligible order by source_updated_at desc nulls last,id limit 10000)
select jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(bounded)) from bounded),'[]'),
 'order_total',(select count(*) from eligible),'orders_truncated',(select count(*)>10000 from eligible),
 'states',coalesce((select jsonb_object_agg(row_key,to_jsonb(s)) from customer_focus_state s),'{}'),
 'reviews',coalesce((select jsonb_object_agg(conversation_id::text,to_jsonb(r)) from ai_dashboard_reviews r),'{}'),
 'checked_at',now(),'clickup',jsonb_build_object('latest_event_at',(select max(received_at) from clickup_webhook_events),
 'latest_projection_at',(select max(projected_at) from ai_clickup_work_snapshots),
 'unlinked',(select count(*) from ai_clickup_work_snapshots where mapping_status in ('unlinked','conflict') and lower(coalesce(clickup_status,'')) not in ('prospect','lain2'))));
$function$;

revoke all on function public.icetak_customer_focus_snapshot() from public,anon,authenticated;
grant execute on function public.icetak_customer_focus_snapshot() to service_role;
