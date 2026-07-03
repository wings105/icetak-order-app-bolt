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
