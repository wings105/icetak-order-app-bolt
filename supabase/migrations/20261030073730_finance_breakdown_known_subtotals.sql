CREATE OR REPLACE FUNCTION finance.margin_breakdown(p_rows jsonb, p_kind text DEFAULT 'target'::text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
 'known',jsonb_build_object('sales',count(sales),'fee',count(fee),'courier',count(courier),'adjustment',count(adjustment),'nett',count(nett),'material',count(material),'packing',count(packing),'extras',count(extras),'contribution',count(contribution)),
 'partial',count(*)>0 and (count(sales)<count(*) or count(fee)<count(*) or count(courier)<count(*) or count(adjustment)<count(*) or count(nett)<count(*) or count(material)<count(*) or count(packing)<count(*) or count(extras)<count(*) or count(contribution)<count(*)),
 'sales',case when count(*)=0 then 0 when count(sales)>0 then sum(sales) end,
 'fee',case when count(*)=0 then 0 when count(fee)>0 then sum(fee) end,
 'courier',case when count(*)=0 then 0 when count(courier)>0 then sum(courier) end,
 'adjustment',case when count(*)=0 then 0 when count(adjustment)>0 then sum(adjustment) end,
 'nett',case when count(*)=0 then 0 when count(nett)>0 then sum(nett) end,
 'material',case when count(*)=0 then 0 when count(material)>0 then sum(material) end,
 'packing',case when count(*)=0 then 0 when count(packing)>0 then sum(packing) end,
 'extras',case when count(*)=0 then 0 when count(extras)>0 then sum(extras) end,
 'contribution',case when count(*)=0 then 0 when count(contribution)>0 then sum(contribution) end) from base
$function$
