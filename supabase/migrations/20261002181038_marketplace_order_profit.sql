-- Private managerial order costing. No journal entries, payment/order mutations or historical backfill.
create table finance.material_cost_versions (
  version bigint generated always as identity primary key,
  effective_at timestamptz not null unique,
  rates jsonb not null,
  sku_costs jsonb not null default '{}'::jsonb,
  actor text not null,
  created_at timestamptz not null default now()
);
insert into finance.material_cost_versions(effective_at,rates,actor) values
('1970-01-01T00:00:00Z','{"topper":12.70,"edible":42.50,"wafer":23.33,"acrylic":15.83}','initial_estimate');

create table finance.marketplace_order_costs (
  order_id uuid primary key references public.marketplace_orders(id),
  version integer not null default 1,
  settings_version bigint not null references finance.material_cost_versions(version),
  source_signature text not null,
  material_lines jsonb not null,
  extra_costs jsonb not null,
  work_minutes numeric(10,2),
  reviewed boolean not null default false,
  note text not null default '',
  actor text not null default 'snapshot',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (work_minutes is null or work_minutes between 0 and 100000)
);
create index material_cost_versions_effective_idx on finance.material_cost_versions(effective_at desc);
create index marketplace_order_costs_settings_idx on finance.marketplace_order_costs(settings_version);
alter table finance.material_cost_versions enable row level security;
alter table finance.marketplace_order_costs enable row level security;
revoke all on finance.material_cost_versions,finance.marketplace_order_costs from public,anon,authenticated;
grant select,insert on finance.material_cost_versions to service_role;
grant select,insert,update on finance.marketplace_order_costs to service_role;
grant usage,select on sequence finance.material_cost_versions_version_seq to service_role;

