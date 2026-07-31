create table if not exists public.product_order_profiles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  product_type text not null,
  configuration jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_order_profiles enable row level security;
drop policy if exists "Public reads active product order profiles" on public.product_order_profiles;
create policy "Public reads active product order profiles" on public.product_order_profiles
for select to anon, authenticated using (active = true);

alter table public.products
  add column if not exists order_profile_id uuid references public.product_order_profiles(id) on delete set null,
  add column if not exists is_orderable boolean not null default false;

alter table public.order_items
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists product_variant_id uuid references public.product_variants(id) on delete set null,
  add column if not exists catalog_slug text,
  add column if not exists catalog_clickup_task_id text,
  add column if not exists wording_mode text,
  add column if not exists customization jsonb not null default '{}'::jsonb,
  add column if not exists product_snapshot jsonb not null default '{}'::jsonb;

create index if not exists products_order_profile_idx on public.products(order_profile_id,is_orderable,status);
create index if not exists order_items_product_id_idx on public.order_items(product_id);
create index if not exists order_items_catalog_slug_idx on public.order_items(catalog_slug);

insert into public.product_order_profiles(code,name,product_type,configuration,active) values
('topper_custom_name','Custom Name Cake Topper','printed',
 jsonb_build_object(
  'default_price',10,'requires_size',false,'default_wording_mode','happy_birthday',
  'wording_options',jsonb_build_array(
   jsonb_build_object('code','happy_birthday','label','Happy Birthday','fixed_text','Happy Birthday','requires_text',false,'review_required',false),
   jsonb_build_object('code','custom_name','label','Custom Name','placeholder','Contoh: Happy Birthday Aiman 6','requires_text',true,'review_required',true)
  )
 ),true),
('edible_ready_design','Edible Image Ready Design','edible',
 jsonb_build_object(
  'requires_size',true,'default_wording_mode','no_wording',
  'sizes',jsonb_build_array(
   jsonb_build_object('code','code_m_4','label','Code M (4 inches)','size','4 inches','price',6),
   jsonb_build_object('code','custom_a6','label','Custom A6 (small under 4 inches)','size','Custom A6','price',6),
   jsonb_build_object('code','code_a_5_5','label','Code A (5.5 inches)','size','5.5 inches','price',12),
   jsonb_build_object('code','custom_a5','label','Custom A5 (4.0–5.5 inches)','size','Custom A5','price',12),
   jsonb_build_object('code','code_g_7_5','label','Code G (7.5 inches)','size','7.5 inches','price',24),
   jsonb_build_object('code','custom_a4','label','Custom A4 (5.6–7.5 inches)','size','Custom A4','price',24)
  ),
  'wording_options',jsonb_build_array(
   jsonb_build_object('code','no_wording','label','No Wording','fixed_text','','requires_text',false,'review_required',false),
   jsonb_build_object('code','add_wording','label','Add Wording','placeholder','Contoh: Rashid Turns 15','requires_text',true,'review_required',true)
  )
 ),true)
on conflict(code) do update set name=excluded.name,product_type=excluded.product_type,configuration=excluded.configuration,active=true,updated_at=now();

create or replace function public.icetak_assign_product_order_profile()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_category text; v_code text; v_profile uuid;
begin
  if coalesce(new.is_basic,false) then return new; end if;
  select name into v_category from public.product_categories where id=new.category_id;
  v_code:=case
    when lower(coalesce(v_category,'')) like '%custom name%' and lower(coalesce(v_category,'')) like '%topper%' then 'topper_custom_name'
    when lower(coalesce(v_category,'')) like '%edible%' then 'edible_ready_design'
    else null end;
  if v_code is null then new.order_profile_id:=null; new.is_orderable:=false;
  else select id into v_profile from public.product_order_profiles where code=v_code and active=true;
    new.order_profile_id:=v_profile; new.is_orderable:=v_profile is not null;
  end if;
  return new;
end $$;

drop trigger if exists products_assign_order_profile on public.products;
create trigger products_assign_order_profile before insert or update of category_id,is_basic on public.products
for each row execute function public.icetak_assign_product_order_profile();
update public.products p set category_id=p.category_id where p.is_basic=false;

