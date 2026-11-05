-- A single paid-sale cohort feeds daily, MTD, channel and cost arithmetic.
-- Read model only: canonical finance/order facts and cost overrides are retained.
create or replace function finance.business_report_row(p_id uuid,p_channel text,p_sales numeric,p_shipping numeric,p_fees numeric)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r jsonb;mat numeric;pack numeric;extra numeric;net numeric;fee numeric;ship numeric;adj numeric;profit numeric;
 rate numeric;basis text:='existing_cost_model';reason jsonb:='[]';inc text;
begin
 if p_channel='shopee' then
  r:=finance.order_profit_row(p_id);mat:=(r->>'material_total')::numeric;
  pack:=(r#>>'{extra_costs,packaging,amount}')::numeric;
  extra:=(r->>'extra_total')::numeric-pack;net:=(r->>'nett')::numeric;
  fee:=coalesce((r#>>'{finance_metrics,fee_total}')::numeric,case when net is not null then p_fees end);
  ship:=(r#>>'{finance_metrics,shipping_net}')::numeric;
  adj:=net-p_sales+fee-coalesce(ship,0);inc:=r->>'income_state';
  -- A recovered catalogue item can have no discounted price yet. Do not let
  -- a positive provider sale masquerade as zero category-percent material.
  if p_sales>0 and coalesce((r->>'goods_value')::numeric,0)=0 and mat=0 then
   select min((l->>'rate')::numeric) into rate from jsonb_array_elements(r->'material_lines')l
    having count(*)>0 and count(*)=count(l->>'rate')
     and min((l->>'rate')::numeric)=max((l->>'rate')::numeric)
     and bool_and(l->>'mode'='estimated' and l->>'basis'='category_percent');
   mat:=case when rate is not null then round(p_sales*rate/100,2) end;
   basis:=case when rate is not null then 'financial_sales_category_estimate' else 'missing_item_prices' end;
  end if;
  if coalesce((r->>'detail_changed')::boolean,false) then mat:=null;end if;
 else
  r:=finance.direct_margin_row(p_id);mat:=(r->>'material')::numeric;pack:=(r->>'packing')::numeric;
  extra:=(r->>'extras')::numeric;net:=(r->>'nett')::numeric;fee:=0;ship:=0;adj:=0;inc:=r->>'income_state';
 end if;
 if mat is null then reason:=reason||'"Modal belum lengkap"'::jsonb;end if;
 if net is null then reason:=reason||jsonb_build_array(case when p_channel='shopee' then 'Cash out Shopee belum tersedia' else 'Kos courier / penerimaan belum lengkap' end);end if;
 if fee is null or pack is null or extra is null or p_sales is null then reason:=reason||'"Komponen kiraan belum lengkap"'::jsonb;end if;
 if jsonb_array_length(reason)=0 then profit:=round(net-mat-pack-extra,2);end if;
 return jsonb_build_object('order_id',p_id,'channel',p_channel,'sales',p_sales,'shipping_collected',case when p_channel='shopee' then 0 else p_shipping end,
  'fees',fee,'shopee_shipping_net',ship,'shopee_adjustments',adj,'shipping_detail_known',p_channel<>'shopee' or ship is not null,
  'courier',case when p_channel='shopee' then 0 else (r->>'courier')::numeric end,
  'cash_out',case when p_channel='shopee' then net else 0 end,'nett',net,
  'released_payout',case when p_channel='shopee' and inc='released' then net else 0 end,
  'pending_cash_out',case when p_channel='shopee' and inc<>'released' then net else 0 end,
  'material',mat,'material_basis',basis,'packing',pack,'extras',extra,'contribution',profit,'income_state',inc,
  'state',case when profit is null then 'incomplete' when coalesce(r->>'profit_state',r->>'state')='actual' and basis='existing_cost_model' then 'actual' else 'estimated' end,
  'reference',coalesce(r->>'order_sn',r->>'reference'),'reasons',reason);
end $$;

create or replace function finance.business_report_totals(p_rows jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
with rows as (select * from jsonb_to_recordset(coalesce(p_rows,'[]')) as x(
 sales numeric,shipping_collected numeric,fees numeric,shopee_shipping_net numeric,shopee_adjustments numeric,courier numeric,cash_out numeric,nett numeric,
 released_payout numeric,pending_cash_out numeric,material numeric,packing numeric,extras numeric,contribution numeric,channel text,state text,material_basis text,shipping_detail_known boolean)),
t as(select count(*) orders,count(sales) sales_known,sum(sales) sales,sum(shipping_collected) shipping_collected,sum(fees) fees,sum(shopee_shipping_net) shopee_shipping_net,
 sum(shopee_adjustments) shopee_adjustments,sum(courier) courier_total,sum(cash_out) cash_out,sum(nett) nett,sum(released_payout) released_payout,sum(pending_cash_out) pending_cash_out,
 sum(material) material,count(material) cost_known,sum(packing) packing_total,sum(extras) other_extras,
 sum(packing)filter(where channel='shopee') packing_shopee,sum(packing)filter(where channel<>'shopee') packing_direct,
 count(*)filter(where packing is null) packing_missing,count(*)filter(where material is null) missing_costs,count(*)filter(where nett is null) missing_nett,
 count(*)filter(where channel='shopee' and pending_cash_out is distinct from 0) payout_pending,
 count(*)filter(where channel='shopee' and not shipping_detail_known) shipping_detail_missing,
 count(*)filter(where material_basis='financial_sales_category_estimate') material_price_estimates,
 count(contribution) contribution_orders,count(*)filter(where state='actual') actual_orders,count(*)filter(where state='estimated') estimated_orders,
 sum(contribution) contribution,sum(sales)filter(where contribution is null) pending_sales,
 sum(courier-shipping_collected)filter(where channel<>'shopee') direct_courier_net,
 jsonb_build_object('orders',count(contribution),'sales',coalesce(sum(sales)filter(where contribution is not null),0),
 'fees',coalesce(sum(fees)filter(where contribution is not null),0),
 'shopee_shipping_net',coalesce(sum(shopee_shipping_net)filter(where contribution is not null),0),
 'shopee_adjustments',coalesce(sum(shopee_adjustments)filter(where contribution is not null),0),
 'shipping_collected',coalesce(sum(shipping_collected)filter(where contribution is not null),0),
 'courier_total',coalesce(sum(courier)filter(where contribution is not null),0),
 'material',coalesce(sum(material)filter(where contribution is not null),0),'packing_total',coalesce(sum(packing)filter(where contribution is not null),0),
 'other_extras',coalesce(sum(extras)filter(where contribution is not null),0),'nett',coalesce(sum(nett)filter(where contribution is not null),0),
 'contribution',coalesce(sum(contribution),0)) breakdown
 from rows)
select (to_jsonb(t)||case when orders=0 then (select jsonb_object_agg(k,'0'::jsonb) from unnest(array['sales','shipping_collected','fees','shopee_shipping_net','shopee_adjustments','courier_total','cash_out','nett','released_payout','pending_cash_out','material','packing_total','other_extras','packing_shopee','packing_direct','pending_sales','direct_courier_net'])k) else '{}'::jsonb end)||jsonb_build_object('contribution',case when orders=0 then 0 else contribution end,'contribution_complete',contribution_orders=orders,
 'missing_contribution',orders-contribution_orders,'cost_completeness_pct',case when orders>0 then round(cost_known::numeric/orders*100,2) else 100 end,
 'packing_added',packing_direct) from t;
$$;

create or replace function public.finance_business_snapshot(p_date date default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d date:=coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date-1);
 first_day date;prev_start date;prev_end date;result jsonb;
begin
 if d>=(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Pilih tarikh sebelum hari ini';end if;
 first_day:=date_trunc('month',d)::date;prev_start:=(first_day-interval '1 month')::date;
 prev_end:=least(first_day-1,prev_start+extract(day from d)::int-1);
 with sales as materialized(select * from finance.business_sales(least(prev_start,d-13),d)),
 current_sales as materialized(select * from sales where day>=first_day),
 costs as materialized(select s.*,finance.business_report_row(order_id,channel,sales,shipping,fees)||jsonb_build_object('day',day) r from current_sales s),
 totals as(select finance.business_report_totals(jsonb_agg(r)) mtd,
 finance.business_report_totals(jsonb_agg(r)filter(where day=d)) daily from costs),
 periods as(select coalesce(sum(sales)filter(where day between prev_start and prev_end),0) previous_mtd,
 coalesce(sum(fees)filter(where day between prev_start and prev_end),0) previous_fees,
 coalesce(sum(sales)filter(where day>=d-6),0)/7 avg7,
 coalesce(sum(sales)filter(where day between d-13 and d-7),0)/7 prev_avg7 from sales)
 select jsonb_build_object('schema_version',3,'report_date',d,'generated_at',now(),'timezone','Asia/Kuala_Lumpur',
 'basis','Paid orders by MYT sale date; product sales exclude customer postage. Cash out uses released payout or provider estimate, not bank receipts.',
 'cost_basis','Daily and MTD share one paid-order cohort. Packing once per order; cash out already includes Shopee fees/shipping. Breakdown uses only calculable orders; missing costs never become zero.',
 'period',jsonb_build_object('from',first_day,'to',d,'previous_from',prev_start,'previous_to',prev_end),
 'daily',t.daily||jsonb_build_object('channels',(select coalesce(jsonb_agg(finance.business_report_totals(rows)||jsonb_build_object('channel',channel)),'[]') from(select channel,jsonb_agg(r) rows from costs where day=d group by channel)x)),
 'mtd',t.mtd||jsonb_build_object('previous_sales',p.previous_mtd,'change_pct',case when p.previous_mtd>0 then round(((t.mtd->>'sales')::numeric/p.previous_mtd-1)*100,2) end,
 'avg7',round(p.avg7,2),'previous_avg7',round(p.prev_avg7,2),'projection',round(coalesce((t.mtd->>'sales')::numeric,0)+p.avg7*((first_day+interval '1 month - 1 day')::date-d),2),
 'channels',(select coalesce(jsonb_agg(finance.business_report_totals(rows)||jsonb_build_object('channel',channel)),'[]') from(select channel,jsonb_agg(r) rows from costs group by channel)x)),
 'alerts',jsonb_build_object('missing_sales',(t.mtd->>'orders')::int-(t.mtd->>'sales_known')::int,'missing_costs',t.mtd->'missing_costs',
 'detail_incomplete',(select count(*) from current_sales where not detail_complete),'payout_pending',t.mtd->'payout_pending',
 'missing_contribution',t.mtd->'missing_contribution','missing_nett',t.mtd->'missing_nett','material_price_estimates',t.mtd->'material_price_estimates',
 'shipment_without_charge',(select count(*) from public.shipments sh join current_sales s on s.order_id=sh.order_id where sh.cancelled_at is null and sh.archived_at is null and sh.charged_amount is null),
 'unlinked_shipments',(select count(*) from public.shipments where order_id is null and created_at>=first_day::timestamp at time zone 'Asia/Kuala_Lumpur' and created_at<(d+1)::timestamp at time zone 'Asia/Kuala_Lumpur'),
 'shopee_last_seen',(select max(last_seen_at) from public.marketplace_orders where provider='shopee'),
 'shopee_stale',coalesce((select max(last_seen_at)<now()-interval '24 hours' from public.marketplace_orders where provider='shopee'),true),
 'sales_drop_alert',case when p.previous_mtd>0 then ((t.mtd->>'sales')::numeric/p.previous_mtd-1)*100 < -(select alert_threshold_pct from finance.daily_business_report_settings where id) else false end,
 'fee_rate_increase_alert',case when p.previous_mtd>0 and (t.mtd->>'sales')::numeric>0 then (t.mtd->>'fees')::numeric/(t.mtd->>'sales')::numeric>p.previous_fees/p.previous_mtd else false end,
 'trend7',case when p.avg7<p.prev_avg7 then 'turun' when p.avg7>p.prev_avg7 then 'naik' else 'sama' end),
 'orders',(select coalesce(jsonb_agg(r||jsonb_build_object('payout',r->'cash_out') order by day,order_id),'[]') from costs))
 into result from totals t cross join periods p;return result;
end $$;

revoke all on function finance.business_report_row(uuid,text,numeric,numeric,numeric),finance.business_report_totals(jsonb) from public,anon,authenticated;
grant execute on function finance.business_report_row(uuid,text,numeric,numeric,numeric),finance.business_report_totals(jsonb) to service_role;