create function finance.cost_number(p_value jsonb, p_nullable boolean default false) returns numeric
language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
  if p_nullable and (p_value is null or p_value='null'::jsonb) then return null; end if;
  if jsonb_typeof(p_value) is distinct from 'number' then raise exception 'Kos mestilah nombor yang sah'; end if;
  n := (p_value #>> '{}')::numeric;
  if n < 0 or n > 1000000 or n::text in ('NaN','Infinity','-Infinity') then raise exception 'Kos di luar julat 0–1,000,000'; end if;
  return round(n,2);
end $$;

create function finance.material_category(p_sku text,p_title text) returns text
language plpgsql stable set search_path='' as $$
declare cat text; t text:=lower(coalesce(p_title,''));
begin
  select c.slug into cat from public.products p join public.product_categories c on c.id=p.category_id
  where lower(p.parent_sku)=lower(p_sku) order by p.id limit 1;
  if cat is null then
    select c.slug into cat from public.product_variants v join public.products p on p.id=v.product_id
    join public.product_categories c on c.id=p.category_id where lower(v.sku)=lower(p_sku) order by v.id limit 1;
  end if;
  if cat='acrylic-topper' then return 'acrylic';
  elsif cat='wafer-paper' then return 'wafer';
  elsif cat='edible-image' then return 'edible';
  elsif cat in ('custom-name-topper','ready-stock-topper') then return 'topper'; end if;
  -- Conservative fallback. Mixed edible+wafer products need an explicit SKU cost or manual cost.
  if t ~ '(edible|icing paper)' and t ~ 'wafer' and t !~ '(not icing|not edible)' then return null; end if;
  if t ~ 'acrylic' then return 'acrylic';
  elsif t ~ 'wafer' then return 'wafer';
  elsif t ~ '(edible|icing paper)' then return 'edible';
  elsif t ~ 'topper' then return 'topper'; end if;
  return null;
end $$;

create function finance.order_material_basis(p_order_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('signature',md5(coalesce(jsonb_agg(jsonb_build_array(i.line_no,i.item_sku,i.variation_sku,i.title,i.quantity,i.line_subtotal,i.unit_discounted_price,i.unit_original_price) order by i.line_no,i.id),'[]'::jsonb)::text),
    'items',coalesce(jsonb_agg(jsonb_build_object('line_no',i.line_no,'sku',coalesce(nullif(i.variation_sku,''),i.item_sku,''),'parent_sku',i.item_sku,
      'title',i.title,'variation',i.variation_name,'quantity',i.quantity,
      'goods_value',coalesce(i.line_subtotal,i.quantity*coalesce(i.unit_discounted_price,i.unit_original_price))) order by i.line_no,i.id),'[]'::jsonb))
  from public.marketplace_order_items i where i.order_id=p_order_id and i.is_current;
$$;

create function finance.order_material_estimate(p_order_id uuid,p_settings_version bigint default null) returns jsonb
language plpgsql stable set search_path='' as $$
declare s finance.material_cost_versions%rowtype; o public.marketplace_orders%rowtype; basis jsonb; item jsonb; conf jsonb; cat text; amount numeric; rate numeric; result jsonb:='[]'; cur text;
begin
  select * into o from public.marketplace_orders where id=p_order_id;
  if not found then raise exception 'Order tidak dijumpai'; end if;
  if p_settings_version is null then
    select * into s from finance.material_cost_versions where effective_at<=o.first_seen_at order by effective_at desc limit 1;
  else select * into s from finance.material_cost_versions where version=p_settings_version; end if;
  if s.version is null then raise exception 'Versi modal tidak dijumpai'; end if;
  cur:=coalesce(nullif(o.currency,''),'MYR');
  basis:=finance.order_material_basis(p_order_id);
  for item in select value from jsonb_array_elements(basis->'items') loop
    conf:=coalesce(s.sku_costs->lower((item->>'parent_sku')||'::'||(item->>'sku')),s.sku_costs->lower(item->>'sku'),s.sku_costs->lower(item->>'parent_sku'));
    cat:=coalesce(conf->>'category',finance.material_category(coalesce(nullif(item->>'parent_sku',''),item->>'sku'),item->>'title'));
    rate:=(s.rates->>cat)::numeric;
    amount:=null;
    if (item->>'quantity')::numeric>0 then
      if conf is not null and cur='MYR' then amount:=round((conf->>'unit_cost')::numeric*(item->>'quantity')::numeric,2);
      elsif rate is not null and (item->>'goods_value')::numeric>=0 then amount:=round((item->>'goods_value')::numeric*rate/100,2); end if;
    end if;
    result:=result||jsonb_build_array(item||jsonb_build_object('category',cat,'rate',rate,'unit_cost',case when cur='MYR' then conf->'unit_cost' end,
      'amount',amount,'mode','estimated','basis',case when conf is not null and cur='MYR' then 'sku_unit' when rate is not null then 'category_percent' else 'unmapped' end));
  end loop;
  return jsonb_build_object('settings_version',s.version,'signature',basis->>'signature','lines',result);
end $$;

create function finance.empty_order_extras() returns jsonb language sql immutable set search_path='' as $$
  select jsonb_object_agg(k,jsonb_build_object('amount',0,'mode','estimated')) from unnest(array['packaging','wastage','reprint','labor','shipping','ads','affiliate']) k;
$$;

-- New/changed item detail freezes its version. Existing orders get a reproducible seed-version preview;
-- opening/saving that order captures it explicitly. No bulk write to historic orders.
create function finance.capture_order_cost_snapshot(p_order_id uuid) returns void language plpgsql set search_path='' as $$
declare est jsonb;
begin
  if exists(select 1 from finance.marketplace_order_costs where order_id=p_order_id) then return; end if;
  if not exists(select 1 from public.marketplace_order_items where order_id=p_order_id and is_current) then return; end if;
  est:=finance.order_material_estimate(p_order_id);
  insert into finance.marketplace_order_costs(order_id,settings_version,source_signature,material_lines,extra_costs)
  values(p_order_id,(est->>'settings_version')::bigint,est->>'signature',est->'lines',finance.empty_order_extras()) on conflict(order_id) do nothing;
end $$;
create function finance.capture_order_cost_after_item() returns trigger language plpgsql security definer set search_path='' as $$
begin perform finance.capture_order_cost_snapshot(new.order_id); return new; end $$;
create constraint trigger capture_finance_order_cost_after_item after insert or update on public.marketplace_order_items
deferrable initially deferred for each row execute function finance.capture_order_cost_after_item();

create function finance.order_profit_row(p_order_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare o public.marketplace_orders%rowtype; f public.marketplace_order_financials%rowtype; c finance.marketplace_order_costs%rowtype;
  est jsonb; lines jsonb; extras jsonb; basis jsonb; item jsonb; material numeric:=0; extra numeric:=0; goods numeric:=0;
  income numeric; profit numeric; income_state text:='missing'; cost_state text:='estimated'; missing boolean:=false; all_actual boolean:=true;
  changed boolean:=false; lifecycle boolean:=false; categories jsonb; skus jsonb; rate_version bigint;
begin
  select * into o from public.marketplace_orders where id=p_order_id;
  if not found then raise exception 'Order tidak dijumpai'; end if;
  select * into f from public.marketplace_order_financials where order_id=p_order_id;
  select * into c from finance.marketplace_order_costs where order_id=p_order_id;
  basis:=finance.order_material_basis(p_order_id);
  if c.order_id is not null then lines:=c.material_lines; extras:=c.extra_costs; rate_version:=c.settings_version; changed:=c.source_signature<>basis->>'signature';
  else est:=finance.order_material_estimate(p_order_id); lines:=est->'lines'; extras:=finance.empty_order_extras(); rate_version:=(est->>'settings_version')::bigint; end if;
  if changed then lines:=finance.order_material_estimate(p_order_id,c.settings_version)->'lines'; end if;
  missing:=jsonb_array_length(lines)=0;
  for item in select value from jsonb_array_elements(lines) loop
    if item->>'amount' is null then missing:=true; else material:=material+(item->>'amount')::numeric; end if;
    if item->>'goods_value' is null then missing:=true; else goods:=goods+(item->>'goods_value')::numeric; end if;
    all_actual:=all_actual and item->>'mode'='actual';
  end loop;
  for item in select value from jsonb_each(extras) loop extra:=extra+(item->>'amount')::numeric; all_actual:=all_actual and item->>'mode'='actual'; end loop;
  if changed then cost_state:='detail_changed'; elsif missing then cost_state:='missing';
  elsif coalesce(c.reviewed,false) and all_actual then cost_state:='actual'; end if;
  -- Shopee completion alone never means money was released. Explicit release evidence is required.
  if f.released_amount is not null and (f.settlement_status='released' or f.released_at is not null) then income:=f.released_amount; income_state:='released';
  elsif f.escrow_amount is not null then income:=f.escrow_amount; income_state:='escrow'; end if;
  if coalesce(nullif(f.currency,''),o.currency,'MYR')<>coalesce(nullif(o.currency,''),'MYR') then income:=null; income_state:='currency_mismatch'; end if;
  lifecycle:=upper(o.current_status) ~ '(CANCEL|RETURN|REFUND)' or upper(o.payment_status) ~ '(REFUND|VOID)';
  if income is not null and not missing and not changed and not lifecycle then profit:=round(income-material-extra,2); end if;
  select coalesce(jsonb_agg(distinct value->>'category') filter(where value->>'category' is not null),'[]'::jsonb),
    coalesce(jsonb_agg(distinct value->>'sku'),'[]'::jsonb) into categories,skus from jsonb_array_elements(lines);
  return jsonb_build_object('order_id',o.id,'order_sn',o.order_sn,'provider',o.provider,'buyer',o.buyer_username,'status',o.current_status,
    'placed_at',coalesce(o.placed_at,o.created_at),'currency',coalesce(nullif(o.currency,''),'MYR'),'buyer_paid',f.buyer_paid,'goods_value',goods,
    'nett',income,'income_state',income_state,'released_at',f.released_at,'enriched_at',f.last_enriched_at,
    'escrow_amount',f.escrow_amount,'released_amount',f.released_amount,'commission_fee',f.commission_fee,'service_fee',f.service_fee,
    'transaction_fee',f.transaction_fee,'other_fees',f.other_fees,'shipping_fee',f.shipping_fee,'settlement_status',f.settlement_status,
    'material_total',case when missing then null else material end,'extra_total',extra,'cost_total',case when missing then null else material+extra end,
    'profit',profit,'margin',case when goods>0 then round(profit/goods*100,2) end,
    'profit_state',case when lifecycle then 'lifecycle_review' when profit is null then 'incomplete' when cost_state='actual' and income_state='released' then 'actual' else 'estimated' end,
    'cost_state',cost_state,'detail_changed',changed,'categories',categories,'skus',skus,
    'cost_version',coalesce(c.version,0),'settings_version',rate_version,'material_lines',lines,'extra_costs',extras,
    'reviewed',coalesce(c.reviewed,false),'work_minutes',c.work_minutes,'profit_per_hour',case when c.work_minutes>0 then round(profit/c.work_minutes*60,2) end,
    'note',coalesce(c.note,''),'cost_updated_at',c.updated_at);
end $$;

create function public.finance_material_settings() returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('version',version,'rates',rates,'sku_costs',sku_costs,'effective_at',effective_at) from finance.material_cost_versions order by effective_at desc limit 1;
$$;

create function public.finance_material_settings_save(p_expected_version bigint,p_rates jsonb,p_sku_costs jsonb,p_actor text) returns jsonb
language plpgsql set search_path='' as $$
declare prev finance.material_cost_versions%rowtype; k text; v jsonb; n numeric; next_row finance.material_cost_versions%rowtype;
begin
  if p_actor is distinct from 'admin1' then raise exception 'Forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finance_material_settings',0));
  select * into prev from finance.material_cost_versions order by effective_at desc limit 1;
  if p_expected_version is distinct from prev.version then raise exception 'Setting sudah berubah. Refresh sebelum simpan.'; end if;
  if jsonb_typeof(p_rates) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_rates))<>4 then raise exception 'Empat kategori modal diperlukan'; end if;
  foreach k in array array['topper','edible','wafer','acrylic'] loop
    n:=finance.cost_number(p_rates->k); if n>100 then raise exception 'Peratus mestilah 0–100'; end if;
  end loop;
  if jsonb_typeof(p_sku_costs) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_sku_costs))>3000 then raise exception 'Senarai SKU tidak sah'; end if;
  for k,v in select key,value from jsonb_each(p_sku_costs) loop
    if k<>lower(trim(k)) or length(k)=0 or length(k)>200 or jsonb_typeof(v)<>'object' or coalesce(v->>'category','') not in ('topper','edible','wafer','acrylic') then raise exception 'SKU atau kategori tidak sah'; end if;
    perform finance.cost_number(v->'unit_cost');
  end loop;
  insert into finance.material_cost_versions(effective_at,rates,sku_costs,actor) values(clock_timestamp(),p_rates,p_sku_costs,p_actor) returning * into next_row;
  insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data)
  values(p_actor,'save_material_settings','material_cost_version',next_row.version::text,to_jsonb(prev),to_jsonb(next_row));
  return public.finance_material_settings();
