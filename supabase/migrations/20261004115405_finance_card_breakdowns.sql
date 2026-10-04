-- Read-only card arithmetic; sums use the same full cohort as each headline, never the paginated table.
create or replace function finance.margin_breakdown(p_rows jsonb,p_kind text default 'target') returns jsonb
language sql immutable security invoker set search_path='' as $b$
with base as(select
 case when p_kind='profit' then (r->>'goods_value')::numeric else (r->>'sales')::numeric end sales,
 case when p_kind='profit' then (r->'finance_metrics'->>'fee_total')::numeric else (r->>'fee')::numeric end fee,
 case when p_kind='target' and r->>'channel'='deco' then (r->>'courier')::numeric else 0 end courier,
 (r->>'nett')::numeric nett,
 case when p_kind='profit' then (r->>'material_total')::numeric else (r->>'material')::numeric end material,
 case when p_kind='profit' then (r->>'extra_total')::numeric else (r->>'extras')::numeric end extras,
 case when p_kind='profit' then (r->>'profit')::numeric else (r->>'contribution')::numeric end contribution,
 case when p_kind='target' and r->>'channel'='deco' then (r->>'customer_paid')::numeric-(r->>'sales')::numeric
 when p_kind='profit' then (r->>'nett')::numeric-(r->>'goods_value')::numeric+(r->'finance_metrics'->>'fee_total')::numeric
 else (r->>'nett')::numeric-(r->>'sales')::numeric+(r->>'fee')::numeric end adjustment
 from jsonb_array_elements(coalesce(p_rows,'[]')) r)
select jsonb_build_object('orders',count(*),'missing',count(*) filter(where sales is null or fee is null or courier is null or nett is null or material is null or extras is null or adjustment is null),
 'sales',case when count(sales)=count(*) then coalesce(sum(sales),0) end,
 'fee',case when count(fee)=count(*) then coalesce(sum(fee),0) end,
 'courier',case when count(courier)=count(*) then coalesce(sum(courier),0) end,
 'adjustment',case when count(adjustment)=count(*) then coalesce(sum(adjustment),0) end,
 'nett',case when count(nett)=count(*) then coalesce(sum(nett),0) end,
 'material',case when count(material)=count(*) then coalesce(sum(material),0) end,
 'extras',case when count(extras)=count(*) then coalesce(sum(extras),0) end,
 'contribution',case when count(contribution)=count(*) then coalesce(sum(contribution),0) end) from base;
