-- Shared, read-only full-payment evidence for managerial sales inclusion.
create or replace function finance.order_is_paid(p_order_id uuid) returns boolean
language sql stable security invoker set search_path='' as $p$
with payments as(select sum(pt.amount) amount,bool_or(pt.amount<0) refunded from public.payment_transactions pt
 where pt.order_id=p_order_id and pt.provider not in('legacy_test','test_webhook')
 and not exists(select 1 from public.payment_transaction_voids v where v.original_payment_id=pt.id)),
 checkout as(select sum(co.amount) amount from public.pickup_checkout_orders co join public.pickup_checkouts pc on pc.id=co.checkout_id
 where co.order_id=p_order_id and co.status='allocated' and pc.status='paid'
 and not exists(select 1 from public.pickup_checkout_voids v where v.checkout_id=pc.id)
 and not exists(select 1 from public.payment_transactions pt where pt.order_id=co.order_id and pt.transaction_id=pc.transaction_id)),
 evidence as(select case when p.amount is not null or c.amount is not null then coalesce(p.amount,0)+coalesce(c.amount,0) end amount,coalesce(p.refunded,false) refunded from payments p cross join checkout c)
select coalesce((select
 lower(coalesce(o.status,'')||' '||coalesce(o.admin_status,'')||' '||coalesce(o.fulfillment_stage,'')) !~ '(cancel|refund|void|return)' and not e.refunded
 and case when e.amount is not null then e.amount>=o.total-0.01 else lower(coalesce(o.payment_status,'')) in('paid','matched','payment_received') or lower(coalesce(o.payment,''))='paid' end
 from public.orders o cross join evidence e where o.id=p_order_id),false);
