create or replace function public.finance_order_profit_detail(p_order_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb;fs jsonb;
begin
 perform finance.capture_order_cost_snapshot(p_order_id);perform finance.capture_order_finance(p_order_id);r:=finance.order_profit_row(p_order_id);
 select fields into fs from finance.order_finance_snapshots where order_id=p_order_id order by (source='webhook') desc,id desc limit 1;
 return r||jsonb_build_object('finance_fields',coalesce(fs,'{}'),'finance_history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from
 (select id,source,captured_at,metrics,fields from finance.order_finance_snapshots where order_id=p_order_id order by id desc limit 30)h));
end $$;

create or replace function public.finance_order_report(p_filter jsonb default '{}',p_export boolean default false) returns jsonb language plpgsql stable set search_path='' as $$
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
 'summary',jsonb_build_object('orders',count(*),'released_nett',coalesce(sum((r->>'nett')::numeric)filter(where r->>'income_state'='released'),0),'escrow_nett',coalesce(sum((r->>'nett')::numeric)filter(where r->>'income_state' in ('escrow','report_estimate')),0),
 'actual_profit',coalesce(sum((r->>'profit')::numeric)filter(where r->>'profit_state'='actual'),0),'estimated_profit',coalesce(sum((r->>'profit')::numeric)filter(where r->>'profit_state'='estimated'),0),
 'actual_orders',count(*)filter(where r->>'profit_state'='actual'),'estimated_orders',count(*)filter(where r->>'profit_state'='estimated'),'incomplete_orders',count(*)filter(where r->>'profit_state'='incomplete'),
 'loss_orders',count(*)filter(where (r->>'profit')::numeric<0),'low_margin_orders',count(*)filter(where (r->>'margin')::numeric<20),'finance_orders',count(*)filter(where r->>'finance_source'<>'missing'),
 'shipping_loss',sum(least((r->'finance_metrics'->>'shipping_net')::numeric,0))filter(where r->'finance_metrics'->>'shipping_net' is not null),'return_shipping',sum((r->'finance_metrics'->>'return_shipping')::numeric),
 'fees',sum((r->'finance_metrics'->>'fee_total')::numeric),'refunds',sum((r->'finance_metrics'->>'refund_total')::numeric),'platform_ads',sum((r->'finance_metrics'->>'platform_ads')::numeric),'affiliate',sum((r->'finance_metrics'->>'affiliate')::numeric),
 'reconciliation_issues',count(*)filter(where r->>'finance_source'<>'missing' and r->'finance_metrics'->>'reconciliation'<>'matched'))) into res from filtered;
 return res;
end $$;
notify pgrst,'reload schema';