$b$;
revoke all on function finance.margin_breakdown(jsonb,text) from public,anon,authenticated;
grant execute on function finance.margin_breakdown(jsonb,text) to service_role;
CREATE OR REPLACE FUNCTION public.finance_contribution_report(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;
 first_day date:=date_trunc('month',coalesce(nullif(p_filter->>'month','')::date,today))::date;last_day date;
 cfg finance.contribution_target_settings%rowtype;goal numeric;work_count int;remaining_days int;is_work boolean;
 ch text:=coalesce(p_filter->>'channel','all');st text:=coalesce(p_filter->>'state','all');q text:=left(coalesce(p_filter->>'query',''),200);off int:=greatest(coalesce((p_filter->>'offset')::int,0),0);
 result jsonb;
begin
 last_day:=(first_day+interval '1 month - 1 day')::date;
 if first_day>today or ch not in('all','shopee','deco') or st not in('all','actual','estimated','incomplete','excluded','loss') then raise exception 'Bulan / filter target tidak sah';end if;
 if coalesce(p_filter->>'from','')<>'' and ((p_filter->>'from')::date<first_day or (p_filter->>'from')::date>last_day) or coalesce(p_filter->>'to','')<>'' and ((p_filter->>'to')::date<first_day or (p_filter->>'to')::date>last_day) or coalesce(p_filter->>'from','')<>'' and coalesce(p_filter->>'to','')<>'' and (p_filter->>'from')::date>(p_filter->>'to')::date then raise exception 'Tarikh filter mesti dalam bulan pilihan';end if;
 select * into cfg from finance.contribution_target_settings where id;goal:=cfg.overhead+cfg.owner_income;
 select count(*),count(*) filter(where d::date>=today) into work_count,remaining_days from generate_series(first_day::timestamp,last_day::timestamp,'1 day')d where extract(dow from d)::int=any(cfg.workdays) and not d::date=any(cfg.holidays);
 is_work:=extract(dow from today)::int=any(cfg.workdays) and not today=any(cfg.holidays);
 with rows as materialized(select x r from finance.contribution_rows(first_day,least(last_day,today))x),
 totals as (select coalesce(sum((r->>'contribution')::numeric) filter(where r->>'included'='true'),0) known,
 coalesce(sum((r->>'contribution')::numeric) filter(where r->>'included'='true' and r->>'state'='actual'),0) actual,
 coalesce(sum((r->>'contribution')::numeric) filter(where r->>'included'='true' and r->>'state'='estimated'),0) estimated,
 coalesce(sum((r->>'contribution')::numeric) filter(where r->>'included'='true' and (r->>'day')::date=today),0) today_total,
 count(*) filter(where r->>'included'='true' and r->>'contribution' is null) missing,
 count(*) filter(where r->>'included'='true') included_orders,count(*) filter(where r->>'state'='excluded') excluded_orders from rows),
 filtered as materialized(select r from rows where (ch='all' or r->>'channel'=ch) and (st='all' or r->>'state'=st or st='loss' and (r->>'contribution')::numeric<0) and (q='' or r->>'reference' ilike '%'||q||'%')
 and (coalesce(p_filter->>'from','')='' or (r->>'day')::date>=(p_filter->>'from')::date) and (coalesce(p_filter->>'to','')='' or (r->>'day')::date<=(p_filter->>'to')::date)),
 page as(select r from filtered order by
 case when p_filter->>'sort'='contribution_asc' then (r->>'contribution')::numeric end asc nulls last,
 case when p_filter->>'sort'='contribution_desc' then (r->>'contribution')::numeric end desc nulls last,
 case when p_filter->>'sort'='margin_asc' then (r->>'margin')::numeric end asc nulls last,
 r->>'day' desc,r->>'reference' limit 50 offset off)
 select jsonb_build_object('month',first_day,'today',today,'fetched_at',now(),'settings',to_jsonb(cfg),'rows',(select coalesce(jsonb_agg(r),'[]') from page),'total',(select count(*) from filtered),
 'breakdowns',jsonb_build_object('month',(select finance.margin_breakdown(jsonb_agg(r)) from rows where r->>'included'='true' and r->>'contribution' is not null),'today',(select finance.margin_breakdown(jsonb_agg(r)) from rows where r->>'included'='true' and r->>'contribution' is not null and (r->>'day')::date=today),'actual',(select finance.margin_breakdown(jsonb_agg(r)) from rows where r->>'included'='true' and r->>'state'='actual')),
 'summary',jsonb_build_object('goal',goal,'known',known,'actual',actual,'estimated',estimated,'today',today_total,'missing',missing,'included_orders',included_orders,'excluded_orders',excluded_orders,
 'remaining',greatest(goal-known,0),'after_overhead',known-cfg.overhead,'workdays',work_count,'remaining_days',remaining_days,'is_workday',is_work,
 'daily_base',case when work_count>0 then round(goal/work_count,2) end,
 'daily_target',case when remaining_days>0 then ceil(greatest(goal-known+case when is_work then today_total else 0 end,0)/remaining_days*100)/100 end,
 'daily_gap',case when remaining_days>0 then greatest(ceil(greatest(goal-known+case when is_work then today_total else 0 end,0)/remaining_days*100)/100-today_total,0) end),
 'channels',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from(select r->>'channel' channel,count(*) orders,count(*) filter(where r->>'contribution' is null) missing,
 coalesce(sum((r->>'contribution')::numeric),0) contribution,sum((r->>'sales')::numeric) sales,finance.margin_breakdown(jsonb_agg(r) filter(where r->>'contribution' is not null)) breakdown,
 case when count(*) filter(where r->>'contribution' is null or r->>'sales' is null)=0 and sum((r->>'sales')::numeric)>0 then round(sum((r->>'contribution')::numeric)/sum((r->>'sales')::numeric)*100,2) end margin
 from rows where r->>'included'='true' group by 1)c)) into result from totals;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.finance_order_report(p_filter jsonb DEFAULT '{}'::jsonb, p_export boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare res jsonb;lim integer:=case when p_export then 5000 else 50 end;off integer:=case when p_export then 0 else greatest(0,coalesce((p_filter->>'offset')::integer,0)) end;
begin
 with filtered as materialized(select r from finance.order_report_rows(p_filter)t(r)), page as (
 select r from filtered order by
 case when p_filter->>'sort'='profit_asc' then (r->>'profit')::numeric end asc nulls last,
 case when p_filter->>'sort'='margin_asc' then (r->>'margin')::numeric end asc nulls last,
 case when p_filter->>'sort'='shipping_asc' then (r->'finance_metrics'->>'shipping_net')::numeric end asc nulls last,
 case when p_filter->>'sort'='fees_desc' then (r->'finance_metrics'->>'fee_total')::numeric end desc nulls last,
 case when p_filter->>'sort'='returns_desc' then (r->'finance_metrics'->>'return_shipping')::numeric end desc nulls last,
 (r->>'placed_at')::timestamptz desc,r->>'order_id' limit lim offset off
 ),trend as (
 select ((case p_filter->>'date_basis' when 'finance' then r->>'finance_updated_at' when 'released' then r->>'released_at' else r->>'placed_at' end)::timestamptz at time zone 'Asia/Kuala_Lumpur')::date as day,
 count(*) orders,count((r->>'profit')::numeric) known_orders,sum((r->>'nett')::numeric) nett,sum((r->>'profit')::numeric) profit from filtered group by 1
 ),groups as (select coalesce(nullif(r->>'courier',''),'Tidak diketahui') name,count(*) orders,count((r->>'profit')::numeric)known_orders,sum((r->>'profit')::numeric)profit,sum((r->'finance_metrics'->>'shipping_net')::numeric)shipping_net from filtered group by 1)
 select jsonb_build_object('rows',(select coalesce(jsonb_agg(case when p_export then r||jsonb_build_object('finance_fields',(select fields from finance.order_finance_snapshots where order_id=(r->>'order_id')::uuid order by (source='webhook') desc,id desc limit 1)) else r end),'[]') from page),'total',count(*),'currency',coalesce(nullif(p_filter->>'currency',''),'MYR'),'truncated',p_export and count(*)>5000,
 'trend',(select coalesce(jsonb_agg(to_jsonb(t) order by day),'[]')from trend t),'groups',(select coalesce(jsonb_agg(to_jsonb(g) order by profit asc nulls last),'[]')from groups g),
 'breakdowns',jsonb_build_object('released',finance.margin_breakdown(jsonb_agg(r) filter(where r->>'income_state'='released'),'profit'),'escrow',finance.margin_breakdown(jsonb_agg(r) filter(where r->>'income_state' in ('escrow','report_estimate')),'profit'),'actual',finance.margin_breakdown(jsonb_agg(r) filter(where r->>'profit_state'='actual'),'profit'),'estimated',finance.margin_breakdown(jsonb_agg(r) filter(where r->>'profit_state'='estimated'),'profit')),
 'summary',jsonb_build_object('orders',count(*),'released_nett',coalesce(sum((r->>'nett')::numeric)filter(where r->>'income_state'='released'),0),'escrow_nett',coalesce(sum((r->>'nett')::numeric)filter(where r->>'income_state' in ('escrow','report_estimate')),0),
 'actual_profit',coalesce(sum((r->>'profit')::numeric)filter(where r->>'profit_state'='actual'),0),'estimated_profit',coalesce(sum((r->>'profit')::numeric)filter(where r->>'profit_state'='estimated'),0),
 'actual_orders',count(*)filter(where r->>'profit_state'='actual'),'estimated_orders',count(*)filter(where r->>'profit_state'='estimated'),'incomplete_orders',count(*)filter(where r->>'profit_state'='incomplete'),
 'loss_orders',count(*)filter(where (r->>'profit')::numeric<0),'low_margin_orders',count(*)filter(where (r->>'margin')::numeric<20),'finance_orders',count(*)filter(where r->>'finance_source'<>'missing'),
 'shipping_loss',sum(least((r->'finance_metrics'->>'shipping_net')::numeric,0))filter(where r->'finance_metrics'->>'shipping_net' is not null),'return_shipping',sum((r->'finance_metrics'->>'return_shipping')::numeric),
 'fees',sum((r->'finance_metrics'->>'fee_total')::numeric),'refunds',sum((r->'finance_metrics'->>'refund_total')::numeric),'platform_ads',sum((r->'finance_metrics'->>'platform_ads')::numeric),'affiliate',sum((r->'finance_metrics'->>'affiliate')::numeric),
 'reconciliation_issues',count(*)filter(where r->>'finance_source'<>'missing' and r->'finance_metrics'->>'reconciliation'<>'matched'))) into res from filtered;
 return res;
end $function$
;
notify pgrst,'reload schema';
