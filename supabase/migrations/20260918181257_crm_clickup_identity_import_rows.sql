create table if not exists public.crm_clickup_import_rows (
  clickup_id text primary key,
  customer_master_id uuid references public.customer_master(id) on delete set null,
  order_sn text,
  shopee_user_id text,
  shopee_username text,
  phone text not null,
  raw_record jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_clickup_import_rows_user_id_idx on public.crm_clickup_import_rows(shopee_user_id) where shopee_user_id is not null;
create index if not exists crm_clickup_import_rows_username_phone_idx on public.crm_clickup_import_rows(lower(shopee_username), phone) where shopee_username is not null;
alter table public.crm_clickup_import_rows enable row level security;
revoke all on public.crm_clickup_import_rows from anon, authenticated;
