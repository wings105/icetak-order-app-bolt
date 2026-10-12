create or replace function public.marketplace_finance_runtime(p_action text,p_body jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s text:=p_body->>'shop_id';c marketplace_ops.release_cursor%rowtype;v_from timestamptz;begin
 if p_action='cursor' then
  select greatest(now()-interval '90 days',coalesce(min(placed_at),now()-interval '7 days')) into v_from from public.marketplace_orders where shop_id=s;
  insert into marketplace_ops.release_cursor(shop_id,from_at,to_at) values(s,v_from,least(v_from+interval '7 days',now())) on conflict(shop_id) do nothing;
  select * into c from marketplace_ops.release_cursor where shop_id=s;
  return to_jsonb(c);
 elsif p_action='cursor_save' then
  update marketplace_ops.release_cursor set from_at=(p_body->>'from_at')::timestamptz,to_at=(p_body->>'to_at')::timestamptz,page=(p_body->>'page')::integer,last_error=p_body->>'error',next_at=coalesce((p_body->>'next_at')::timestamptz,now()),updated_at=now() where shop_id=s;
  return jsonb_build_object('saved',true);
 elsif p_action='state' then
  update marketplace_ops.worker_state set last_finished_at=clock_timestamp(),last_error=left(p_body->>'error',300) where key='finance';return jsonb_build_object('saved',true);
 elsif p_action='complete_job' then
  update public.marketplace_enrichment_jobs set status='completed',completed_at=now(),locked_at=null,last_error=null,updated_at=now() where id=(p_body->>'job_id')::uuid and exists(select 1 from public.marketplace_order_financials f where f.order_id=marketplace_enrichment_jobs.order_id and f.settlement_status='released' and f.released_amount is not null);
  return jsonb_build_object('saved',true);
 elsif p_action='complete_detail' then
  update public.marketplace_enrichment_jobs set status='completed',completed_at=now(),locked_at=null,last_error=null,updated_at=now() where id=(p_body->>'job_id')::uuid and job_type='financial_detail' and exists(select 1 from public.marketplace_order_financials f where f.order_id=marketplace_enrichment_jobs.order_id and f.escrow_amount is not null);
  return jsonb_build_object('saved',true);
 elsif p_action='defer_job' then
  update public.marketplace_enrichment_jobs set status=case when p_body->>'blocked'='true' then 'failed' else 'pending' end,locked_at=null,last_error=left(p_body->>'error',300),available_at=now()+make_interval(hours=>case when p_body->>'blocked'='true' then 24 else 12 end),response_payload=coalesce(response_payload,'{}'::jsonb)||jsonb_build_object('source','direct_shopee','escrow_checked',p_body->>'escrow_checked'='true'),updated_at=now() where id=(p_body->>'job_id')::uuid and status<>'completed';
  return jsonb_build_object('saved',true);
 elsif p_action='return_detail' then
  update public.marketplace_returns set return_solution=coalesce(p_body->>'return_solution',return_solution),return_reason=coalesce(p_body->>'reason',return_reason),refund_amount=coalesce((p_body->>'refund_amount')::numeric,refund_amount),raw_snapshot=raw_snapshot||jsonb_build_object('detail',p_body->'detail') where return_sn=p_body->>'return_sn' and provider='shopee' and order_id in(select id from public.marketplace_orders where shop_id=s);
  return jsonb_build_object('saved',true);
 end if;raise exception 'invalid_action';
end $$;


create or replace function public.marketplace_operations(p_action text default 'snapshot',p_filter jsonb default '{}'::jsonb,p_actor text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
  get diagnostics v_n=row_count;return jsonb_build_object('updated',v_n);
 elsif p_action<>'snapshot' then raise exception 'invalid_action';end if;
 select coalesce(jsonb_agg(x order by total desc),'[]') into v_events from (select e.event_code,count(*) total,count(*) filter(where e.received_at>=now()-interval '24 hours') last_24h,count(*) filter(where e.processing_status='failed') failed,count(*) filter(where e.processing_status='captured') captured,sum(e.duplicate_count) duplicates,max(e.received_at) last_received_at from public.marketplace_webhook_events e where e.provider='shopee' and (v_shop is null or e.shop_id=v_shop) group by e.event_code) x;
 select coalesce(jsonb_agg(x),'[]') into v_rows from (select e.id,e.event_code,e.shop_id,e.order_sn,e.received_at,e.processing_status,e.last_error,coalesce(j.attempts,0) attempts,j.status recovery_status,j.available_at from public.marketplace_webhook_events e left join marketplace_ops.jobs j on j.event_id=e.id where e.provider='shopee' and (v_shop is null or e.shop_id=v_shop) and (nullif(p_filter->>'status','') is null or e.processing_status=p_filter->>'status') order by case when e.processing_status='failed' then 0 else 1 end,e.received_at desc limit 100) x;
 select coalesce(jsonb_agg(x),'[]') into v_alerts from (select id,kind,shop_id,item_id,order_sn,title,body,url,severity,status,deadline,details,occurred_at,resolved_at,resolved_by from marketplace_ops.alerts where (v_shop is null or shop_id=v_shop) and (coalesce(p_filter->>'alert_status','open')='all' or status=coalesce(p_filter->>'alert_status','open')) order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end,occurred_at desc limit 100) x;
 select coalesce(jsonb_agg(x),'[]') into v_returns from (select r.id,o.order_sn,o.shop_id,o.currency,r.return_sn,r.return_status,r.logistics_status,r.reverse_logistics_status,r.return_solution,r.refund_amount,r.return_reason,r.last_event_at from public.marketplace_returns r join public.marketplace_orders o on o.id=r.order_id where v_shop is null or o.shop_id=v_shop order by r.last_event_at desc nulls last limit 100) x;
 select coalesce(jsonb_agg(x),'[]') into v_finance from (select o.shop_id,f.currency,count(*) orders,count(*) filter(where f.escrow_amount is not null) escrow_known,count(*) filter(where f.released_amount is not null and f.settlement_status='released') released_known,sum(f.released_amount) filter(where f.settlement_status='released') released_total,count(*) filter(where f.released_amount is null) release_unknown from public.marketplace_order_financials f join public.marketplace_orders o on o.id=f.order_id where v_shop is null or o.shop_id=v_shop group by o.shop_id,f.currency) x;
 select coalesce(jsonb_agg(x),'[]') into v_jobs from (select j.status,count(*) total,max(j.updated_at) updated_at from marketplace_ops.jobs j join public.marketplace_webhook_events e on e.id=j.event_id where v_shop is null or e.shop_id=v_shop group by j.status) x;
 select coalesce(jsonb_agg(x),'[]') into v_shops from (select shop_id,count(*) events from public.marketplace_webhook_events where provider='shopee' and shop_id is not null group by shop_id) x;
 return jsonb_build_object('checked_at',now(),'events',v_events,'rows',v_rows,'alerts',v_alerts,'returns',v_returns,'finance',v_finance,'recovery',v_jobs,'shops',v_shops,
 'finance_jobs',(select coalesce(jsonb_agg(x),'[]') from (select j.job_type,j.status,count(*) total,max(j.last_error) last_error from public.marketplace_enrichment_jobs j join public.marketplace_orders o on o.id=j.order_id where v_shop is null or o.shop_id=v_shop group by j.job_type,j.status) x),
 'finance_worker',(select coalesce(jsonb_agg(x),'[]') from (select * from marketplace_ops.worker_state) x));
end $$;
-- Explicit owner-approved backfill of the audited raw types and failed events.
insert into marketplace_ops.jobs(event_id) select id from public.marketplace_webhook_events where provider='shopee' and processing_status='failed' on conflict(event_id) do nothing;
update public.marketplace_orders o set region=s.region,currency=s.currency,updated_at=now() from marketplace_ops.shops s where o.shop_id=s.shop_id and (o.region,o.currency) is distinct from (s.region,s.currency);
update public.marketplace_order_financials f set currency=o.currency,updated_at=now() from public.marketplace_orders o where f.order_id=o.id and o.shop_id in(select shop_id from marketplace_ops.shops) and f.currency is distinct from o.currency;
with latest as(select distinct on(order_sn) order_sn,id,coalesce(occurred_at,received_at) event_at,to_timestamp((parsed_payload#>>'{data,new,ship_by_date}')::double precision) due_at from public.marketplace_webhook_events where provider='shopee' and event_code=47 and coalesce(parsed_payload#>>'{data,new,ship_by_date}','') ~ '^[0-9]+$' and (parsed_payload#>>'{data,new,ship_by_date}')::numeric>0 order by order_sn,coalesce(occurred_at,received_at) desc)
update public.marketplace_orders o set ship_by_at=e.due_at,metadata=o.metadata||jsonb_build_object('ship_by_event_time',e.event_at,'ship_by_source','code47'),updated_at=now() from latest e where o.provider='shopee' and o.order_sn=e.order_sn and e.event_at>=coalesce(public.marketplace_parse_local_time(o.raw_detail->>'latest_update',o.region),'-infinity'::timestamptz) and o.ship_by_at is distinct from e.due_at;
do $$declare e record;begin for e in select id from public.marketplace_webhook_events where provider='shopee' and event_code in(5,9,16,22,28) and processing_status in('captured','ignored') order by received_at loop perform marketplace_ops.process_aux_event(e.id);end loop;end $$;
insert into public.marketplace_enrichment_jobs(order_id,job_type,status,request_payload)
select f.order_id,'financial_detail','pending',jsonb_build_object('source','owner_webhook_upgrade') from public.marketplace_order_financials f where (f.escrow_amount is null or f.commission_fee is null or f.service_fee is null or f.transaction_fee is null) on conflict(order_id,job_type) do nothing;
update finance.shopee_finance_dispatch_config set enabled=false,updated_at=now() where singleton;
select cron.alter_job(jobid,active:=false) from cron.job where jobname='icetak-shopee-finance-dispatch-every-minute';
select cron.schedule('icetak-shopee-webhook-recovery','* * * * *','select marketplace_ops.kick_worker();');
