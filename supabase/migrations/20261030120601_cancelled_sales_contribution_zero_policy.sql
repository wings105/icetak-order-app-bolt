CREATE OR REPLACE FUNCTION finance.sales_channel_orders(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(order_id uuid, channel text, day date, reference text, status text, included boolean, sales numeric, shipping numeric, discount numeric, refund numeric, received numeric, pending numeric, nett numeric, profit numeric, profit_state text, fees numeric, return_shipping numeric, shipping_loss numeric, customer_key text, repeat_customer boolean, fulfillment_days numeric, payment_evidence text, basis_review boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with cancelled_policy_raw(order_id,channel,day,reference,status,included,sales,shipping,discount,refund,received,pending,nett,profit,profit_state,fees,return_shipping,shipping_loss,customer_key,repeat_customer,fulfillment_days,payment_evidence,basis_review) as materialized (with mp as materialized (
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
from own_selected) select order_id,
channel,
day,
reference,
status,
case when upper(trim(status))='CANCELLED' then false else included end as included,
case when upper(trim(status))='CANCELLED' then 0::numeric else sales end as sales,
case when upper(trim(status))='CANCELLED' then 0::numeric else shipping end as shipping,
case when upper(trim(status))='CANCELLED' then 0::numeric else discount end as discount,
case when upper(trim(status))='CANCELLED' then 0::numeric else refund end as refund,
case when upper(trim(status))='CANCELLED' then 0::numeric else received end as received,
case when upper(trim(status))='CANCELLED' then 0::numeric else pending end as pending,
case when upper(trim(status))='CANCELLED' then 0::numeric else nett end as nett,
case when upper(trim(status))='CANCELLED' then 0::numeric else profit end as profit,
case when upper(trim(status))='CANCELLED' then 'excluded' else profit_state end as profit_state,
case when upper(trim(status))='CANCELLED' then 0::numeric else fees end as fees,
case when upper(trim(status))='CANCELLED' then 0::numeric else return_shipping end as return_shipping,
case when upper(trim(status))='CANCELLED' then 0::numeric else shipping_loss end as shipping_loss,
customer_key,
repeat_customer,
fulfillment_days,
case when upper(trim(status))='CANCELLED' then 'cancelled' else payment_evidence end as payment_evidence,
case when upper(trim(status))='CANCELLED' then false else basis_review end as basis_review from cancelled_policy_raw;
$function$;
CREATE OR REPLACE FUNCTION finance.contribution_rows(p_from date, p_to date)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
select finance.cancelled_zero_row(q.r) from (with scoped as materialized(select * from finance.sales_channel_orders(p_from,p_to)),
 model as materialized(select s.*,case when s.channel='deco' then finance.direct_margin_row(s.order_id) else finance.order_profit_row(s.order_id) end r from scoped s),
 mp as(select *,case when r->>'lifecycle_review'='true' and (coalesce(r->>'reviewed','false')<>'true' or not included and coalesce(r->>'income_state','')<>'released' and (r->>'nett')::numeric>0) then null else (r->>'profit')::numeric end safe_profit from model where channel='shopee')
 select jsonb_build_object('order_id',order_id,'reference',reference,'channel',channel,'day',day,'status',status,'sales',sales,'customer_paid',(r->>'buyer_paid')::numeric,
 'shipping_charged',shipping,'fee',fees,'courier',null,'courier_state','in_nett','nett',(r->>'nett')::numeric,'material',(r->>'material_total')::numeric,'extras',(r->>'extra_total')::numeric,'packing',(r#>>'{extra_costs,packaging,amount}')::numeric,
 'contribution',case when included or r->>'lifecycle_review'='true' and r->>'reviewed'='true' then safe_profit end,
 'margin',case when sales>0 and (included or r->>'lifecycle_review'='true' and r->>'reviewed'='true') then round(safe_profit/sales*100,2) end,
 'state',case when not included and coalesce(r->>'lifecycle_review','false')<>'true' then 'excluded' when safe_profit is null then 'incomplete' else r->>'profit_state' end,
 'income_state',r->>'income_state','included',included or (r->>'lifecycle_review'='true'),
 'reasons',case when r->>'lifecycle_review'='true' and (coalesce(r->>'reviewed','false')<>'true' or not included and coalesce(r->>'income_state','')<>'released' and (r->>'nett')::numeric>0) then '["Batal / refund perlu semak kos dahulu"]'::jsonb when safe_profit is null then '["Nett / modal belum lengkap atau item berubah"]'::jsonb else '[]'::jsonb end)
 from mp union all select r||jsonb_build_object('day',day) from model where channel='deco') q(r);
$function$;
