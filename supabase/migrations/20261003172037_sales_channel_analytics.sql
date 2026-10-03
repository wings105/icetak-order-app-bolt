-- Read-only owner finance model. No business rows or journals are mutated.
create or replace function finance.sales_channel_orders(p_from date default null,p_to date default null)
returns table(order_id uuid,channel text,day date,reference text,status text,included boolean,sales numeric,shipping numeric,discount numeric,refund numeric,received numeric,pending numeric,nett numeric,profit numeric,profit_state text,fees numeric,return_shipping numeric,shipping_loss numeric,customer_key text,repeat_customer boolean,fulfillment_days numeric,payment_evidence text,basis_review boolean)
language sql stable set search_path='' as $fn$
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
 lower(coalesce(o.status,'')||' '||coalesce(o.admin_status,'')||' '||coalesce(o.fulfillment_stage,'')) not like '%cancel%' eligible,
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
 case when eligible then case when lower(coalesce(payment_status,''))='paid' or lower(coalesce(payment,''))='paid' then 0 else greatest(total-coalesce(pay,0)-coalesce(checkout_pay,0),0) end end,
 null::numeric,null::numeric,'incomplete',null::numeric,null::numeric,null::numeric,ck,coalesce(rep,false),
 case when coalesce(shipped,pickup_collected_at) is not null then greatest(extract(epoch from (coalesce(shipped,pickup_collected_at)-created_at))/86400,0) end,
 case when pay is not null or checkout_pay is not null then 'transaction' when lower(coalesce(payment_status,''))='paid' or lower(coalesce(payment,''))='paid' then 'paid_status_only' else 'unpaid' end,
 delivery_fee is null
from own_selected;
$fn$;
revoke all on function finance.sales_channel_orders(date,date) from public,anon,authenticated;
grant execute on function finance.sales_channel_orders(date,date) to service_role;

create or replace function public.finance_sales_channel_report(p_filter jsonb default '{}')
returns jsonb language plpgsql stable set search_path='' as $fn$
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
 round(sum(pending) filter(where included),2) known_pending,count(d.order_id) filter(where included and pending is null) missing_pending,
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
 count(d.order_id) filter(where included and pending>0 and day<t-7) pending_over_7_days
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
 and (kind='all' or kind='pending' and included and (pending>0 or pending is null) or kind='loss' and included and profit<0 or kind='cancelled' and status ilike '%cancel%' or kind='incomplete' and included and (sales is null or profit is null or basis_review) or kind='repeat' and included and repeat_customer)
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
 'pending_aging',(select coalesce(jsonb_agg(to_jsonb(a) order by channel,age),'[]') from (select channel,case when t-day<=7 then '0–7 hari' when t-day<=30 then '8–30 hari' else '31+ hari' end age,count(*) orders,round(sum(pending),2) known_amount,count(*) filter(where pending is null) missing from current where included and (pending>0 or pending is null) group by 1,2)a)
 ) into result;
 return result;
end;
$fn$;
revoke all on function public.finance_sales_channel_report(jsonb) from public,anon,authenticated;
grant execute on function public.finance_sales_channel_report(jsonb) to service_role;