create or replace function public.icetak_catalog_product_config(p_slug text)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select jsonb_build_object(
 'product',jsonb_build_object('id',p.id,'slug',p.slug,'name',p.display_name,'source_title',coalesce(p.source_title,p.name),'description',coalesce(p.description,''),'image_url',coalesce(p.main_image_url,''),'parent_sku',coalesce(p.parent_sku,''),'clickup_task_id',coalesce(p.clickup_task_id,''),'product_type',pr.product_type,'is_orderable',p.is_orderable),
 'profile',jsonb_build_object('id',pr.id,'code',pr.code,'name',pr.name,'product_type',pr.product_type,'configuration',pr.configuration),
 'variants',coalesce((select jsonb_agg(jsonb_build_object('id',pv.id,'name',pv.name,'sku',pv.sku,'price',pv.price,'size',pv.size,'style',pv.style,'active',pv.active,'metadata',pv.metadata) order by pv.created_at) from public.product_variants pv where pv.product_id=p.id and pv.active=true),'[]'::jsonb)
)
from public.products p join public.product_order_profiles pr on pr.id=p.order_profile_id and pr.active=true
where p.slug=p_slug and p.is_published=true and p.status='active' and p.is_orderable=true limit 1;
$$;
revoke all on function public.icetak_catalog_product_config(text) from public;
grant execute on function public.icetak_catalog_product_config(text) to anon,authenticated,service_role;

create or replace function public.icetak_validate_catalog_selection(p_slug text,p_wording_mode text,p_custom_text text default '',p_size_code text default '')
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare p public.products%rowtype; pr public.product_order_profiles%rowtype; wording_option jsonb; size_option jsonb;
 normalized_text text:=trim(coalesce(p_custom_text,'')); normalized_mode text:=trim(coalesce(p_wording_mode,'')); normalized_size text:=trim(coalesce(p_size_code,''));
 resolved_text text; resolved_size text:=''; resolved_price numeric; needs_review boolean:=false;
begin
 select * into p from public.products where slug=p_slug and is_published=true and status='active' and is_orderable=true;
 if p.id is null then raise exception 'catalog_product_not_orderable'; end if;
 select * into pr from public.product_order_profiles where id=p.order_profile_id and active=true;
 if pr.id is null then raise exception 'catalog_order_profile_missing'; end if;
 if normalized_mode='' then normalized_mode:=coalesce(pr.configuration->>'default_wording_mode',''); end if;
 select value into wording_option from jsonb_array_elements(coalesce(pr.configuration->'wording_options','[]'::jsonb)) where value->>'code'=normalized_mode limit 1;
 if wording_option is null then raise exception 'invalid_wording_option'; end if;
 if coalesce((wording_option->>'requires_text')::boolean,false) and normalized_text='' then raise exception 'custom_wording_required'; end if;
 resolved_text:=case when coalesce((wording_option->>'requires_text')::boolean,false) then normalized_text else coalesce(wording_option->>'fixed_text','') end;
 needs_review:=coalesce((wording_option->>'review_required')::boolean,false);
 if coalesce((pr.configuration->>'requires_size')::boolean,false) then
  if normalized_size='' then raise exception 'product_size_required'; end if;
  select value into size_option from jsonb_array_elements(coalesce(pr.configuration->'sizes','[]'::jsonb)) where value->>'code'=normalized_size limit 1;
  if size_option is null then raise exception 'invalid_product_size'; end if;
  resolved_size:=coalesce(size_option->>'size',size_option->>'label',normalized_size); resolved_price:=nullif(size_option->>'price','')::numeric;
 else resolved_price:=nullif(pr.configuration->>'default_price','')::numeric; end if;
 if resolved_price is null then raise exception 'catalog_price_missing'; end if;
 return jsonb_build_object(
  'product_id',p.id,'catalog_slug',p.slug,'catalog_clickup_task_id',coalesce(p.clickup_task_id,''),'product_type',pr.product_type,'title',p.display_name,
  'wording_mode',normalized_mode,'wording_label',coalesce(wording_option->>'label',normalized_mode),'custom_text',resolved_text,'size_code',normalized_size,'size',resolved_size,
  'price',resolved_price,'review_required',needs_review,
  'customization',jsonb_build_object('wording_mode',normalized_mode,'wording_label',coalesce(wording_option->>'label',normalized_mode),'custom_text',resolved_text,'size_code',normalized_size,'size',resolved_size),
  'product_snapshot',jsonb_build_object('product_id',p.id,'slug',p.slug,'name',p.display_name,'source_title',coalesce(p.source_title,p.name),'parent_sku',coalesce(p.parent_sku,''),'image_url',coalesce(p.main_image_url,''),'catalog_clickup_task_id',coalesce(p.clickup_task_id,''),'unit_price',resolved_price)
 );
end $$;
revoke all on function public.icetak_validate_catalog_selection(text,text,text,text) from public;
grant execute on function public.icetak_validate_catalog_selection(text,text,text,text) to anon,authenticated,service_role;
