
do $migration$
declare def text;
begin
select pg_get_functiondef('finance.contribution_rows(date,date)'::regprocedure) into def;
def:=replace(def,'''extras'',(r->>''extra_total'')::numeric,','''extras'',(r->>''extra_total'')::numeric,''packing'',(r#>>''{extra_costs,packaging,amount}'')::numeric,');
execute def;
end $migration$;
create or replace function finance.margin_breakdown(p_rows jsonb,p_kind text default 'target') returns jsonb language sql immutable set search_path='' as $$
with base as(select
 case when p_kind='profit' then (r->>'goods_value')::numeric else (r->>'sales')::numeric end sales,
 case when p_kind='profit' then (r->'finance_metrics'->>'fee_total')::numeric else (r->>'fee')::numeric end fee,
 case when p_kind='target' and r->>'channel'='deco' then (r->>'courier')::numeric else 0 end courier,
 (r->>'nett')::numeric nett,
 case when p_kind='profit' then (r->>'material_total')::numeric else (r->>'material')::numeric end material,
 case when p_kind='profit' then (r#>>'{extra_costs,packaging,amount}')::numeric else (r->>'packing')::numeric end packing,
 case when p_kind='profit' then (r->>'extra_total')::numeric-coalesce((r#>>'{extra_costs,packaging,amount}')::numeric,0)
 when r->>'channel'='shopee' then (r->>'extras')::numeric-coalesce((r->>'packing')::numeric,0)
 else (r->>'extras')::numeric end extras,
 case when p_kind='profit' then (r->>'profit')::numeric else (r->>'contribution')::numeric end contribution,
 case when p_kind='target' and r->>'channel'='deco' then (r->>'customer_paid')::numeric-(r->>'sales')::numeric
 when p_kind='profit' then (r->>'nett')::numeric-(r->>'goods_value')::numeric+(r->'finance_metrics'->>'fee_total')::numeric
 else (r->>'nett')::numeric-(r->>'sales')::numeric+(r->>'fee')::numeric end adjustment
 from jsonb_array_elements(coalesce(p_rows,'[]')) r)
select jsonb_build_object('orders',count(*),'missing',count(*) filter(where sales is null or fee is null or courier is null or nett is null or material is null or packing is null or extras is null or adjustment is null),
 'sales',case when count(sales)=count(*) then coalesce(sum(sales),0) end,
 'fee',case when count(fee)=count(*) then coalesce(sum(fee),0) end,
 'courier',case when count(courier)=count(*) then coalesce(sum(courier),0) end,
 'adjustment',case when count(adjustment)=count(*) then coalesce(sum(adjustment),0) end,
 'nett',case when count(nett)=count(*) then coalesce(sum(nett),0) end,
 'material',case when count(material)=count(*) then coalesce(sum(material),0) end,
 'packing',case when count(packing)=count(*) then coalesce(sum(packing),0) end,
 'extras',case when count(extras)=count(*) then coalesce(sum(extras),0) end,
 'contribution',case when count(contribution)=count(*) then coalesce(sum(contribution),0) end) from base
$$;
do $migration$
declare def text;
begin
select pg_get_functiondef('public.finance_order_report(jsonb,boolean)'::regprocedure) into def;
def:=replace(def,'''summary'',jsonb_build_object(''orders'',count(*),',
 '''summary'',jsonb_build_object(''packing_total'',coalesce(sum((r#>>''{extra_costs,packaging,amount}'')::numeric),0),''packing_known'',count(r#>>''{extra_costs,packaging,amount}''),''orders'',count(*),');
execute def;
select pg_get_functiondef('public.finance_business_snapshot(date)'::regprocedure) into def;
def:=replace(def,'''schema_version'',1','''schema_version'',2');
def:=replace(def,'else 0 end recorded_packing,','else (r->>''packing'')::numeric end recorded_packing,');
def:=replace(def,'count(*)filter(where material is not null) cost_known,',
 'coalesce(sum(recorded_packing),0) packing_total,coalesce(sum(recorded_packing)filter(where channel=''shopee''),0) packing_shopee,coalesce(sum(recorded_packing)filter(where channel<>''shopee''),0) packing_direct,count(*)filter(where recorded_packing is null) packing_missing,count(*)filter(where material is not null) cost_known,');
def:=replace(def,'''material'',material,''payout'',payout,','''material'',material,''packing'',recorded_packing,''payout'',payout,');
execute def;
end $migration$;