end $$;

create function public.finance_order_profit_detail(p_order_id uuid) returns jsonb language plpgsql set search_path='' as $$
begin perform finance.capture_order_cost_snapshot(p_order_id); return finance.order_profit_row(p_order_id); end $$;

create function public.finance_order_costs_save(p_order_id uuid,p_expected_version integer,p_lines jsonb,p_extras jsonb,p_work_minutes jsonb,p_reviewed boolean,p_note text,p_actor text) returns jsonb
language plpgsql set search_path='' as $$
declare prev finance.marketplace_order_costs%rowtype; current_basis jsonb; source jsonb; item jsonb; v jsonb; k text; line jsonb; amount numeric;
  new_lines jsonb:='[]'; new_extras jsonb:='{}'; all_actual boolean:=true; est jsonb;
begin
  if p_actor is distinct from 'admin1' then raise exception 'Forbidden'; end if;
  -- Serialize with capture and concurrent editors for this one order.
  perform 1 from public.marketplace_orders where id=p_order_id for update;
  if not found then raise exception 'Order tidak dijumpai'; end if;
  select * into prev from finance.marketplace_order_costs where order_id=p_order_id for update;
  if p_expected_version is distinct from coalesce(prev.version,0) then raise exception 'Kos order sudah berubah. Buka semula sebelum simpan.'; end if;
  current_basis:=finance.order_material_basis(p_order_id);
  est:=finance.order_material_estimate(p_order_id,prev.settings_version);
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)<>jsonb_array_length(est->'lines') or jsonb_array_length(p_lines)=0 then raise exception 'Semua item order mesti mempunyai kos'; end if;
  for source in select value from jsonb_array_elements(est->'lines') loop
    select value into item from jsonb_array_elements(p_lines) where value->>'line_no'=source->>'line_no';
    if (select count(*) from jsonb_array_elements(p_lines) where value->>'line_no'=source->>'line_no')<>1 then raise exception 'Item kos tiada atau berulang'; end if;
    if coalesce(item->>'mode','') not in ('actual','estimated') then raise exception 'Status kos bahan tidak sah'; end if;
    amount:=finance.cost_number(item->'amount',true);
    if coalesce(item->>'category','') not in ('','topper','edible','wafer','acrylic') then raise exception 'Kategori kos tidak sah'; end if;
    all_actual:=all_actual and amount is not null and item->>'mode'='actual';
    -- Server-owned quantities and prices; client can only edit cost/category, never order facts.
    line:=source||jsonb_build_object('amount',amount,'mode',item->>'mode','category',nullif(item->>'category',''),'basis','manual');
    new_lines:=new_lines||jsonb_build_array(line);
  end loop;
  if jsonb_typeof(p_extras) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_extras))<>7 then raise exception 'Semua jenis kos tambahan diperlukan'; end if;
  foreach k in array array['packaging','wastage','reprint','labor','shipping','ads','affiliate'] loop
    v:=p_extras->k; amount:=finance.cost_number(v->'amount');
    if coalesce(v->>'mode','') not in ('actual','estimated','allocated') then raise exception 'Status kos tambahan tidak sah'; end if;
    all_actual:=all_actual and v->>'mode'='actual';
    new_extras:=new_extras||jsonb_build_object(k,jsonb_build_object('amount',amount,'mode',v->>'mode'));
  end loop;
  if coalesce(p_reviewed,false) and not all_actual then raise exception 'Kos sebenar diperlukan sebelum sahkan semua kos'; end if;
  if length(coalesce(p_note,''))>2000 then raise exception 'Catatan maksimum 2000 aksara'; end if;
  insert into finance.marketplace_order_costs(order_id,version,settings_version,source_signature,material_lines,extra_costs,work_minutes,reviewed,note,actor)
  values(p_order_id,coalesce(prev.version,0)+1,coalesce(prev.settings_version,(est->>'settings_version')::bigint),current_basis->>'signature',new_lines,new_extras,
    finance.cost_number(p_work_minutes,true),coalesce(p_reviewed,false),coalesce(p_note,''),p_actor)
  on conflict(order_id) do update set version=excluded.version,source_signature=excluded.source_signature,material_lines=excluded.material_lines,
    extra_costs=excluded.extra_costs,work_minutes=excluded.work_minutes,reviewed=excluded.reviewed,note=excluded.note,actor=excluded.actor,updated_at=clock_timestamp();
  insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data) values(p_actor,'save_order_costs','marketplace_order_costs',p_order_id::text,
    case when prev.order_id is not null then to_jsonb(prev) end,(select to_jsonb(c) from finance.marketplace_order_costs c where order_id=p_order_id));
  return finance.order_profit_row(p_order_id);
