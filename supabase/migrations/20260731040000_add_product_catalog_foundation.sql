create extension if not exists pg_trgm;

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  product_kind text not null default 'catalog_design' check (product_kind in ('basic_service','catalog_design','ready_stock')),
  source text not null default 'manual',
  source_record_id text,
  clickup_task_id text unique,
  shopee_product_id text,
  parent_sku text,
  name text not null,
  display_name text not null,
  source_title text,
  description text,
  category_id uuid references public.product_categories(id) on delete set null,
  status text not null default 'active',
  main_image_url text,
  shopee_url text,
  has_dimension boolean not null default false,
  is_basic boolean not null default false,
  is_published boolean not null default false,
  is_indexable boolean not null default false,
  search_text text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source, source_record_id)
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  source text not null default 'manual',
  source_url text,
  storage_bucket text,
  storage_path text,
  public_url text,
  position integer not null default 0,
  alt_text text,
  created_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  sku text,
  price numeric(12,2),
  stock integer,
  size text,
  colour text,
  style text,
  source_variation_id text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, source_variation_id)
);

create table if not exists public.product_import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  file_name text,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','rolled_back')),
  row_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.product_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.product_import_batches(id) on delete cascade,
  row_no integer not null,
  source_product_id text,
  source_variation_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  import_status text not null default 'pending' check (import_status in ('pending','valid','imported','skipped','error')),
  error_message text,
  product_id uuid references public.products(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(batch_id, row_no)
);

create index if not exists products_published_category_idx on public.products (is_published, category_id, status);
create index if not exists products_parent_sku_idx on public.products (parent_sku);
create index if not exists products_shopee_product_id_idx on public.products (shopee_product_id);
create index if not exists products_source_updated_idx on public.products (source_updated_at desc);
create index if not exists products_search_trgm_idx on public.products using gin (search_text gin_trgm_ops);
create index if not exists products_display_name_trgm_idx on public.products using gin (display_name gin_trgm_ops);
create index if not exists product_images_product_position_idx on public.product_images (product_id, position);
create index if not exists product_variants_product_active_idx on public.product_variants (product_id, active);
create index if not exists product_import_rows_batch_status_idx on public.product_import_rows (batch_id, import_status);

alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_import_batches enable row level security;
alter table public.product_import_rows enable row level security;

drop policy if exists "Public reads active product categories" on public.product_categories;
create policy "Public reads active product categories" on public.product_categories for select to anon, authenticated using (active = true);

drop policy if exists "Public reads published products" on public.products;
create policy "Public reads published products" on public.products for select to anon, authenticated using (is_published = true and status = 'active');

drop policy if exists "Public reads images of published products" on public.product_images;
create policy "Public reads images of published products" on public.product_images for select to anon, authenticated using (exists (select 1 from public.products p where p.id = product_id and p.is_published = true and p.status = 'active'));

drop policy if exists "Public reads active variants of published products" on public.product_variants;
create policy "Public reads active variants of published products" on public.product_variants for select to anon, authenticated using (active = true and exists (select 1 from public.products p where p.id = product_id and p.is_published = true and p.status = 'active'));

insert into public.product_categories (name, slug, sort_order) values
 ('Custom Services','custom-services',10),
 ('Custom Name - Topper','custom-name-topper',20),
 ('Ready Stock - Topper','ready-stock-topper',30),
 ('Edible Image','edible-image',40),
 ('Acrylic Topper','acrylic-topper',50),
 ('Wafer Paper','wafer-paper',60)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order, active = true, updated_at = now();

insert into public.products (slug, product_kind, source, source_record_id, name, display_name, description, category_id, status, is_basic, is_published, is_indexable, search_text) values
 ('edible-image','basic_service','system','basic:edible','Edible Image','Edible Image','Cetakan edible custom untuk permukaan kek.',(select id from public.product_categories where slug='custom-services'),'active',true,true,true,'edible image icing sheet cetakan kek custom'),
 ('burn-away-combo','basic_service','system','basic:burnaway','Burn Away Combo','Burn Away Combo','Edible image bawah bersama wafer paper atas.',(select id from public.product_categories where slug='custom-services'),'active',true,true,true,'burn away combo edible wafer cake'),
 ('wafer-paper','basic_service','system','basic:wafer','Wafer Paper Only','Wafer Paper Only','Cetakan wafer paper untuk burn away cake.',(select id from public.product_categories where slug='custom-services'),'active',true,true,true,'wafer paper burn away cake custom'),
 ('cake-topper','basic_service','system','basic:printed','Cake Topper','Cake Topper','Cake topper bercetak dengan nama atau tema custom.',(select id from public.product_categories where slug='custom-services'),'active',true,true,true,'cake topper custom name printed topper'),
 ('mirror-gold-artpaper','basic_service','system','basic:mirror','Mirror Gold Artpaper','Mirror Gold Artpaper','Topper kertas premium mirror warna gold.',(select id from public.product_categories where slug='custom-services'),'active',true,true,true,'mirror gold artpaper premium cake topper'),
 ('acrylic-cake-topper','basic_service','system','basic:acrylic','Acrylic Cake Topper','Acrylic Cake Topper','Acrylic cake topper custom untuk pelbagai majlis.',(select id from public.product_categories where slug='custom-services'),'active',true,true,true,'acrylic cake topper custom wedding birthday')
on conflict (slug) do update set
 product_kind = excluded.product_kind,
 source = excluded.source,
 source_record_id = excluded.source_record_id,
 name = excluded.name,
 display_name = excluded.display_name,
 description = excluded.description,
 category_id = excluded.category_id,
 status = excluded.status,
 is_basic = excluded.is_basic,
 is_published = excluded.is_published,
 is_indexable = excluded.is_indexable,
 search_text = excluded.search_text,
 updated_at = now();
