CREATE OR REPLACE FUNCTION public.marketplace_operations(p_action text DEFAULT 'snapshot'::text, p_filter jsonb DEFAULT '{}'::jsonb, p_actor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_shop text:=nullif(p_filter->>'shop_id','');v_id uuid;v_rows jsonb;v_events jsonb;v_alerts jsonb;v_returns jsonb;v_finance jsonb;v_jobs jsonb;v_shops jsonb;v_n integer;
begin
 if p_action='retry' then
  if nullif(p_actor,'') is null then raise exception 'actor_required';end if;
  v_id:=(p_filter->>'event_id')::uuid;
  if not exists(select 1 from public.marketplace_webhook_events where id=v_id and processing_status='failed') then raise exception 'failed_event_required';end if;
  insert into marketplace_ops.jobs(event_id) values(v_id) on conflict(event_id) do update set status='pending',attempts=0,available_at=now(),lease_id=null,last_error=null,updated_at=now() where marketplace_ops.jobs.status<>'in_flight';
  return jsonb_build_object('queued',true);
 elsif p_action='resolve_alert' then
  if nullif(p_actor,'') is null then raise exception 'actor_required';end if;
  update marketplace_ops.alerts set status=case when coalesce(p_filter->>'status','resolved')='open' then 'open' else 'resolved' end,resolved_at=case when p_filter->>'status'='open' then null else now() end,resolved_by=p_actor where id=(p_filter->>'alert_id')::uuid;
  get diagnostics v_n=row_count;
   if v_n=0 then update public.shopee_clickup_audit_issues set status=case when p_filter->>'status'='open' then 'open' else 'resolved' end,resolved_at=case when p_filter->>'status'='open' then null else now() end,resolved_by=p_actor where id=(p_filter->>'alert_id')::uuid;get diagnostics v_n=row_count;end if;
   return jsonb_build_object('updated',v_n);
 elsif p_action<>'snapshot' then raise exception 'invalid_action';end if;
 select coalesce(jsonb_agg(x order by total desc),'[]') into v_events from (select e.event_code,count(*) total,count(*) filter(where e.received_at>=now()-interval '24 hours') last_24h,count(*) filter(where e.processing_status='failed') failed,count(*) filter(where e.processing_status='captured') captured,sum(e.duplicate_count) duplicates,max(e.received_at) last_received_at from public.marketplace_webhook_events e where e.provider='shopee' and (v_shop is null or e.shop_id=v_shop) group by e.event_code) x;
 select coalesce(jsonb_agg(x),'[]') into v_rows from (select e.id,e.event_code,e.shop_id,e.order_sn,e.received_at,e.processing_status,e.last_error,coalesce(j.attempts,0) attempts,j.status recovery_status,j.available_at from public.marketplace_webhook_events e left join marketplace_ops.jobs j on j.event_id=e.id where e.provider='shopee' and (v_shop is null or e.shop_id=v_shop) and (nullif(p_filter->>'status','') is null or e.processing_status=p_filter->>'status') order by case when e.processing_status='failed' then 0 else 1 end,e.received_at desc limit 100) x;
 select coalesce(jsonb_agg(x),'[]') into v_alerts from (select id,kind,shop_id,item_id,order_sn,title,body,url,severity,status,deadline,details,occurred_at,resolved_at,resolved_by from (select id,kind,shop_id,item_id,order_sn,title,body,url,severity,status,deadline,details,occurred_at,resolved_at,resolved_by from marketplace_ops.alerts union all select id,kind,shop_id,null::text as item_id,order_sn,title,body,url,severity,status,null::timestamptz as deadline,details,occurred_at,resolved_at,resolved_by from public.shopee_clickup_audit_issues) audit_alert_feed where (v_shop is null or shop_id=v_shop) and (coalesce(p_filter->>'alert_status','open')='all' or status=coalesce(p_filter->>'alert_status','open')) order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end,occurred_at desc limit 100) x;
 select coalesce(jsonb_agg(x),'[]') into v_returns from (select r.id,o.order_sn,o.shop_id,o.currency,r.return_sn,r.return_status,r.logistics_status,r.reverse_logistics_status,r.return_solution,r.refund_amount,r.return_reason,r.last_event_at from public.marketplace_returns r join public.marketplace_orders o on o.id=r.order_id where v_shop is null or o.shop_id=v_shop order by r.last_event_at desc nulls last limit 100) x;
 select coalesce(jsonb_agg(x),'[]') into v_finance from (select o.shop_id,f.currency,count(*) orders,count(*) filter(where f.escrow_amount is not null) escrow_known,count(*) filter(where f.released_amount is not null and f.settlement_status='released') released_known,sum(f.released_amount) filter(where f.settlement_status='released') released_total,count(*) filter(where f.released_amount is null) release_unknown from public.marketplace_order_financials f join public.marketplace_orders o on o.id=f.order_id where v_shop is null or o.shop_id=v_shop group by o.shop_id,f.currency) x;
 select coalesce(jsonb_agg(x),'[]') into v_jobs from (select j.status,count(*) total,max(j.updated_at) updated_at from marketplace_ops.jobs j join public.marketplace_webhook_events e on e.id=j.event_id where v_shop is null or e.shop_id=v_shop group by j.status) x;
 select coalesce(jsonb_agg(x),'[]') into v_shops from (select shop_id,count(*) events from public.marketplace_webhook_events where provider='shopee' and shop_id is not null group by shop_id) x;
 return jsonb_build_object('checked_at',now(),'events',v_events,'rows',v_rows,'alerts',v_alerts,'returns',v_returns,'finance',v_finance,'recovery',v_jobs,'shops',v_shops,
 'finance_jobs',(select coalesce(jsonb_agg(x),'[]') from (select j.job_type,j.status,count(*) total,max(j.last_error) last_error from public.marketplace_enrichment_jobs j join public.marketplace_orders o on o.id=j.order_id where v_shop is null or o.shop_id=v_shop group by j.job_type,j.status) x),
 'finance_worker',(select coalesce(jsonb_agg(x),'[]') from (select * from marketplace_ops.worker_state) x));
end $function$;

