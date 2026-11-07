CREATE OR REPLACE FUNCTION public.icetak_render_auto_source(p_task_id text, p_hash text)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'render_auto'
AS $function$
 select exists(select 1 from render_auto.jobs q join public.clickup_order_brief_jobs j using(task_id)
 where q.task_id=p_task_id and q.source_hash=p_hash and q.state='processing' and q.lease_until>now()
 and j.state='completed' and j.brief->>'confirmed'='true'
 and coalesce(jsonb_array_length(j.brief->'pending_change_ids'),0)=0 and coalesce((j.brief->>'change_detected')::int,0)=0
 and j.brief->>'wording'=q.brief->>'wording'
 and (
  exists(select 1 from public.marketplace_orders m where m.order_sn=q.order_reference and m.payment_status='paid' and m.current_status in ('READY_TO_SHIP','PROCESSED','RETRY_SHIP'))
  or exists (select 1 from public.production_components c join public.orders o on o.id=c.order_id where c.clickup_task_id=q.task_id and (select count(distinct c2.order_id) from public.production_components c2 where c2.clickup_task_id=q.task_id)=1 and o.delivery_method='pickup' and o.payment_status='cash_counter' and o.production_approved is true and lower(coalesce(o.status,'')) not in ('cancelled','canceled','complete','completed','shipped','delivered') and lower(coalesce(o.shipment_status_group,'')) not in ('shipped','in_transit','delivered','cancelled'))
  or exists(select 1 from public.orders o where (o.order_no=q.order_reference or o.order_id=q.order_reference) and o.payment_status='paid'
    and lower(coalesce(o.status,'')) not in ('cancelled','canceled','complete','completed','shipped','delivered')
    and lower(coalesce(o.shipment_status_group,'')) not in ('shipped','in_transit','delivered','cancelled'))
  ));
$function$;

CREATE OR REPLACE FUNCTION public.icetak_ai_qc_source(p_task_id text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select jsonb_build_object('job',j,'brief',b,'template',t,'valid',
 b.state='completed' and b.brief->>'confirmed'='true' and j.source_hash=md5(jsonb_build_object('sku',b.brief->>'sku','wording',b.brief->>'wording','instruction',b.brief->>'instruction','pending',b.brief->'pending_change_ids','changes',b.brief->'change_detected','media',b.brief->'media_count','review',b.brief->'review_requested')::text)
 and (exists(select 1 from public.marketplace_orders m where m.order_sn=j.order_reference and m.payment_status='paid' and m.current_status in ('READY_TO_SHIP','PROCESSED','RETRY_SHIP')) or exists (select 1 from public.production_components c join public.orders o on o.id=c.order_id where c.clickup_task_id=j.task_id and (select count(distinct c2.order_id) from public.production_components c2 where c2.clickup_task_id=j.task_id)=1 and o.delivery_method='pickup' and o.payment_status='cash_counter' and o.production_approved is true and lower(coalesce(o.status,'')) not in ('cancelled','canceled','complete','completed','shipped','delivered') and lower(coalesce(o.shipment_status_group,'')) not in ('shipped','in_transit','delivered','cancelled')) or exists(select 1 from public.orders o where (o.order_no=j.order_reference or o.order_id=j.order_reference) and o.payment_status='paid' and lower(coalesce(o.status,'')) not in ('cancelled','canceled','complete','completed','shipped','delivered') and lower(coalesce(o.shipment_status_group,'')) not in ('shipped','in_transit','delivered','cancelled'))))
 from render_auto.jobs j join public.clickup_order_brief_jobs b using(task_id) join public.render_templates t on t.sku=j.brief->>'sku' where j.task_id=p_task_id;
$function$;