end $$;

create function public.finance_order_profit_summaries(p_order_ids uuid[]) returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(finance.order_profit_row(id)),'[]'::jsonb) from (select distinct unnest(p_order_ids[1:100]) id) ids
  where exists(select 1 from public.marketplace_orders o where o.id=ids.id and coalesce(o.metadata->>'dashboard_excluded','false')<>'true');
$$;

create function public.finance_order_profit_list(p_filter jsonb default '{}') returns jsonb language plpgsql stable set search_path='' as $$
declare d1 date:=coalesce((p_filter->>'from')::date,date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date);
  d2 date:=coalesce((p_filter->>'to')::date,(now() at time zone 'Asia/Kuala_Lumpur')::date); result jsonb;
  lim integer:=greatest(1,least(coalesce((p_filter->>'limit')::integer,50),100)); off integer:=greatest(0,coalesce((p_filter->>'offset')::integer,0));
begin
  if d2<d1 or d2-d1>366 then raise exception 'Julat tarikh maksimum 367 hari'; end if;
  with candidates as materialized (
    select o.id from public.marketplace_orders o where coalesce(o.placed_at,o.created_at)>=d1::timestamp at time zone 'Asia/Kuala_Lumpur'
    and coalesce(o.placed_at,o.created_at)<(d2+1)::timestamp at time zone 'Asia/Kuala_Lumpur'
    and coalesce(o.metadata->>'dashboard_excluded','false')<>'true' and coalesce(nullif(o.currency,''),'MYR')=coalesce(nullif(p_filter->>'currency',''),'MYR')
    and (coalesce(p_filter->>'status','active')='all' or (coalesce(p_filter->>'status','active')='active' and upper(o.current_status) !~ '(CANCEL|UNPAID|RETURN|REFUND)') or o.current_status=p_filter->>'status')
    and (coalesce(p_filter->>'query','')='' or o.order_sn ilike '%'||(p_filter->>'query')||'%' or o.buyer_username ilike '%'||(p_filter->>'query')||'%' or exists(
      select 1 from public.marketplace_order_items i where i.order_id=o.id and i.is_current and (i.title ilike '%'||(p_filter->>'query')||'%' or i.item_sku ilike '%'||(p_filter->>'query')||'%' or i.variation_sku ilike '%'||(p_filter->>'query')||'%')))
  ), calculated as materialized (select finance.order_profit_row(id) r from candidates), filtered as materialized (
    select r from calculated where (coalesce(p_filter->>'category','')='' or r->'categories' ? (p_filter->>'category'))
    and (coalesce(p_filter->>'state','')='' or r->>'profit_state'=p_filter->>'state' or (p_filter->>'state'='loss' and (r->>'profit')::numeric<0))
  ), page as (
    select r from filtered order by
      case when p_filter->>'sort'='profit_asc' then (r->>'profit')::numeric end asc nulls last,
      case when p_filter->>'sort'='margin_asc' then (r->>'margin')::numeric end asc nulls last,
      (r->>'placed_at')::timestamptz desc,r->>'order_id' limit lim offset off
  ) select jsonb_build_object('rows',(select coalesce(jsonb_agg(r),'[]'::jsonb) from page),'total',count(*),'currency',coalesce(nullif(p_filter->>'currency',''),'MYR'),
    'summary',jsonb_build_object('orders',count(*),'released_nett',coalesce(sum((r->>'nett')::numeric) filter(where r->>'income_state'='released'),0),
      'escrow_nett',coalesce(sum((r->>'nett')::numeric) filter(where r->>'income_state'='escrow'),0),
      'actual_profit',coalesce(sum((r->>'profit')::numeric) filter(where r->>'profit_state'='actual'),0),
      'estimated_profit',coalesce(sum((r->>'profit')::numeric) filter(where r->>'profit_state'='estimated'),0),
      'actual_orders',count(*) filter(where r->>'profit_state'='actual'),'estimated_orders',count(*) filter(where r->>'profit_state'='estimated'),
      'incomplete_orders',count(*) filter(where r->>'profit_state' in ('incomplete','lifecycle_review')),
      'loss_orders',count(*) filter(where (r->>'profit')::numeric<0),'low_margin_orders',count(*) filter(where (r->>'margin')::numeric<20))) into result from filtered;
  return result;
