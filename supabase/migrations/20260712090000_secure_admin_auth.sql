alter table public.admin_users add column if not exists auth_user_id uuid;
alter table public.admin_users add column if not exists email text;
alter table public.admin_users add column if not exists last_login_at timestamptz;
alter table public.admin_users add column if not exists password_reset_requested_at timestamptz;
alter table public.admin_users add column if not exists whatsapp_phone text;
alter table public.admin_users add column if not exists whatsapp_otp_enabled boolean not null default false;

create unique index if not exists admin_users_auth_user_id_unique
  on public.admin_users(auth_user_id)
  where auth_user_id is not null;

create unique index if not exists admin_users_email_unique
  on public.admin_users(lower(email))
  where email is not null;

alter table public.admin_permissions add column if not exists auth_user_id uuid;
alter table public.admin_permissions add column if not exists email text;
create index if not exists admin_permissions_auth_user_id_idx
  on public.admin_permissions(auth_user_id);

create table if not exists public.admin_auth_audit (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  email text,
  event_type text not null,
  success boolean not null default false,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_whatsapp_otps (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  phone text not null,
  code_hash text not null,
  purpose text not null default 'login',
  status text not null default 'pending',
  attempts int not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_whatsapp_otps_lookup_idx
  on public.admin_whatsapp_otps(phone,status,expires_at);

alter table public.admin_auth_audit enable row level security;
alter table public.admin_whatsapp_otps enable row level security;
