-- Private colour rules: order/cost facts and raw SKUs remain unchanged.
create or replace function finance.acrylic_colour_name(p_value text)
returns text language sql immutable set search_path='' as $fn$
with normalized as (select trim(regexp_replace(lower(coalesce(p_value,'')), '[^a-z0-9]+',' ','g')) v)
select case v
 when 'emas' then 'Gold' when 'gold' then 'Gold' when 'mirror gold' then 'Gold'
 when 'silver' then 'Silver' when 'perak' then 'Silver' when 'mirror silver' then 'Silver'
 when 'rose gold' then 'Rose Gold' when 'rosegold' then 'Rose Gold' when 'mirror rose gold' then 'Rose Gold'
 when 'black' then 'Black' when 'hitam' then 'Black'
 when 'white' then 'White' when 'putih' then 'White'
 when 'clear' then 'Clear / Transparent' when 'transparent' then 'Clear / Transparent' when 'clear transparent' then 'Clear / Transparent'
 when 'gold glitter' then 'Gold Glitter' when 'silver glitter' then 'Silver Glitter'
 when 'mirror pink' then 'Mirror Pink' when 'mirror pnk' then 'Mirror Pink'
 when 'mirror blue' then 'Mirror Blue' when 'mirror green' then 'Mirror Green'
 when 'dark blue' then 'Dark Blue' when 'light blue' then 'Light Blue'
 when 'pink' then 'Pink' when 'red' then 'Red' when 'merah' then 'Red'
 when 'blue' then 'Blue' when 'biru' then 'Blue' when 'green' then 'Green' when 'hijau' then 'Green'
 when 'yellow' then 'Yellow' when 'kuning' then 'Yellow' when 'orange' then 'Orange' when 'oren' then 'Orange'
 when 'bronze' then 'Bronze' when 'purple' then 'Purple' when 'ungu' then 'Purple'
 else null end from normalized;
$fn$;
create table if not exists finance.acrylic_colour_overrides (
 sku_key text not null, variation text not null, colour text not null,
 updated_at timestamptz not null default now(), updated_by text not null,
 primary key(sku_key,variation),
 check (colour=finance.acrylic_colour_name(colour))
);
alter table finance.acrylic_colour_overrides enable row level security;
revoke all on finance.acrylic_colour_overrides from public,anon,authenticated;
grant select,insert,update,delete on finance.acrylic_colour_overrides to service_role;

create table if not exists finance.acrylic_colour_events (
 id bigint generated always as identity primary key, sku_key text not null, variation text not null,
 old_colour text, new_colour text, actor text not null, occurred_at timestamptz not null default now()
);
alter table finance.acrylic_colour_events enable row level security;
revoke all on finance.acrylic_colour_events from public,anon,authenticated;
grant select,insert on finance.acrylic_colour_events to service_role;
grant usage,select on sequence finance.acrylic_colour_events_id_seq to service_role;

create or replace function finance.acrylic_colour(p_variation text,p_sku text,p_title text)
returns text language plpgsql stable set search_path='' as $fn$
declare colour text; values_found text[];
begin
 -- Variation describes the customer's choice; never infer Gold from the whole listing.
 colour:=finance.acrylic_colour_name(split_part(coalesce(p_variation,''),',',1));
 if colour is not null then return colour; end if;
 select array_agg(distinct finance.acrylic_colour_name(v.colour)) filter(where finance.acrylic_colour_name(v.colour) is not null)
 into values_found from public.product_variants v
 where lower(v.sku)=lower(p_sku) or lower(v.sku)=lower(nullif(split_part(p_sku,'::',2),''));
 if cardinality(values_found)=1 then return values_found[1]; end if;
 return null;
end;
$fn$;