end $$;

-- All access goes through the existing owner-authenticated finance-admin gateway.
revoke all on function finance.cost_number(jsonb,boolean),finance.material_category(text,text),finance.order_material_basis(uuid),finance.order_material_estimate(uuid,bigint),finance.empty_order_extras(),finance.capture_order_cost_snapshot(uuid),finance.capture_order_cost_after_item(),finance.order_profit_row(uuid) from public,anon,authenticated;
grant execute on function finance.cost_number(jsonb,boolean),finance.material_category(text,text),finance.order_material_basis(uuid),finance.order_material_estimate(uuid,bigint),finance.empty_order_extras(),finance.capture_order_cost_snapshot(uuid),finance.order_profit_row(uuid) to service_role;
revoke all on function public.finance_material_settings(),public.finance_material_settings_save(bigint,jsonb,jsonb,text),public.finance_order_profit_detail(uuid),public.finance_order_costs_save(uuid,integer,jsonb,jsonb,jsonb,boolean,text,text),public.finance_order_profit_summaries(uuid[]),public.finance_order_profit_list(jsonb) from public,anon,authenticated;
grant execute on function public.finance_material_settings(),public.finance_material_settings_save(bigint,jsonb,jsonb,text),public.finance_order_profit_detail(uuid),public.finance_order_costs_save(uuid,integer,jsonb,jsonb,jsonb,boolean,text,text),public.finance_order_profit_summaries(uuid[]),public.finance_order_profit_list(jsonb) to service_role;
notify pgrst,'reload schema';

