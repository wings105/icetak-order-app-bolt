-- Private, read-only managerial analytics. Finance owner gateway is the only client.
create or replace function finance.sales_sku_lines(p_currency text, p_shop text default null)
returns table(order_id uuid, order_sn text, day date, sku_key text, sku text, title text, variation text, quantity numeric, returned numeric, sales numeric, source text)
language sql stable set search_path='' as $fn$
with orders as (
 select o.*,s.fields->'report_items'->'value' items,
 coalesce(case when (s.fields->'report_items'->'value'->0->>'Order Creation Date') ~ '^\d{4}-\d{2}-\d{2}' then left(s.fields->'report_items'->'value'->0->>'Order Creation Date',10)::date end,(o.placed_at at time zone 'Asia/Kuala_Lumpur')::date) local_day
 from public.marketplace_orders o
 left join lateral (select fields from finance.order_finance_snapshots where order_id=o.id and source='excel' order by id desc limit 1)s on true
 where o.provider='shopee' and o.currency=p_currency and (p_shop is null or o.shop_id=p_shop)
 and coalesce(o.metadata->>'dashboard_excluded','false')<>'true'
 and o.current_status not in ('CANCELLED','UNPAID','IN_CANCEL','UNKNOWN')
 and lower(coalesce(s.fields->'report_items'->'value'->0->>'Order Status','')) not in ('cancelled','unpaid')
), lines as (
 select o.id,o.order_sn,o.local_day,
 nullif(trim(j->>'Parent SKU Reference No.'),'') parent_sku,nullif(trim(j->>'SKU Reference No.'),'') variant_sku,
 coalesce(j->>'Product Name','Produk tanpa nama') title,coalesce(j->>'Variation Name','') variation,
 greatest(coalesce(finance.provider_number(j->'Quantity'),0),0) qty,
 greatest(coalesce(finance.provider_number(j->'Returned quantity'),0),0) ret,
 finance.provider_number(j->'Product Subtotal') sales,'excel'::text source
 from orders o cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items)='array' then o.items else '[]'::jsonb end)j
 union all
 select o.id,o.order_sn,o.local_day,nullif(trim(i.item_sku),''),nullif(trim(i.variation_sku),''),coalesce(i.title,'Produk tanpa nama'),coalesce(i.variation_name,''),greatest(i.quantity,0),
 greatest(coalesce(finance.provider_number(i.raw_item->'returned_quantity'),finance.provider_number(i.raw_item->'returned_qty'),0),0),
 coalesce(i.line_subtotal,i.unit_discounted_price*i.quantity,i.unit_original_price*i.quantity),'webhook'
 from orders o join public.marketplace_order_items i on i.order_id=o.id and i.is_current
 where o.items is null or jsonb_typeof(o.items)<>'array' or jsonb_array_length(o.items)=0
), keyed as (
 select *,case when parent_sku is not null and variant_sku is not null and parent_sku<>variant_sku then parent_sku||'::'||variant_sku else coalesce(variant_sku,parent_sku) end code from lines
)
select id,order_sn,local_day,coalesce(code,'NO-SKU:'||md5(title||'|'||variation)),coalesce(code,'Tanpa SKU'),title,variation,qty,least(ret,qty),sales,source from keyed;
$fn$;
revoke all on function finance.sales_sku_lines(text,text) from public,anon,authenticated;
grant execute on function finance.sales_sku_lines(text,text) to service_role;

create or replace function public.finance_sales_sku_report(p_filter jsonb default '{}')
returns jsonb language plpgsql stable set search_path='' as $fn$
declare f date:=nullif(p_filter->>'from','')::date; t date:=coalesce(nullif(p_filter->>'to','')::date,(now() at time zone 'Asia/Kuala_Lumpur')::date);
 c text:=coalesce(nullif(p_filter->>'currency',''),'MYR'); shop text:=nullif(p_filter->>'shop_id',''); q text:=left(coalesce(p_filter->>'query',''),200); selected text:=nullif(p_filter->>'sku_key',''); result jsonb;
