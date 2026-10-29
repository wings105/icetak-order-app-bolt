-- Compare-and-swap patches preserve current privileges and reject a changed production baseline.
select pg_advisory_xact_lock(hashtextextended('stock:writer',0));
-- One private read model for stock consumers; keep ledger history immutable.
create or replace view stock.material_health with (security_invoker=true) as
with ledger as (
 select material_code,sum(delta) balance,sum(reserved_delta) reserve from stock.movements group by material_code
), allocations as (
 select material_code,sum(quantity) reserve from stock.allocations where state='reserved' group by material_code
), usage as (
 select m.code,count(distinct(i.source,i.order_id,i.line_key)) pending
 from stock.materials m join stock.issues i on i.resolved_at is null
 and i.code in ('mapping_needed','opening_needed','before_activation','before_count')
 and (i.details->>'material_code'=m.code or i.details->>'category'=m.category
      or (m.category='double_tape' and i.details->>'category'='glossy'))
 group by m.code
), facts as (
 select m.*,m.on_hand-m.reserved available,coalesce(u.pending,0) unresolved_usage,
  (m.reserved<>coalesce(a.reserve,0) or m.reserved<>coalesce(l.reserve,0)
   or (m.on_hand is not null and m.on_hand<>coalesce(l.balance,0))) ledger_mismatch
 from stock.materials m left join ledger l on l.material_code=m.code
 left join allocations a on a.material_code=m.code left join usage u on u.code=m.code
), ranked as (
 select f.*,case when ledger_mismatch then 0 when available<0 then 1 when available=0 then 2
  when available<=minimum then 3 when unresolved_usage>0 then 4
  when on_hand is null and auto_eligible then 5 when auto_eligible and not auto_enabled then 6
  when on_hand is null then 8 else 7 end priority
 from facts f
)
select r.*,case priority when 0 then 'ledger_mismatch' when 1 then 'shortage' when 2 then 'empty'
 when 3 then 'low' when 4 then 'incomplete' when 5 then 'opening_needed'
 when 6 then 'paused' when 8 then 'manual_uncounted' else 'healthy' end health
from ranked r;
revoke all on stock.material_health from public,anon,authenticated;
grant select on stock.material_health to service_role;

create or replace function stock.snapshot(p_payload jsonb) returns jsonb
language sql stable security invoker set search_path='' as $snapshot$
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
);
$snapshot$;
revoke all on function stock.snapshot(jsonb) from public,anon,authenticated;
grant execute on function stock.snapshot(jsonb) to service_role;

do $patch$
declare d text:=btrim(pg_get_functiondef('public.icetak_stock_admin(text,jsonb,text)'::regprocedure), E' \n\r\t');
begin
 if md5(d)<>'2e2ee1935a1ef28745519484348b6318' then raise exception 'Stock function changed since review: public.icetak_stock_admin';end if;
 d:=overlay(d placing $edit$;$edit$ from 11943 for 0);
 d:=overlay(d placing $edit$
  if nullif(p_payload->>'minimum','')::numeric<0 then raise exception 'INVALID_MINIMUM';end if;$edit$ from 5727 for 0);
 d:=overlay(d placing $edit$ if p_action in ('purchase','adjustment') and (select on_hand>=0 from stock.materials where code=v_code) then
   update stock.issues set resolved_at=now() where resolved_at is null and code='shortage' and details->>'material_code'=v_code;
  end if;
 $edit$ from 5692 for 0);
 d:=overlay(d placing $edit$$edit$ from 2412 for 2);
 d:=overlay(d placing $edit$$edit$ from 1661 for 749);
 d:=overlay(d placing $edit$$edit$ from 982 for 669);
 d:=overlay(d placing $edit$$edit$ from 978 for 3);
 d:=overlay(d placing $edit$$edit$ from 960 for 17);
 d:=overlay(d placing $edit$p$edit$ from 844 for 114);
 d:=overlay(d placing $edit$$edit$ from 721 for 121);
 d:=overlay(d placing $edit$$edit$ from 636 for 78);
 d:=overlay(d placing $edit$$edit$ from 626 for 2);
 if md5(d)<>'b5a8bc3c9b8a2c4e2eab31d3e53ad7ba' then raise exception 'Stock patch checksum failed: public.icetak_stock_admin';end if;
 execute d;
end $patch$;