create or replace function public.finance_sales_sku_colour_save(p_sku_key text,p_variation text,p_colour text,p_actor text)
returns jsonb language plpgsql set search_path='' as $fn$
declare colour text:=finance.acrylic_colour_name(p_colour); previous text;
begin
 if nullif(p_actor,'') is null or length(p_actor)>100 then raise exception 'Actor tidak sah';end if;
 if nullif(p_sku_key,'') is null or length(p_sku_key)>1000 or p_variation is null or length(p_variation)>2000 then raise exception 'SKU / variasi tidak sah';end if;
 if nullif(p_colour,'') is not null and colour is null then raise exception 'Warna tidak sah';end if;
 if not exists(select 1 from finance.sales_sku_lines('MYR',null) l where l.sku_key=p_sku_key and l.variation=p_variation and coalesce(finance.material_category(split_part(l.sku,'::',1),''),finance.material_category(nullif(split_part(l.sku,'::',2),''),''),finance.material_category(null,l.title))='acrylic')
 and not exists(select 1 from finance.sales_sku_lines('SGD',null) l where l.sku_key=p_sku_key and l.variation=p_variation and coalesce(finance.material_category(split_part(l.sku,'::',1),''),finance.material_category(nullif(split_part(l.sku,'::',2),''),''),finance.material_category(null,l.title))='acrylic') then raise exception 'Variasi Acrylic tidak ditemui';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_sku_key||'|'||p_variation,0));
 select o.colour into previous from finance.acrylic_colour_overrides o where o.sku_key=p_sku_key and o.variation=p_variation;
 if previous is distinct from colour then insert into finance.acrylic_colour_events(sku_key,variation,old_colour,new_colour,actor) values(p_sku_key,p_variation,previous,colour,p_actor);end if;
 if colour is null then delete from finance.acrylic_colour_overrides where sku_key=p_sku_key and variation=p_variation;
 else insert into finance.acrylic_colour_overrides(sku_key,variation,colour,updated_by) values(p_sku_key,p_variation,colour,p_actor)
 on conflict(sku_key,variation) do update set colour=excluded.colour,updated_by=excluded.updated_by,updated_at=now();end if;
 return jsonb_build_object('saved',true,'colour',colour);
end;
$fn$;
revoke all on function finance.acrylic_colour_name(text),finance.acrylic_colour(text,text,text),public.finance_sales_sku_colour_save(text,text,text,text) from public,anon,authenticated;
grant execute on function finance.acrylic_colour_name(text),finance.acrylic_colour(text,text,text),public.finance_sales_sku_colour_save(text,text,text,text) to service_role;

-- Filter only after full-order contribution allocation; never change accounting snapshots.
create or replace function public.finance_sales_sku_report(p_filter jsonb default '{}')
returns jsonb language plpgsql stable set search_path='' as $fn$
declare f date:=nullif(p_filter->>'from','')::date; t date:=coalesce(nullif(p_filter->>'to','')::date,(now() at time zone 'Asia/Kuala_Lumpur')::date);
 c text:=coalesce(nullif(p_filter->>'currency',''),'MYR'); shop text:=nullif(p_filter->>'shop_id',''); q text:=left(coalesce(p_filter->>'query',''),200); selected text:=nullif(p_filter->>'sku_key',''); cat text:=nullif(p_filter->>'category',''); colour_filter text:=nullif(p_filter->>'colour',''); result jsonb;
