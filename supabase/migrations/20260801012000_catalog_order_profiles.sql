create table if not exists public.product_order_profiles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  product_type text not null,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_order_profiles enable row level security;
drop policy if exists "Public reads active product order profiles" on public.product_order_profiles;
create policy "Public reads active product order profiles"
on public.product_order_profiles for select to anon, authenticated
using (active = true);

alter table public.products add column if not exists order_profile_id uuid references public.product_order_profiles(id) on delete set null;
alter table public.products add column if not exists base_price numeric(12,2);
create index if not exists products_order_profile_idx on public.products(order_profile_id, is_published, status);

alter table public.order_items add column if not exists product_id uuid references public.products(id) on delete set null;
alter table public.order_items add column if not exists product_variant_id uuid references public.product_variants(id) on delete set null;
alter table public.order_items add column if not exists catalog_slug text;
alter table public.order_items add column if not exists catalog_clickup_task_id text;
alter table public.order_items add column if not exists wording_mode text;
alter table public.order_items add column if not exists customization jsonb not null default '{}'::jsonb;
alter table public.order_items add column if not exists product_snapshot jsonb not null default '{}'::jsonb;
create index if not exists order_items_product_id_idx on public.order_items(product_id);
create index if not exists order_items_catalog_slug_idx on public.order_items(catalog_slug);

insert into public.product_order_profiles(code,name,product_type,config,active)
values
(
  'topper_custom_name',
  'Custom Name Topper',
  'printed',
  jsonb_build_object(
    'version',1,
    'default_process','Pre-order',
    'size_options',jsonb_build_array(jsonb_build_object('value','1 pc','label','1 pc','price',10)),
    'wording_options',jsonb_build_array(
      jsonb_build_object('value','happy_birthday','label','Happy Birthday','requires_text',false,'default_text','Happy Birthday','review_required',false),
      jsonb_build_object('value','custom_name','label','Custom Name','requires_text',true,'placeholder','Contoh: Happy Birthday Aiman 6','review_required',true)
    )
  ),
  true
),
(
  'edible_ready_design',
  'Edible Image Ready Design',
  'edible',
  jsonb_build_object(
    'version',1,
    'default_process','Pre-order',
    'size_options',jsonb_build_array(
      jsonb_build_object('value','3 inch','label','3 inch','price',6),
      jsonb_build_object('value','3.5 inch','label','3.5 inch','price',6),
      jsonb_build_object('value','4 inch','label','4 inch','price',6),
      jsonb_build_object('value','4.5 inch','label','4.5 inch','price',12),
      jsonb_build_object('value','5 inch','label','5 inch','price',12),
      jsonb_build_object('value','5.5 inch','label','5.5 inch','price',12),
      jsonb_build_object('value','6 inch','label','6 inch','price',24),
      jsonb_build_object('value','6.5 inch','label','6.5 inch','price',24),
      jsonb_build_object('value','7 inch','label','7 inch','price',24),
      jsonb_build_object('value','7.5 inch','label','7.5 inch','price',24),
      jsonb_build_object('value','A6','label','Custom A6','price',6),
      jsonb_build_object('value','A5','label','Custom A5','price',12),
      jsonb_build_object('value','A4','label','Custom A4','price',24)
    ),
    'wording_options',jsonb_build_array(
      jsonb_build_object('value','no_wording','label','No Wording','requires_text',false,'default_text','','review_required',false),
      jsonb_build_object('value','add_wording','label','Add Wording','requires_text',true,'placeholder','Contoh: Rashid Turns 15','review_required',true)
    )
  ),
  true
)
on conflict(code) do update set
  name=excluded.name,
  product_type=excluded.product_type,
  config=excluded.config,
  active=true,
  updated_at=now();

create or replace function public.icetak_assign_product_order_profile()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_category_slug text;
  v_text text;
  v_profile_code text;
begin
  select slug into v_category_slug from public.product_categories where id=new.category_id;
  v_text:=lower(concat_ws(' ',new.name,new.display_name,new.source_title,v_category_slug));
  if v_category_slug='custom-name-topper' or v_text like '%custom name%' or (v_text like '%cake topper%' and v_text not like '%edible%') then
    v_profile_code:='topper_custom_name';
    new.base_price:=coalesce(new.base_price,10);
  elsif v_category_slug='edible-image' or v_text like '%edible image%' or v_text like '%printing ei %' then
    v_profile_code:='edible_ready_design';
    new.base_price:=coalesce(new.base_price,6);
  else
    v_profile_code:=null;
  end if;
  if v_profile_code is not null then
    select id into new.order_profile_id from public.product_order_profiles where code=v_profile_code and active=true;
  end if;
  return new;
end;
$$;

drop trigger if exists products_assign_order_profile on public.products;
create trigger products_assign_order_profile
before insert or update of name,display_name,source_title,category_id
on public.products
for each row execute function public.icetak_assign_product_order_profile();

update public.products p set name=p.name,updated_at=now() where p.order_profile_id is null;

insert into public.product_categories(name,slug,sort_order,active)
values('Edible Image','edible-image',40,true)
on conflict(slug) do update set name=excluded.name,active=true,updated_at=now();

insert into public.products(
  slug,product_kind,source,source_record_id,clickup_task_id,name,display_name,source_title,
  category_id,status,is_basic,is_published,is_indexable,search_text,metadata,source_updated_at
)
values(
  'arsenal-2-edible-image-86cwqmm1d','catalog_design','clickup','86cwqmm1d','86cwqmm1d',
  'Printing EI Arsenal 2 Edible Image Print Cake Photo Icing Paper Birthday Sticker Kek Topper Sheet',
  'Arsenal 2 Edible Image',
  'Printing EI Arsenal 2 Edible Image Print Cake Photo Icing Paper Birthday Sticker Kek Topper Sheet',
  (select id from public.product_categories where slug='edible-image'),
  'active',false,true,false,
  'arsenal arsenal 2 edible image printing ei cake photo icing paper birthday sticker kek topper sheet',
  jsonb_build_object('clickup_url','https://app.clickup.com/t/86cwqmm1d','clickup_list_id','901604488980','imported_by','chatgpt_test'),
  to_timestamp(1742037150495/1000.0)
)
on conflict(clickup_task_id) do update set
  name=excluded.name,display_name=excluded.display_name,source_title=excluded.source_title,
  category_id=excluded.category_id,status='active',is_published=true,search_text=excluded.search_text,
  metadata=public.products.metadata||excluded.metadata,source_updated_at=excluded.source_updated_at,updated_at=now();