$p$;
revoke all on function finance.order_is_paid(uuid) from public,anon,authenticated;
grant execute on function finance.order_is_paid(uuid) to service_role;
CREATE OR REPLACE FUNCTION public.icetak_command_center_snapshot(p_from date, p_to date, p_source text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r jsonb; start_at timestamptz:=p_from::timestamp at time zone 'Asia/Kuala_Lumpur'; end_at timestamptz:=(p_to+1)::timestamp at time zone 'Asia/Kuala_Lumpur'; today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 or p_source not in ('all','icetak','shopee') then raise exception 'Invalid range/source (max 93 days)'; end if;
 with
 o as materialized (
  select x.*, coalesce(nullif(x.order_no,''),x.order_id) reference,
  lower(coalesce(x.status,'')||' '||coalesce(x.admin_status,'')||' '||coalesce(x.fulfillment_stage,'')) ~ '(cancel|refund|void|return)' cancelled,
  (x.pickup_collected_at is not null or x.delivered_at is not null or lower(coalesce(x.fulfillment_stage,'')) in ('collected','delivered','completed') or lower(coalesce(x.status,'')) in ('completed','delivered','customer collected')) done,
  finance.order_is_paid(x.id) paid,
  (lower(coalesce(x.shipment_status_group,'')) in ('picked_up','shipped','in_transit','out_for_delivery') or lower(coalesce(x.status,'')) in ('shipped','in transit','out for delivery')) transit
  from public.orders x where p_source in ('all','icetak')
 ), m as materialized (select * from public.marketplace_orders where p_source in ('all','shopee') and coalesce(metadata->>'dashboard_excluded','false') <> 'true'),
 activity as (
  select id,'icetak' source,created_at occurred_at,total amount,'MYR' currency,cancelled,paid from o
  where p_source<>'all' or not exists(select 1 from public.marketplace_orders mx where mx.internal_order_id=o.id)
  union all select m.id,'shopee',coalesce(m.placed_at,m.created_at),f.buyer_paid,m.currency,m.current_status in('CANCELLED','IN_CANCEL'),coalesce(m.current_status not in('UNPAID','UNKNOWN','CANCELLED','IN_CANCEL'),false)
  from m left join public.marketplace_order_financials f on f.order_id=m.id
 ), period as materialized (select * from activity where occurred_at>=start_at and occurred_at<end_at),
 active_pc as materialized (select pc.* from public.production_components pc join o on o.id=pc.order_id where not o.done and not o.cancelled and not o.transit),
 ship as materialized (
  select s.id,s.order_id,'icetak' source,coalesce(nullif(s.courier,''),'Unknown') courier,
   s.status_group status,s.shipped_at,s.delivered_at,s.created_at,s.updated_at,
   s.cancelled_at is not null cancelled from public.shipments s join o on o.id=s.order_id where s.archived_at is null
  union all
  select s.id,s.order_id,'shopee',coalesce(nullif(s.courier_name,''),nullif(m.courier_name,''),'Unknown'),
   case when m.current_status in ('COMPLETED','CANCELLED','IN_CANCEL','SHIPPED','TO_CONFIRM_RECEIVE') then m.current_status else coalesce(s.shipment_status,'UNKNOWN') end,
   null::timestamptz,null::timestamptz,s.created_at,s.updated_at,m.current_status='CANCELLED'
  from public.marketplace_shipments s join m on m.id=s.order_id
 ), sales as materialized (select * from public.sales_opportunities where p_source='all' or (p_source='shopee' and source='shopee') or (p_source='icetak' and source<>'shopee')),
 focus as (
  select o.id::text key,'orders' module,o.reference reference,coalesce(o.delivery_name,'Customer') name,
   case when o.date_need<today then 'Tarikh perlu telah lewat' else 'Perlu siap hari ini' end reason,
   o.date_need::text deadline,'urgent' severity,o.created_by owner,
   coalesce(nullif(trim(o.delivery_phone),''),(select coalesce(nullif(trim(c.phone),''),cm.primary_phone_normalized) from public.customers c left join public.customer_master cm on cm.id=c.customer_master_id where c.id=o.customer_id)) phone,
   lower(coalesce(nullif(trim(o.delivery_method),''),nullif(trim(o.delivery),''),o.courier)) delivery_method from o where not done and not cancelled and not transit and o.date_need<=today
  union all select id::text,'marketplace-orders',order_sn,buyer_username,'Ship-by deadline',ship_by_at::text,'urgent',null,
   (select cm.primary_phone_normalized from public.marketplace_customers mc join public.customer_master cm on cm.id=mc.customer_master_id where mc.id=m.buyer_customer_id),case when nullif(trim(m.courier_name),'') is not null then 'courier' else null end from m
   where current_status in ('READY_TO_SHIP','PROCESSED') and ship_by_at>'2000-01-01'::timestamptz and ship_by_at<((today+1)::timestamp at time zone 'Asia/Kuala_Lumpur')
  union all select d.id::text,'draft-orders',coalesce(d.order_no,'Draft'),d.customer_name,'Draft menunggu admin',d.created_at::text,'warning',d.admin_approved_by,d.customer_phone,lower(coalesce(d.working_draft,d.confirmed_draft,d.ai_draft)->>'delivery')
   from public.qrpay_order_drafts d where status='pending_admin' and p_source<>'shopee'
 ), days as (select generate_series(p_from::timestamp,p_to::timestamp,'1 day')::date d),
 products as (
  select coalesce(i.product_type,i.title,'Item') label,sum(coalesce(i.qty,1)) value from public.order_items i join o on o.id=i.order_id
   where o.created_at>=start_at and o.created_at<end_at and not o.cancelled group by 1
  union all select coalesce(i.title,'Shopee item'),sum(i.quantity) from public.marketplace_order_items i join m on m.id=i.order_id
   where coalesce(m.placed_at,m.created_at)>=start_at and coalesce(m.placed_at,m.created_at)<end_at and i.is_current and m.current_status <> 'CANCELLED' group by 1
 )
 select jsonb_build_object(
 'fetched_at',now(),'range',jsonb_build_object('from',p_from,'to',p_to,'timezone','Asia/Kuala_Lumpur','source',p_source),
 'period',jsonb_build_object('orders',(select count(*) from period),'cancelled',(select count(*) from period where cancelled),
  'icetak_orders',(select count(*) from period where source='icetak'),'shopee_orders',(select count(*) from period where source='shopee'),
  'gmv',(select coalesce(sum(amount),0) from period where not cancelled and paid and currency='MYR'),
  'unpaid_excluded',(select count(*) from period where not cancelled and not paid),
  'gmv_missing',(select count(*) from period where amount is null and not cancelled and paid),'foreign_currency_orders',(select count(*) from period where currency<>'MYR'),
  'payments_received',(select coalesce(sum(pt.amount),0) from public.payment_transactions pt join o on o.id=pt.order_id where pt.paid_at>=start_at and pt.paid_at<end_at),
  'previous_orders',(select count(*) from activity where occurred_at>=start_at-(p_to-p_from+1)*interval '1 day' and occurred_at<start_at),
  'new_leads',(select count(*) from sales where opened_at>=start_at and opened_at<end_at),
  'quotes',(select count(*) from public.quotation_events q join sales on sales.id=q.opportunity_id where sent_at>=start_at and sent_at<end_at),
  'won',(select count(*) from sales where stage='won' and closed_at>=start_at and closed_at<end_at),
  'lost',(select count(*) from sales where stage='lost' and closed_at>=start_at and closed_at<end_at),
  'completed',(select count(*) from o where coalesce(delivered_at,pickup_collected_at,production_completed_at)>=start_at and coalesce(delivered_at,pickup_collected_at,production_completed_at)<end_at and done)),
 'trend',coalesce((select jsonb_agg(jsonb_build_object('date',d,'icetak',(select count(*) from period where source='icetak' and (occurred_at at time zone 'Asia/Kuala_Lumpur')::date=d),
  'shopee',(select count(*) from period where source='shopee' and (occurred_at at time zone 'Asia/Kuala_Lumpur')::date=d),
  'gmv',(select coalesce(sum(amount),0) from period where not cancelled and paid and currency='MYR' and (occurred_at at time zone 'Asia/Kuala_Lumpur')::date=d)) order by d) from days),'[]'::jsonb),
 'backlog',jsonb_build_object('active',(select count(*) from o where not done and not cancelled and not transit),
  'unpaid',(select count(*) from o where not done and not cancelled and not paid),
  'unpaid_value',(select coalesce(sum(total),0) from o where not done and not cancelled and not paid),
  'due_today',(select count(*) from o where not done and not cancelled and not transit and date_need=today),
  'overdue',(select count(*) from o where not done and not cancelled and not transit and date_need<today),
  'design_review',(select count(distinct order_id) from active_pc where review_required and lower(coalesce(review_status,'')) in ('waiting_customer_review','waiting_review','pending_review')),
  'production_components',(select count(*) from active_pc),
  'ready_pickup',(select count(*) from o where not cancelled and pickup_collected_at is null and (pickup_ready_at is not null or fulfillment_stage='ready_for_pickup')),
  'to_ship',(select count(*) from m where current_status in ('READY_TO_SHIP','PROCESSED')),
  'ship_by_today',(select count(*) from m where current_status in ('READY_TO_SHIP','PROCESSED') and (ship_by_at at time zone 'Asia/Kuala_Lumpur')::date=today),
  'ship_overdue',(select count(*) from m where current_status in ('READY_TO_SHIP','PROCESSED') and ship_by_at>'2000-01-01'::timestamptz and ship_by_at<(today::timestamp at time zone 'Asia/Kuala_Lumpur')),
  'ship_deadline_unknown',(select count(*) from m where current_status in ('READY_TO_SHIP','PROCESSED') and (ship_by_at is null or ship_by_at<='2000-01-01'::timestamptz)),
  'shipping',(select count(*) from m where current_status in ('SHIPPED','TO_CONFIRM_RECEIVE'))+(select count(*) from o where transit and not done and not cancelled),
  'drafts',(select count(*) from public.qrpay_order_drafts where status in ('pending_admin','ready_customer','awaiting_payment') and p_source<>'shopee'),
  'payment_attention',(select count(*) from public.payment_order_attention_alerts where resolved_at is null and status<>'resolved' and p_source<>'shopee'),
  'shipment_attention',(select count(*) from public.shipment_attention_alerts where resolved_at is null and status<>'resolved' and p_source<>'shopee')),
 'pipeline',jsonb_build_array(
  jsonb_build_object('label','Belum bayar','value',(select count(*) from o where not done and not cancelled and not paid),'module','orders','filter','to_pay'),
  jsonb_build_object('label','Semakan design','value',(select count(distinct order_id) from active_pc where review_required and review_status='waiting_customer_review'),'module','orders','filter','design'),
  jsonb_build_object('label','Komponen aktif','value',(select count(*) from active_pc),'module','orders','filter','active'),
  jsonb_build_object('label','Ready pickup','value',(select count(*) from o where not cancelled and pickup_collected_at is null and pickup_ready_at is not null),'module','pickup-counter'),
  jsonb_build_object('label','Shopee To Ship','value',(select count(*) from m where current_status in ('READY_TO_SHIP','PROCESSED')),'module','marketplace-orders','filter','TO_SHIP'),
  jsonb_build_object('label','Shipping / receipt','value',(select count(*) from m where current_status in ('SHIPPED','TO_CONFIRM_RECEIVE'))+(select count(*) from o where transit and not done and not cancelled),'module','shipping')),
 'production',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select coalesce(nullif(customer_stage,''),nullif(clickup_status,''),nullif(workflow,''),'Unknown') label,count(*) value from active_pc group by 1 order by 2 desc) x),'[]'::jsonb),
 'products',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select label,sum(value) value from products group by 1 order by 2 desc limit 10)x),'[]'::jsonb),
 'couriers',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select courier label,count(distinct (source,order_id)) value from ship where not cancelled and created_at>=start_at and created_at<end_at group by 1 order by 2 desc)x),'[]'::jsonb),
 'shipping_status',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select coalesce(status,'Unknown') label,count(*) value from ship where not cancelled group by 1 order by 2 desc)x),'[]'::jsonb),
 'shipping_aging',jsonb_build_array(
  jsonb_build_object('label','1 hari','value',(select count(*) from ship where source='icetak' and shipped_at is not null and delivered_at is null and not cancelled and now()-shipped_at<interval '2 days')),
  jsonb_build_object('label','2–3 hari','value',(select count(*) from ship where source='icetak' and delivered_at is null and not cancelled and now()-shipped_at>=interval '2 days' and now()-shipped_at<interval '4 days')),
  jsonb_build_object('label','4–5 hari','value',(select count(*) from ship where source='icetak' and delivered_at is null and not cancelled and now()-shipped_at>=interval '4 days' and now()-shipped_at<interval '6 days')),
  jsonb_build_object('label','6+ hari','value',(select count(*) from ship where source='icetak' and delivered_at is null and not cancelled and now()-shipped_at>=interval '6 days'))),
 'payment_methods',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select coalesce(nullif(payment_method,''),'Unknown') label,count(*) value from o where created_at>=start_at and created_at<end_at and not cancelled group by 1)x),'[]'::jsonb),
 'settlement',jsonb_build_object('coverage',(select count(*) from m join public.marketplace_order_financials f on f.order_id=m.id where f.settlement_status is not null or f.released_at is not null),
  'released',(select sum(f.released_amount) from m join public.marketplace_order_financials f on f.order_id=m.id where f.released_at>=start_at and f.released_at<end_at),
  'fees',(select sum(coalesce(f.commission_fee,0)+coalesce(f.service_fee,0)+coalesce(f.transaction_fee,0)+coalesce(f.other_fees,0)) from m join public.marketplace_order_financials f on f.order_id=m.id where coalesce(m.placed_at,m.created_at)>=start_at and coalesce(m.placed_at,m.created_at)<end_at and f.last_enriched_at is not null)),
 'returns',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select coalesce(return_status,'Unknown') label,count(*) value from public.marketplace_returns mr join m on m.id=mr.order_id group by 1)x),'[]'::jsonb),
 'focus',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from focus order by case when left(deadline,10)=today::text then 0 else 1 end,deadline desc nulls last limit 30)x),'[]'::jsonb),
 'sales_funnel',coalesce((select jsonb_agg(jsonb_build_object('label',stage,'value',n)) from (select stage,count(*) n from sales group by 1)x),'[]'::jsonb),
 'opportunities',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from sales order by case when stage in ('won','lost') then 1 else 0 end,updated_at desc limit 60)x),'[]'::jsonb),
 'staff_activity',coalesce((select jsonb_agg(to_jsonb(x)) from (select actor,count(*) actions from public.ai_dashboard_events where created_at>=start_at and created_at<end_at group by actor order by 2 desc)x),'[]'::jsonb),
 'ai_training',coalesce((select jsonb_agg(jsonb_build_object('label',verdict,'value',n)) from (select verdict,count(*) n from public.ai_dashboard_training where created_at>=start_at and created_at<end_at group by 1)x),'[]'::jsonb),
 'health',jsonb_build_object('notification_failed',(select count(*) from public.notification_queue where status in ('failed','error')),
  'clickup_failed',(select count(*) from public.clickup_task_sync_queue where status in ('failed','error','retry')),
  'clickup_pending',(select count(*) from public.clickup_task_sync_queue where status in ('pending','queued','processing')),
  'outbox_failed',(select count(*) from public.integration_outbox where status in ('failed','error','retry')),
  'last_shopee_webhook',(select max(received_at) from public.marketplace_webhook_events),
  'last_clickup_webhook',(select max(received_at) from public.clickup_webhook_events),
  'last_order_update',(select max(updated_at) from public.orders),
  'last_marketplace_update',(select max(updated_at) from public.marketplace_orders)),
 'limitations',jsonb_build_array('Lead dan quotation dikira daripada rekod sales rasmi, bukan needs_reply.','Pipeline ialah backlog semasa, bukan hanya order dalam tempoh dipilih.','GMV MYR tidak termasuk cancellation; cash diterima dan Shopee payout ialah metrik berasingan.','Shopee Completed bukan pengesahan courier delivered. IN_CANCEL ialah permintaan pembatalan yang belum final dan tidak dikira CANCELLED. Aging hanya shipment iCetak yang mempunyai shipped_at.','Expenses, kos stok dan net profit belum tersedia; settlement kosong bukan RM0.')) into r;
 return r;
