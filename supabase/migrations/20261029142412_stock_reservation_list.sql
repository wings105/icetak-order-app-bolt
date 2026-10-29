-- Private active-reservation read model. Ledger and reservation writes are unchanged.
create or replace function stock.reservations(p_payload jsonb)
returns jsonb language sql stable security invoker set search_path='' as $reserve$
with selected as (
 select a.source,a.order_id,a.material_code,sum(a.quantity) quantity,max(a.updated_at) updated_at
 from stock.allocations a join stock.order_state s using(source,order_id)
 where a.state='reserved'
 and (nullif(p_payload->>'reservation_material','') is null or a.material_code=p_payload->>'reservation_material')
 and (nullif(trim(p_payload->>'reservation_query'),'') is null
  or strpos(lower(coalesce(s.reference,a.order_id::text)),lower(left(trim(p_payload->>'reservation_query'),80)))>0)
 group by a.source,a.order_id,a.material_code
), orders as (
 select a.source,a.order_id,s.reference,s.stage,
  coalesce(case when a.source='shopee' then mp.current_status else coalesce(o.admin_status,o.status) end,s.stage) order_status,
  max(a.updated_at) updated_at,
  jsonb_agg(jsonb_build_object('material_code',a.material_code,'name',m.name,'base_unit',m.base_unit,'quantity',a.quantity) order by m.name,m.code) materials
 from selected a join stock.order_state s using(source,order_id)
 join stock.materials m on m.code=a.material_code
 left join public.orders o on a.source='icetak' and o.id=a.order_id
 left join public.marketplace_orders mp on a.source='shopee' and mp.id=a.order_id
 group by a.source,a.order_id,s.reference,s.stage,o.admin_status,o.status,mp.current_status
)
select jsonb_build_object(
 'reservations',(select coalesce(jsonb_agg(to_jsonb(r) order by updated_at desc,source,order_id),'[]') from (
  select * from orders order by updated_at desc,source,order_id limit 100
  offset least(1000000,greatest(0,coalesce((p_payload->>'reservation_offset')::integer,0)))
 )r),
 'reservations_total',(select count(*) from orders),
 'reservation_totals',(select coalesce(jsonb_agg(to_jsonb(r) order by name,material_code),'[]') from (
  select a.material_code,m.name,m.base_unit,sum(a.quantity) quantity
  from selected a join stock.materials m on m.code=a.material_code group by a.material_code,m.name,m.base_unit
 )r),
 'reservation_filter',jsonb_build_object('material_code',coalesce(p_payload->>'reservation_material',''),'query',left(trim(coalesce(p_payload->>'reservation_query','')),80),
 'offset',least(1000000,greatest(0,coalesce((p_payload->>'reservation_offset')::integer,0))))
);
$reserve$;
revoke all on function stock.reservations(jsonb) from public,anon,authenticated;
grant execute on function stock.reservations(jsonb) to service_role;

CREATE OR REPLACE FUNCTION stock.snapshot(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with filtered_issues as (
 select i.*,s.reference,s.stage,
 case when i.code in ('linked_duplicate','after_dispatch_edit') then 0
 when i.code='shortage' then 1 when s.stage='to_ship' then 2 else 3 end priority
 from stock.issues i left join stock.order_state s using(source,order_id)
 where i.resolved_at is null
 and (nullif(p_payload->>'issue_code','') is null or i.code=p_payload->>'issue_code')
 and (coalesce(p_payload->>'issue_scope','all')<>'active' or s.stage='to_ship')
), history as (
 select a.*,m.name,m.base_unit,
 case when count(*) filter(where a.kind='opening') over w>0 then sum(a.delta) over w end balance_after,
 sum(a.reserved_delta) over w reserved_after
 from stock.movements a join stock.materials m on m.code=a.material_code
 where (nullif(p_payload->>'material_code','') is null or a.material_code=p_payload->>'material_code')
 window w as(partition by a.material_code order by a.created_at,a.id range unbounded preceding)
)
select jsonb_build_object(
 'checked_at',now(),'settings',(select to_jsonb(s) from stock.settings s where singleton),
 'materials',(select coalesce(jsonb_agg(to_jsonb(m) order by priority,available nulls last,auto_eligible desc,name,code),'[]') from stock.material_health m),
 'rules',(select coalesce(jsonb_agg(to_jsonb(r) order by category,size_key,shape_key),'[]') from stock.size_rules r),
 'item_rules',(select coalesce(jsonb_agg(to_jsonb(r) order by updated_at desc),'[]') from(select * from stock.item_rules order by updated_at desc limit 100)r),
 'issues',(select coalesce(jsonb_agg(to_jsonb(i) order by priority,updated_at desc,source,order_id,line_key,code),'[]') from(
  select * from filtered_issues order by priority,updated_at desc,source,order_id,line_key,code
  limit 100 offset least(1000000,greatest(0,coalesce((p_payload->>'issue_offset')::integer,0)))
 )i),
 'issues_total',(select count(*) from filtered_issues),
 'movements',(select coalesce(jsonb_agg(to_jsonb(v) order by created_at desc,id desc),'[]') from(
  select * from history order by created_at desc,id desc limit 100
  offset least(1000000,greatest(0,coalesce((p_payload->>'offset')::integer,0)))
 )v),
 'summary',jsonb_build_object(
  'missing_opening',(select count(*) from stock.materials where on_hand is null and auto_eligible),
  'missing_opening_all',(select count(*) from stock.materials where on_hand is null),
  'low_stock',(select count(*) from stock.material_health where available<=coalesce(minimum,0)),
  'incomplete_materials',(select count(*) from stock.material_health where unresolved_usage>0),
  'integrity_errors',(select count(*) from stock.material_health where ledger_mismatch),
  'open_issues',(select count(*) from stock.issues where resolved_at is null),
  'blocked_orders',(select count(*) from stock.work_queue where status='blocked'),
  'reserved_orders',(select count(distinct(source,order_id)) from stock.allocations where state='reserved'),
  'pending',(select count(*) from stock.work_queue where status='pending'),
  'failed',(select count(*) from stock.work_queue where status='failed'))
) || case when p_payload->>'include_reservations'='true' then stock.reservations(p_payload) else '{}'::jsonb end;
$function$;
