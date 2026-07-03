create table if not exists public.appdeploy_mirror (
  id uuid primary key default gen_random_uuid(),
  source_app_id text not null,
  source_table text not null,
  source_id text not null,
  payload jsonb not null,
  migrated_at timestamptz not null default now(),
  unique (source_app_id, source_table, source_id)
);

alter table public.appdeploy_mirror enable row level security;

create table if not exists public.appdeploy_migration_runs (
  id uuid primary key default gen_random_uuid(),
  source_app_id text not null,
  source_table text not null,
  received_count integer not null default 0,
  upserted_count integer not null default 0,
  error_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.appdeploy_migration_runs enable row level security;

create or replace function public.icetak_table_counts()
returns table(table_name text, row_count bigint, ok boolean, error text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query select 'appdeploy_mirror'::text, (select count(*) from public.appdeploy_mirror), true, null::text;
  return query select 'appdeploy_migration_runs'::text, (select count(*) from public.appdeploy_migration_runs), true, null::text;
  return query select 'customers'::text, (select count(*) from public.customers), true, null::text;
  return query select 'orders'::text, (select count(*) from public.orders), true, null::text;
  return query select 'order_items'::text, (select count(*) from public.order_items), true, null::text;
  return query select 'production_components'::text, (select count(*) from public.production_components), true, null::text;
  return query select 'payment_sessions'::text, (select count(*) from public.payment_sessions), true, null::text;
  return query select 'shipment_events'::text, (select count(*) from public.shipment_events), true, null::text;
end;
$$;

grant execute on function public.icetak_table_counts() to anon, authenticated;