begin
 if c!~'^[A-Z]{3}$' or (f is not null and f>t) or t>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Julat tarikh / currency tidak sah';end if;
 if cat is not null and cat not in ('topper','edible','wafer','acrylic','other') then raise exception 'Kategori tidak sah'; end if;
 if colour_filter is not null and (cat is distinct from 'acrylic' or (colour_filter<>'unknown' and finance.acrylic_colour_name(colour_filter) is null)) then raise exception 'Filter warna Acrylic tidak sah';end if;
 if colour_filter is not null and colour_filter<>'unknown' then colour_filter:=finance.acrylic_colour_name(colour_filter);end if;
 with all_lines as materialized(select * from finance.sales_sku_lines(c,shop)),
 lines as materialized(select * from all_lines where day<=t and (f is null or day>=f)),
 classified as materialized(select sku,title,coalesce(finance.material_category(split_part(sku,'::',1),''),finance.material_category(nullif(split_part(sku,'::',2),''),''),finance.material_category(null,title),'other') category from (select distinct sku,title from lines)x),
 order_profit as materialized(select order_id,finance.order_profit_row(order_id) data from (select distinct order_id from lines)x),
 order_goods as (select order_id,sum(sales) goods,count(*) filter(where sales is null) missing from lines group by 1),
 enriched as materialized(
 select l.*,k.category,l.quantity-l.returned net_units,
 case when l.quantity>0 then l.sales*l.returned/l.quantity else 0 end return_value_estimate,
 case when g.goods>0 and g.missing=0 and p.data->>'profit' is not null then (p.data->>'profit')::numeric*l.sales/g.goods end allocated_profit,
 p.data->>'income_state' income_state
 from lines l join classified k on k.sku=l.sku and k.title=l.title join order_goods g using(order_id) join order_profit p using(order_id)
 ),
 category_lines as materialized(select e.*,case when category='acrylic' then coalesce(o.colour,finance.acrylic_colour(e.variation,e.sku,e.title),'unknown') end colour,
 o.colour override_colour from enriched e left join finance.acrylic_colour_overrides o on e.category='acrylic' and o.sku_key=e.sku_key and o.variation=e.variation),
 coloured as materialized(select *,case when category='acrylic' then sku_key||'#colour='||colour else sku_key end report_key from category_lines where cat is null or category=cat),
 scoped as materialized(select * from coloured where colour_filter is null or colour=colour_filter),
 groups as (
 select report_key sku_key,min(sku_key) base_sku_key,min(colour) colour,min(sku) sku,min(title) title,count(distinct variation) variations,
 sum(quantity) units,sum(returned) returned,sum(net_units) net_units,count(distinct order_id) orders,
 case when count(*) filter(where sales is null)=0 then round(sum(sales),2) end sales,
 round(sum(return_value_estimate),2) return_value_estimate,
 case when count(*) filter(where allocated_profit is null)=0 then round(sum(allocated_profit),2) end profit,
 round(sum(allocated_profit),2) known_profit,count(distinct order_id) filter(where allocated_profit is null) missing_profit_orders,
 count(distinct order_id) filter(where income_state<>'released') estimate_orders
 from scoped group by report_key
 ), searched as (select * from groups where q='' or sku ilike '%'||q||'%' or title ilike '%'||q||'%'),
 chosen as materialized(select * from scoped where selected is null or report_key=selected),
 bounds as (select coalesce(f,min(day),t) first_day,case when t-coalesce(f,min(day),t)>93 then 'month' else 'day' end bucket from all_lines),
 trend as (select date_trunc(b.bucket,day::timestamp)::date as "day",sum(net_units) units,case when count(*) filter(where sales is null)=0 then round(sum(sales),2) end sales,
 case when count(*) filter(where allocated_profit is null)=0 then round(sum(allocated_profit),2) end profit,count(distinct order_id) orders from chosen cross join bounds b group by 1),
 calendar as (select generate_series(date_trunc(bucket,first_day::timestamp),date_trunc(bucket,t::timestamp),case when bucket='month' then interval '1 month' else interval '1 day' end)::date as "day" from bounds)
 select jsonb_build_object('from',f,'to',t,'currency',c,'category',cat,'colour',colour_filter,
 'colour_options',coalesce((select jsonb_agg(colour order by colour) from (select distinct colour from coloured where category='acrylic')o),'[]'),
 'colour_breakdown',coalesce((select jsonb_agg(to_jsonb(b) order by b.net_units desc) from (select colour,sum(net_units) net_units,case when count(*) filter(where sales is null)=0 then round(sum(sales),2) end sales from coloured where category='acrylic' group by colour)b),'[]'),
 'colour_variations',coalesce((select jsonb_agg(to_jsonb(v) order by v.sku,v.variation) from (select sku_key,min(sku) sku,min(title) title,variation,min(colour) colour,min(override_colour) override_colour,sum(net_units) net_units from chosen where category='acrylic' group by sku_key,variation order by sku_key,variation limit 1000)v),'[]'),
 'rows',coalesce((select jsonb_agg(to_jsonb(g) order by g.net_units desc,g.sku_key) from (select * from searched order by net_units desc,sku_key limit 5000)g),'[]'),
 'truncated',(select count(*)>5000 from searched),'sku_count',(select count(*) from searched),
 'summary',(select jsonb_build_object('units',coalesce(sum(quantity),0),'returned',coalesce(sum(returned),0),'net_units',coalesce(sum(net_units),0),'orders',count(distinct order_id),'sales',case when count(*) filter(where sales is null)=0 then coalesce(round(sum(sales),2),0) end,'sku_count',count(distinct report_key),'missing_sku_lines',count(*) filter(where sku='Tanpa SKU')) from scoped),
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
