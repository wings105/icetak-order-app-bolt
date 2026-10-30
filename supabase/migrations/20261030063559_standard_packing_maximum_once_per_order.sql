
create table finance.packing_cost_settings (
 id boolean primary key default true check(id),
 rates jsonb not null,
 assumptions jsonb not null,
 updated_at timestamptz not null default now()
);
insert into finance.packing_cost_settings values(true,
 '{"small":0.21,"edible_large":0.34,"acrylic":0.74}',
 '{"basis":"maximum_item_rate_once_per_order","edible_large_unit_price_above":12,"a2_cardboard":1.05,"awb_ream_price":11,"awb_ream_sheets":500,"opp_pack_price":6,"opp_pack_pieces":100,"opp_count_confirmed":false}',now());
alter table finance.packing_cost_settings enable row level security;
revoke all on finance.packing_cost_settings from public,anon,authenticated;
grant select on finance.packing_cost_settings to service_role;
create function finance.packing_estimate(p_lines jsonb) returns numeric language sql stable set search_path='' as $$
 select max(case when l->>'category'='acrylic' then (s.rates->>'acrylic')::numeric
 when l->>'category'='edible' and coalesce((l->>'goods_value')::numeric,(l->>'goods')::numeric,0)/greatest(coalesce((l->>'quantity')::numeric,(l->>'qty')::numeric,1),1)>12 then (s.rates->>'edible_large')::numeric
 when l->>'category' in ('topper','edible','wafer') then (s.rates->>'small')::numeric end)
 from jsonb_array_elements(coalesce(p_lines,'[]')) l cross join finance.packing_cost_settings s where s.id
$$;
revoke all on function finance.packing_estimate(jsonb) from public,anon,authenticated;
grant execute on function finance.packing_estimate(jsonb) to service_role;
create function finance.apply_standard_packing() returns trigger language plpgsql set search_path='' as $$
declare amount numeric;
begin
 if coalesce(new.extra_costs#>>'{packaging,mode}','estimated')='estimated'
 and coalesce(new.extra_costs#>>'{packaging,basis}','') in ('','max_item_once_per_order')
 and (coalesce((new.extra_costs#>>'{packaging,amount}')::numeric,0)=0 or new.extra_costs#>>'{packaging,basis}'='max_item_once_per_order') then
 amount:=finance.packing_estimate(new.material_lines);
 if amount is not null then new.extra_costs:=jsonb_set(new.extra_costs,'{packaging}',jsonb_build_object('amount',amount,'mode','estimated','basis','max_item_once_per_order')); end if;
 end if;
 return new;
end $$;
revoke all on function finance.apply_standard_packing() from public,anon,authenticated;
create trigger standard_packing before insert or update of material_lines,extra_costs on finance.marketplace_order_costs for each row execute function finance.apply_standard_packing();
update finance.marketplace_order_costs set extra_costs=extra_costs,version=version+1,updated_at=now()
where coalesce((extra_costs#>>'{packaging,amount}')::numeric,0)=0 and extra_costs#>>'{packaging,mode}'='estimated';
do $$
declare def text;
begin
 select pg_get_functiondef('finance.order_profit_base(uuid)'::regprocedure) into def;
 def:=replace(def,'missing:=jsonb_array_length(lines)=0;',
 'if coalesce(extras#>>''{packaging,mode}'',''estimated'')=''estimated'' and (coalesce((extras#>>''{packaging,amount}'')::numeric,0)=0 or extras#>>''{packaging,basis}''=''max_item_once_per_order'') and finance.packing_estimate(lines) is not null then extras:=jsonb_set(extras,''{packaging}'',jsonb_build_object(''amount'',finance.packing_estimate(lines),''mode'',''estimated'',''basis'',''max_item_once_per_order'')); end if;
 missing:=jsonb_array_length(lines)=0;');
 execute def;
 select pg_get_functiondef('finance.direct_margin_row(uuid)'::regprocedure) into def;
 def:=replace(def,'net-mat-coalesce(c.extras,0)','net-mat-coalesce(c.extras,0)-coalesce(finance.packing_estimate(lines),0)');
 def:=replace(def,'''extras'',coalesce(c.extras,0),','''packing'',finance.packing_estimate(lines),''extras'',coalesce(c.extras,0),');
 def:=replace(def,'actual:=receipts is not null','actual:=false and receipts is not null');
 execute def;
 select pg_get_functiondef('public.finance_business_snapshot(date)'::regprocedure) into def;
 def:=replace(def,'greatest(packing-recorded_packing,0)','case when channel=''shopee'' then 0 else coalesce((r->>''packing'')::numeric,0) end');
 -- Direct contribution already includes its packing.
 def:=replace(def,'base_contribution-case when channel=''shopee'' then 0 else coalesce((r->>''packing'')::numeric,0) end','base_contribution');
 def:=replace(def,'Packing floor applied once.','Packing uses maximum item rate once per order; included in contribution.');
 execute def;
end $$;