begin
 if c!~'^[A-Z]{3}$' or (f is not null and f>t) or t>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Julat tarikh / currency tidak sah';end if;
 with all_lines as materialized(select * from finance.sales_sku_lines(c,shop)),
 lines as materialized(select * from all_lines where day<=t and (f is null or day>=f)),
 order_profit as materialized(select order_id,finance.order_profit_row(order_id) data from (select distinct order_id from lines)x),
 order_goods as (select order_id,sum(sales) goods,count(*) filter(where sales is null) missing from lines group by 1),
 enriched as materialized(
 select l.*,l.quantity-l.returned net_units,
 case when l.quantity>0 then l.sales*l.returned/l.quantity else 0 end return_value_estimate,
 case when g.goods>0 and g.missing=0 and p.data->>'profit' is not null then (p.data->>'profit')::numeric*l.sales/g.goods end allocated_profit,
 p.data->>'income_state' income_state
 from lines l join order_goods g using(order_id) join order_profit p using(order_id)
 ),
 groups as (
 select sku_key,min(sku) sku,min(title) title,count(distinct variation) variations,
 sum(quantity) units,sum(returned) returned,sum(net_units) net_units,count(distinct order_id) orders,
 case when count(*) filter(where sales is null)=0 then round(sum(sales),2) end sales,
 round(sum(return_value_estimate),2) return_value_estimate,
 case when count(*) filter(where allocated_profit is null)=0 then round(sum(allocated_profit),2) end profit,
 round(sum(allocated_profit),2) known_profit,count(distinct order_id) filter(where allocated_profit is null) missing_profit_orders,
 count(distinct order_id) filter(where income_state<>'released') estimate_orders
 from enriched group by 1
 ), searched as (select * from groups where q='' or sku ilike '%'||q||'%' or title ilike '%'||q||'%'),
 chosen as materialized(select * from enriched where selected is null or sku_key=selected),
 bounds as (select coalesce(f,min(day),t) first_day,case when t-coalesce(f,min(day),t)>93 then 'month' else 'day' end bucket from all_lines),
 trend as (select date_trunc(b.bucket,day::timestamp)::date as "day",sum(net_units) units,case when count(*) filter(where sales is null)=0 then round(sum(sales),2) end sales,
 case when count(*) filter(where allocated_profit is null)=0 then round(sum(allocated_profit),2) end profit,count(distinct order_id) orders from chosen cross join bounds b group by 1),
 calendar as (select generate_series(date_trunc(bucket,first_day::timestamp),date_trunc(bucket,t::timestamp),case when bucket='month' then interval '1 month' else interval '1 day' end)::date as "day" from bounds)
 select jsonb_build_object('from',f,'to',t,'currency',c,
 'rows',coalesce((select jsonb_agg(to_jsonb(g) order by g.net_units desc,g.sku_key) from (select * from searched order by net_units desc,sku_key limit 5000)g),'[]'),
 'truncated',(select count(*)>5000 from searched),'sku_count',(select count(*) from searched),
 'summary',(select jsonb_build_object('units',coalesce(sum(quantity),0),'returned',coalesce(sum(returned),0),'net_units',coalesce(sum(net_units),0),'orders',count(distinct order_id),'sales',case when count(*) filter(where sales is null)=0 then coalesce(round(sum(sales),2),0) end,'sku_count',count(distinct sku_key),'missing_sku_lines',count(*) filter(where sku='Tanpa SKU')) from enriched),
 'coverage',(select jsonb_build_object('first_day',min(day),'last_day',max(day),'available_orders',count(distinct order_id),'excel_orders',count(distinct order_id) filter(where source='excel'),'webhook_orders',count(distinct order_id) filter(where source='webhook'),'bucket',(select bucket from bounds)) from all_lines),
 'trend',coalesce((select jsonb_agg(jsonb_build_object('day',cal.day,'units',coalesce(tr.units,0),'orders',coalesce(tr.orders,0),'sales',case when tr.day is null then 0 else tr.sales end,'profit',case when tr.day is null then 0 else tr.profit end) order by cal.day) from calendar cal left join trend tr using(day)),'[]'),
 'orders',coalesce((select jsonb_agg(to_jsonb(d) order by d.day desc,d.order_sn) from (select order_id,order_sn,day,sum(net_units) units,round(sum(sales),2) sales,case when count(*) filter(where allocated_profit is null)=0 then round(sum(allocated_profit),2) end profit,min(income_state) income_state from chosen where selected is not null group by 1,2,3 order by day desc,order_sn limit 500)d),'[]'),
 'order_count',(select count(distinct order_id) from chosen where selected is not null)
 ) into result;
 return result;
end;
$fn$;
revoke all on function public.finance_sales_sku_report(jsonb) from public,anon,authenticated;
grant execute on function public.finance_sales_sku_report(jsonb) to service_role;
