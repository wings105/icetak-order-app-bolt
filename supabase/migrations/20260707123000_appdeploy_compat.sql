-- iCetak AppDeploy compatibility migration
-- Source AppDeploy app: 8ab71fa9c33743fd70, source version: 1783423858209
-- Purpose: keep Supabase table/field names compatible with the original AppDeploy backend SDK collections.

create extension if not exists pgcrypto;

alter table public.customers add column if not exists public_token text;
update public.customers set public_token = 'c_' || replace(id::text,'-','') where public_token is null;
create unique index if not exists customers_public_token_idx on public.customers(public_token);
create unique index if not exists customers_phone_idx on public.customers(phone);

alter table public.orders add column if not exists order_id text;
alter table public.orders add column if not exists customer_token text;
alter table public.orders add column if not exists payment text;
alter table public.orders add column if not exists delivery text;
alter table public.orders add column if not exists tracking text;
alter table public.orders add column if not exists courier text;
alter table public.orders add column if not exists tracking_link text;
alter table public.orders add column if not exists connote_url text;
alter table public.orders add column if not exists shipment_status text;
alter table public.orders add column if not exists shipment_status_group text;
alter table public.orders add column if not exists shipment_updated_at timestamptz;
alter table public.orders add column if not exists source text;
alter table public.orders add column if not exists external_order_id text;
alter table public.orders add column if not exists created_by text;
alter table public.orders add column if not exists customer_confirmed_at timestamptz;
update public.orders o
set order_id = coalesce(o.order_id, o.order_no),
    payment = coalesce(o.payment, case lower(coalesce(o.payment_status,'')) when 'paid' then 'Paid' when 'cash_counter' then 'Cash at Counter' else 'Unpaid' end),
    delivery = coalesce(o.delivery, o.delivery_method),
    customer_token = coalesce(o.customer_token, c.public_token)
from public.customers c
where o.customer_id = c.id;
create unique index if not exists orders_order_id_idx on public.orders(order_id);
create unique index if not exists orders_public_token_idx on public.orders(public_token);
create index if not exists orders_customer_token_idx on public.orders(customer_token);
create index if not exists orders_external_order_id_idx on public.orders(external_order_id) where external_order_id is not null and external_order_id <> '';

alter table public.order_items add column if not exists order_token text;
alter table public.order_items add column if not exists k text;
alter table public.order_items add column if not exists custom_text text;
update public.order_items i
set order_token = coalesce(i.order_token, o.public_token),
    k = coalesce(i.k, i.product_type),
    custom_text = coalesce(i.custom_text, i.wording)
from public.orders o
where i.order_id = o.id;
create index if not exists order_items_order_token_idx on public.order_items(order_token);

alter table public.production_components add column if not exists order_token text;
alter table public.production_components add column if not exists item_id text;
update public.production_components c
set order_token = coalesce(c.order_token, o.public_token),
    item_id = coalesce(c.item_id, c.order_item_id::text)
from public.orders o
where c.order_id = o.id;
create index if not exists production_components_order_token_idx on public.production_components(order_token);
create index if not exists production_components_item_id_idx on public.production_components(item_id);

alter table public.payment_sessions add column if not exists order_token text;
alter table public.payment_sessions add column if not exists receipt_mime text;
update public.payment_sessions ps set order_token = coalesce(ps.order_token, o.public_token) from public.orders o where ps.order_id = o.id;
create index if not exists payment_sessions_order_token_idx on public.payment_sessions(order_token);
create unique index if not exists payment_sessions_transaction_id_idx on public.payment_sessions(transaction_id) where transaction_id is not null and transaction_id <> '';

alter table public.integration_settings alter column provider set default 'appdeploy';
alter table public.integration_settings add column if not exists key_hash text;
alter table public.integration_settings add column if not exists url text;
alter table public.integration_settings add column if not exists text_value text;
create unique index if not exists integration_settings_key_idx on public.integration_settings(key);

alter table public.integration_outbox add column if not exists channel text;
alter table public.integration_outbox add column if not exists http_status integer;
alter table public.integration_outbox add column if not exists error text;
create index if not exists integration_outbox_event_status_idx on public.integration_outbox(event_type,status);

alter table public.unmatched_payment_transactions add column if not exists raw jsonb default '{}'::jsonb;
update public.unmatched_payment_transactions set raw = coalesce(raw, raw_payload, '{}'::jsonb);

alter table public.admin_permissions add column if not exists permissions text[];
alter table public.admin_permissions alter column permission drop not null;
alter table public.admin_permissions alter column permission set default '';
create unique index if not exists admin_permissions_username_idx on public.admin_permissions(username);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  channel text default 'whatsapp',
  phone text,
  customer_name text,
  order_id text,
  order_token text,
  confirm_token text,
  transaction_id text,
  amount numeric,
  message_mode text,
  template_name text,
  can_send_freeform boolean,
  status text default 'pending',
  source text,
  external_order_id text,
  total numeric,
  date_need text,
  delivery text,
  created_by text,
  wf_message_id text,
  error_code text,
  error_message text,
  payload jsonb default '{}'::jsonb,
  created_at numeric default (extract(epoch from now())*1000),
  sent_at numeric
);
create index if not exists notification_outbox_status_idx on public.notification_outbox(status,event_type);
create index if not exists notification_outbox_order_token_idx on public.notification_outbox(order_token);

create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  order_db_id text,
  order_id text,
  action text not null,
  actor text default 'system',
  payload jsonb default '{}'::jsonb,
  created_at numeric default (extract(epoch from now())*1000)
);
create index if not exists admin_audit_order_db_id_idx on public.admin_audit(order_db_id);
create index if not exists admin_audit_order_id_idx on public.admin_audit(order_id);

create table if not exists public.login_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  customer_token text not null,
  phone text,
  expires_at numeric not null,
  used_at numeric,
  created_at numeric default (extract(epoch from now())*1000)
);
create index if not exists login_tokens_customer_token_idx on public.login_tokens(customer_token);

create table if not exists public.entity_subscriptions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  connection_id text not null,
  created_at numeric default (extract(epoch from now())*1000),
  unique(entity_type, entity_id, connection_id)
);

-- Runtime functions are managed in Supabase. The live project has an updated icetak_create_order(payload jsonb)
-- and icetak_table_counts() matching this compatibility layer.