end $function$
;
CREATE OR REPLACE FUNCTION finance.sales_channel_orders(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(order_id uuid, channel text, day date, reference text, status text, included boolean, sales numeric, shipping numeric, discount numeric, refund numeric, received numeric, pending numeric, nett numeric, profit numeric, profit_state text, fees numeric, return_shipping numeric, shipping_loss numeric, customer_key text, repeat_customer boolean, fulfillment_days numeric, payment_evidence text, basis_review boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with mp as materialized (
 select m.*, coalesce(case when (ex.fields->'report_items'->'value'->0->>'Order Creation Date') ~ '^\d{4}-\d{2}-\d{2}' then left(ex.fields->'report_items'->'value'->0->>'Order Creation Date',10)::date end,(coalesce(m.placed_at,m.created_at) at time zone 'Asia/Kuala_Lumpur')::date) local_day,
 coalesce(m.placed_at,m.created_at) occurred_at,
 m.current_status not in ('CANCELLED','IN_CANCEL','UNPAID','UNKNOWN') and lower(coalesce(ex.fields->'report_items'->'value'->0->>'Order Status','')) not in ('cancelled','unpaid') eligible,
 case when m.buyer_customer_id is not null then 'crm:'||m.buyer_customer_id else 'shopee:'||m.shop_id||':'||nullif(lower(m.buyer_username),'') end ck
 from public.marketplace_orders m
 left join lateral(select fields from finance.order_finance_snapshots where order_id=m.id and source='excel' order by id desc limit 1)ex on true
 where m.provider='shopee' and m.currency='MYR' and coalesce(m.metadata->>'dashboard_excluded','false')<>'true'
), own as materialized (
 select o.*,(o.created_at at time zone 'Asia/Kuala_Lumpur')::date local_day,
 finance.order_is_paid(o.id) eligible,
 coalesce('crm:'||o.customer_id,'phone:'||nullif(regexp_replace(o.delivery_phone,'\D','','g'),'')) ck
 from public.orders o
 where coalesce(o.source,'') not in ('shopee','marketplace','chatgpt-test')
 and not exists(select 1 from public.marketplace_orders m where m.internal_order_id=o.id or m.order_sn in (o.external_order_id,o.order_id,o.order_no))
), identities as (
 select id, 'shopee'::text ch,local_day,occurred_at,ck from mp where eligible
 union all select id,'deco',local_day,created_at,ck from own where eligible
), history as (
 select id,ch,ck is not null and row_number() over(partition by ch,ck order by local_day,occurred_at,id)>1 rep from identities
), goods as materialized (
 select order_id,case when count(*) filter(where sales is null)=0 then sum(sales) end amount from finance.sales_sku_lines('MYR',null) group by order_id
), m_selected as materialized (
 select m.*,finance.order_profit_row(m.id) p,s.fields,coalesce(s.metrics,finance.order_finance_metrics(coalesce(s.fields,'{}'))) metrics,
 g.amount goods, h.rep
 from mp m left join goods g on g.order_id=m.id left join history h on h.id=m.id and h.ch='shopee'
 left join lateral(select fields,metrics from finance.order_finance_snapshots where order_id=m.id order by (source='webhook') desc,id desc limit 1)s on true
 where (p_from is null or m.local_day>=p_from) and (p_to is null or m.local_day<=p_to)
), own_selected as materialized (
 select o.*,h.rep,
 (select sum(pt.amount) from public.payment_transactions pt where pt.order_id=o.id and pt.provider not in ('legacy_test','test_webhook') and not exists(select 1 from public.payment_transaction_voids v where v.original_payment_id=pt.id)) pay,
 (select sum(co.amount) from public.pickup_checkout_orders co join public.pickup_checkouts c on c.id=co.checkout_id
 where co.order_id=o.id and co.status='allocated' and c.status='paid' and not exists(select 1 from public.pickup_checkout_voids v where v.checkout_id=c.id)
 and not exists(select 1 from public.payment_transactions pt where pt.order_id=o.id and pt.transaction_id=c.transaction_id)) checkout_pay,
 (select min(s.shipped_at) from public.shipments s where s.order_id=o.id and s.cancelled_at is null and s.archived_at is null) shipped
 from own o left join history h on h.id=o.id and h.ch='deco'
 where (p_from is null or o.local_day>=p_from) and (p_to is null or o.local_day<=p_to)
)
select id,'shopee',local_day,order_sn,current_status,eligible,
 -- Item selling price already contains item discounts. Only separate seller vouchers/coins are deducted.
 case when eligible then goods-coalesce(finance.fa(fields,'voucher_from_seller'),0)-coalesce(finance.fa(fields,'seller_coin_cash_back'),0) end,
 finance.fa(fields,'buyer_paid_shipping_fee'),
 finance.fa(fields,'voucher_from_seller')+finance.fa(fields,'seller_coin_cash_back'),
 (metrics->>'refund_total')::numeric,
 case when p->>'income_state'='released' then (p->>'nett')::numeric end,
 case when eligible and p->>'income_state' in ('escrow','report_estimate') then (p->>'nett')::numeric when eligible and p->>'income_state'='released' then 0 end,
 (p->>'nett')::numeric,(p->>'profit')::numeric,p->>'profit_state',
 (metrics->>'fee_total')::numeric,(metrics->>'return_shipping')::numeric,case when metrics->>'shipping_net' is not null then greatest(-(metrics->>'shipping_net')::numeric,0) end,
 ck,coalesce(rep,false),
 case when raw_detail->>'ship_time' ~ '^\d{9,10}$' and (raw_detail->>'ship_time')::bigint>0 then greatest(extract(epoch from (to_timestamp((raw_detail->>'ship_time')::bigint)-occurred_at))/86400,0) end,
 coalesce(p->>'income_state','missing'),
 fields is null or finance.fa(fields,'voucher_from_seller') is null or finance.fa(fields,'seller_coin_cash_back') is null or exists(select 1 from jsonb_array_elements(coalesce(metrics->'issues','[]'))j where j#>>'{}' like 'Diskaun%')
from m_selected
union all
select id,'deco',local_day,coalesce(nullif(order_no,''),order_id,id::text),status,eligible,
 case when eligible then total-delivery_fee end,delivery_fee,
 finance.provider_number(pricing_adjustments->'discount_amount'),null::numeric,
 case when pay is not null or checkout_pay is not null then coalesce(pay,0)+coalesce(checkout_pay,0) end,
 case when lower(coalesce(status,'')||' '||coalesce(admin_status,'')||' '||coalesce(fulfillment_stage,'')) !~ '(cancel|refund|void|return)' then case when finance.order_is_paid(id) then 0 else greatest(total-coalesce(pay,0)-coalesce(checkout_pay,0),0) end end,
 null::numeric,null::numeric,'incomplete',null::numeric,null::numeric,null::numeric,ck,coalesce(rep,false),
 case when coalesce(shipped,pickup_collected_at) is not null then greatest(extract(epoch from (coalesce(shipped,pickup_collected_at)-created_at))/86400,0) end,
 case when pay is not null or checkout_pay is not null then 'transaction' when lower(coalesce(payment_status,''))='paid' or lower(coalesce(payment,''))='paid' then 'paid_status_only' else 'unpaid' end,
 delivery_fee is null
from own_selected;
$function$
;
CREATE OR REPLACE FUNCTION public.finance_sales_channel_report(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare f date:=nullif(p_filter->>'from','')::date;t date:=coalesce(nullif(p_filter->>'to','')::date,(now() at time zone 'Asia/Kuala_Lumpur')::date);
 ch text:=coalesce(nullif(p_filter->>'channel',''),'all');q text:=left(coalesce(p_filter->>'query',''),200);kind text:=coalesce(nullif(p_filter->>'kind',''),'all');off int:=greatest(coalesce((p_filter->>'offset')::int,0),0);sz int:=least(greatest(coalesce((p_filter->>'limit')::int,50),1),5000);result jsonb;
begin
 if f>t or t>(now() at time zone 'Asia/Kuala_Lumpur')::date or ch not in ('all','shopee','deco') or kind not in ('all','pending','loss','cancelled','incomplete','repeat') then raise exception 'Julat / filter Sales Channel tidak sah';end if;
 with data as materialized(select * from finance.sales_channel_orders(case when f is null then null else f-(t-f+1) end,t)),
 current as materialized(select * from data where f is null or day>=f),
 channels as (select unnest(array['shopee','deco']) channel),
 totals as (select coalesce(sum(sales) filter(where included),0) sales,count(*) filter(where included and sales is null) missing from current),
 stats as (
 select c.channel,count(d.order_id) orders,count(d.order_id) filter(where included) sales_orders,
 coalesce(round(sum(sales) filter(where included),2),0) known_sales,
 case when count(d.order_id) filter(where included and sales is null)=0 then coalesce(round(sum(sales) filter(where included),2),0) end sales,
 count(d.order_id) filter(where included and sales is null) missing_sales,
 count(d.order_id) filter(where included and basis_review) basis_review_orders,
 round(sum(shipping) filter(where included),2) shipping,round(sum(discount) filter(where included),2) discount,
 round(sum(refund),2) known_refund,count(d.order_id) filter(where included and refund is null) missing_refund,
 round(sum(received),2) received,count(d.order_id) filter(where included and received is null and payment_evidence<>'unpaid') missing_received,
 round(sum(pending),2) known_pending,count(d.order_id) filter(where included and pending is null) missing_pending,
 round(sum(nett) filter(where included),2) known_nett,
 round(sum(profit) filter(where included),2) known_profit,count(d.order_id) filter(where included and profit is null) missing_profit,
 round(sum(profit) filter(where included and profit_state='actual'),2) actual_profit,round(sum(profit) filter(where included and profit_state='estimated'),2) estimated_profit,
 case when count(d.order_id) filter(where included and profit is null)=0 then coalesce(round(sum(profit) filter(where included),2),0) end profit,
 round(sum(fees),2) known_fees,count(d.order_id) filter(where included and fees is null) missing_fees,
 round(sum(return_shipping),2) known_return_shipping,round(sum(shipping_loss),2) known_shipping_loss,
 count(d.order_id) filter(where status ilike '%cancel%') cancelled,
 count(d.order_id) filter(where refund>0) refund_orders,count(d.order_id) filter(where included and profit<0) loss_orders,
 count(distinct customer_key) filter(where included) customers,count(d.order_id) filter(where included and customer_key is null) unknown_customers,
 count(distinct customer_key) filter(where included and repeat_customer) repeat_customers,
 count(d.order_id) filter(where included and repeat_customer) repeat_orders,
 round(avg(fulfillment_days) filter(where included),2) avg_fulfillment_days,count(d.order_id) filter(where included and fulfillment_days is not null) timed_orders,
 min(day) first_day,max(day) last_day,
 count(d.order_id) filter(where pending>0 and day<t-7) pending_over_7_days
 from channels c left join current d on d.channel=c.channel group by c.channel
 ), previous as (
 select channel,coalesce(round(sum(sales) filter(where included),2),0) sales,count(*) filter(where included and sales is null) missing from data where f is not null and day<f group by channel
 ), enriched as (
 select s.*,case when tt.sales>0 and tt.missing=0 then round(s.sales/tt.sales*100,2) end sales_share,
 case when tt.sales>0 then round(s.known_sales/tt.sales*100,2) end known_sales_share,
 case when sales_orders>s.missing_sales then round(s.known_sales/(sales_orders-s.missing_sales),2) end known_average_order,
 case when sales_orders>0 then round(s.sales/sales_orders,2) end average_order,
 case when s.sales>0 then round(s.profit/s.sales*100,2) end margin,
 case when s.orders>0 then round(s.cancelled::numeric/s.orders*100,2) end cancel_rate,
 case when s.customers>0 then round(s.repeat_customers::numeric/s.customers*100,2) end repeat_rate,
 case when pv.sales>0 and pv.missing=0 then round((s.sales-pv.sales)/pv.sales*100,2) end growth,
 pv.sales previous_sales
 from stats s cross join totals tt left join previous pv using(channel)
 ), bounds as (select coalesce(f,min(day),t) first_day,case when t-coalesce(f,min(day),t)>93 then 'month' else 'day' end bucket from current),
 calendar as (select generate_series(date_trunc(bucket,first_day::timestamp),date_trunc(bucket,t::timestamp),case when bucket='month' then interval '1 month' else interval '1 day' end)::date as "day" from bounds),
 buckets as (
 select date_trunc(b.bucket,d.day::timestamp)::date as "day",d.channel,count(*) filter(where included) orders,
 case when count(*) filter(where included and sales is null)=0 then coalesce(round(sum(sales) filter(where included),2),0) end sales,
 case when count(*) filter(where included and profit is null)=0 then coalesce(round(sum(profit) filter(where included),2),0) end profit
 from current d cross join bounds b group by 1,2
 ), detail as materialized (
 select * from current where (ch='all' or channel=ch) and (q='' or reference ilike '%'||q||'%')
 and (kind='all' or kind='pending' and (pending>0 or included and pending is null) or kind='loss' and included and profit<0 or kind='cancelled' and status ilike '%cancel%' or kind='incomplete' and included and (sales is null or profit is null or basis_review) or kind='repeat' and included and repeat_customer)
 ), item_lines as (
 select l.order_id,'shopee'::text channel,l.sku,l.title,l.quantity-l.returned units,l.sales,
 case when c.sales is not null and sum(l.sales) over(partition by l.order_id)>0 then c.sales*l.sales/sum(l.sales) over(partition by l.order_id) end allocated_sales,
 case when c.profit is not null and sum(l.sales) over(partition by l.order_id)>0 then c.profit*l.sales/sum(l.sales) over(partition by l.order_id) end allocated_profit
 from finance.sales_sku_lines('MYR',null) l join current c on c.order_id=l.order_id and c.channel='shopee' and c.included
 union all
 select i.order_id,'deco',coalesce(nullif(i.product_snapshot->>'sku',''),nullif(i.catalog_slug,''),nullif(i.product_type,''),'Tanpa kod'),coalesce(i.title,i.product_type,'Produk'),i.qty,i.price*i.qty,
 case when sum(i.price*i.qty) over(partition by i.order_id)>0 then c.sales*i.price*i.qty/sum(i.price*i.qty) over(partition by i.order_id) end,null::numeric
 from public.order_items i join current c on c.order_id=i.order_id and c.channel='deco' and c.included
 ), item_groups as (
 select channel,sku,min(title) title,sum(units) units,count(distinct order_id) orders,
 case when count(*) filter(where allocated_sales is null)=0 then round(sum(allocated_sales),2) end sales,
 case when count(*) filter(where allocated_profit is null)=0 then round(sum(allocated_profit),2) end profit
 from item_lines group by 1,2
 )
 select jsonb_build_object('from',f,'to',t,'currency','MYR','bucket',(select bucket from bounds),
 'channels',(select jsonb_agg(to_jsonb(e) order by channel) from enriched e),
 'summary',jsonb_build_object('sales',case when (select missing from totals)=0 then (select round(sales,2) from totals) end,'known_sales',(select round(sales,2) from totals),'orders',(select count(*) from current where included),'missing_sales',(select missing from totals),'basis_review_orders',(select count(*) from current where included and basis_review),'foreign_orders',(select count(*) from public.marketplace_orders where currency<>'MYR' and coalesce(metadata->>'dashboard_excluded','false')<>'true' and (f is null or (placed_at at time zone 'Asia/Kuala_Lumpur')::date>=f) and (placed_at at time zone 'Asia/Kuala_Lumpur')::date<=t)),
 'coverage',(select jsonb_agg(to_jsonb(cv) order by channel) from (
 select 'shopee'::text channel,min(coalesce(case when (ex.fields->'report_items'->'value'->0->>'Order Creation Date') ~ '^\d{4}-\d{2}-\d{2}' then left(ex.fields->'report_items'->'value'->0->>'Order Creation Date',10)::date end,(coalesce(m.placed_at,m.created_at) at time zone 'Asia/Kuala_Lumpur')::date)) first_day,max((coalesce(m.placed_at,m.created_at) at time zone 'Asia/Kuala_Lumpur')::date) last_day,count(*) orders from public.marketplace_orders m left join lateral(select fields from finance.order_finance_snapshots where order_id=m.id and source='excel' order by id desc limit 1)ex on true where provider='shopee' and currency='MYR' and coalesce(metadata->>'dashboard_excluded','false')<>'true'
 union all select 'deco',min((created_at at time zone 'Asia/Kuala_Lumpur')::date),max((created_at at time zone 'Asia/Kuala_Lumpur')::date),count(*) from public.orders o where coalesce(source,'') not in ('shopee','marketplace','chatgpt-test') and not exists(select 1 from public.marketplace_orders m where m.internal_order_id=o.id or m.order_sn in (o.external_order_id,o.order_id,o.order_no))
 )cv),
 'trend',(select coalesce(jsonb_agg(jsonb_build_object('day',cal.day,'channel',c.channel,'orders',coalesce(b.orders,0),'sales',case when b.day is null then 0 else b.sales end,'profit',case when b.day is null then 0 else b.profit end) order by cal.day,c.channel),'[]') from calendar cal cross join channels c left join buckets b on b.day=cal.day and b.channel=c.channel),
 'rows',(select coalesce(jsonb_agg(to_jsonb(d) order by day desc,reference),'[]') from (select * from detail order by day desc,reference offset off limit sz)d),
 'total',(select count(*) from detail),'offset',off,'limit',sz,
 'products',(select coalesce(jsonb_agg(to_jsonb(p) order by p.channel,p.sales desc nulls last),'[]') from (select *,row_number() over(partition by channel order by sales desc nulls last,sku) rank from item_groups)p where rank<=10),
 'pending_aging',(select coalesce(jsonb_agg(to_jsonb(a) order by channel,age),'[]') from (select channel,case when t-day<=7 then '0–7 hari' when t-day<=30 then '8–30 hari' else '31+ hari' end age,count(*) orders,round(sum(pending),2) known_amount,count(*) filter(where pending is null) missing from current where (pending>0 or included and pending is null) group by 1,2)a)
 ) into result;
 return result;
end;
$function$

;
notify pgrst, 'reload schema';
