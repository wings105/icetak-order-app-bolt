\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $$ begin
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;

create schema if not exists auth;
create schema if not exists net;

create or replace function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
create or replace function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$ select 1::bigint $$;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  phone text
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  status text,
  admin_status text,
  fulfillment_stage text,
  payment_status text,
  payment text,
  whatsapp_opt_in boolean not null default true,
  delivery_phone text,
  delivery_name text,
  date_need date,
  production_approved boolean default false,
  total numeric default 0,
  delivery_method text,
  delivery text,
  public_token text,
  order_no text,
  order_id text
);

create table public.whatsapp_settings (
  key text primary key,
  text_value text,
  secret_value text
);

create table public.whatsapp_notification_rules (
  id uuid primary key default gen_random_uuid(),
  event_type text unique not null,
  label text,
  enabled boolean default false,
  prefer_template_when_closed boolean default true,
  freeform_text text,
  template_name text,
  template_language text default 'ms',
  template_params jsonb default '[]'::jsonb,
  sort_order integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  trigger_status text,
  notes text,
  available_fields jsonb,
  freeform_enabled boolean default true,
  template_enabled boolean default true
);

create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  name text,
  language text,
  status text,
  category text
);

create table public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  event_type text,
  channel text,
  order_id uuid references public.orders(id),
  customer_id uuid references public.customers(id),
  phone text,
  payload jsonb default '{}'::jsonb,
  status text default 'pending',
  attempts integer default 0,
  scheduled_at timestamptz default now(),
  created_at timestamptz default now(),
  idempotency_key text unique,
  processed_at timestamptz,
  locked_at timestamptz,
  decision_mode text,
  decision_reason text,
  last_error text
);

create table public.admin_order_notification_queue (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null,
  source_type text,
  source_key text,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  provider_message_id text,
  scheduled_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id,event_type)
);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  channel text,
  event_type text,
  status text default 'pending',
  order_id text,
  order_token text,
  error_code text,
  error_message text
);

create table public.production_components (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  clickup_task_id text
);

create table public.private_runtime_settings (
  setting_key text primary key,
  setting_value text
);

create or replace function public.icetak_admin_can_manage_whatsapp()
returns boolean language sql stable as $$ select true $$;

create or replace function public.icetak_normalize_phone(p_phone text)
returns text language sql immutable as $$ select regexp_replace(coalesce(p_phone,''),'\D','','g') $$;

create or replace function public.icetak_whatsapp_vars(p_order_id uuid, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql stable as $$
  select jsonb_build_object('order_db_id',p_order_id::text) || coalesce(p_extra,'{}'::jsonb)
$$;

create or replace function public.icetak_pickup_auto_provider_status()
returns jsonb language sql stable as $$ select '{"ready":true,"provider":"wasapflow"}'::jsonb $$;

create or replace function public.icetak_tracking_auto_provider_status()
returns jsonb language sql stable as $$ select '{"ready":true,"provider":"wasapflow"}'::jsonb $$;

-- Existing function placeholders are required because the hardening migration replaces them.
create or replace function public.icetak_kick_admin_order_notification(p_order_id uuid)
returns integer language sql as $$ select 0 $$;

insert into public.whatsapp_settings(key,text_value,secret_value) values
  ('enabled','false',null),
  ('partner_key',null,'test_partner'),
  ('waba_id','test_waba',null),
  ('dispatch_url','https://example.test/dispatch',null),
  ('dispatch_internal_key',null,'test_dispatch_key'),
  ('unified_inbox_24h_url','https://example.test/window',null);

insert into public.whatsapp_notification_rules(
  event_type,label,enabled,prefer_template_when_closed,freeform_text,
  template_name,template_language,template_params,freeform_enabled,template_enabled
) values
  ('order_created','Order Created',true,true,'Created {order_id}','order_created','ms','[]',true,true),
  ('payment_pending','Payment Pending',true,true,'Pending {order_id}','payment_pending','ms','[]',true,true),
  ('order_cancelled','Order Cancelled',true,true,'Cancelled {order_id}','order_cancelled_notice','ms','[]',true,false);

insert into public.whatsapp_templates(name,language,status,category) values
  ('order_created','ms','APPROVED','UTILITY'),
  ('payment_pending','ms','APPROVED','UTILITY'),
  ('order_cancelled_notice','ms','PENDING','UTILITY');

insert into public.private_runtime_settings(setting_key,setting_value)
values ('qrpay_ai_worker_token','test_token');

\i supabase/migrations/20260815081500_whatsapp_automation_safety_hardening.sql

-- Migration must never activate the master customer switch.
do $$
begin
  if coalesce((select text_value from public.whatsapp_settings where key='enabled'),'') <> 'false' then
    raise exception 'hardening migration activated whatsapp_settings.enabled';
  end if;
end $$;

-- Exact payment-state test: "unpaid" must never count as "paid".
do $$
declare
  c uuid;
  o uuid;
begin
  insert into public.customers(phone) values('60111111111') returning id into c;
  insert into public.orders(
    customer_id,status,admin_status,fulfillment_stage,payment_status,payment,
    whatsapp_opt_in,delivery_phone,public_token,order_no,order_id
  ) values(
    c,'Confirmed','Confirmed','confirmed','pending','unpaid',true,
    '60111111111','tok_unpaid','IC-UNPAID','IC-UNPAID'
  ) returning id into o;

  if public.icetak_order_is_paid(o) then
    raise exception 'unpaid order was incorrectly classified as paid';
  end if;

  update public.orders set payment_status='paid',payment='paid' where id=o;
  if not public.icetak_order_is_paid(o) then
    raise exception 'paid order was not classified as paid';
  end if;
end $$;

-- Enable only inside the disposable CI database so queue behavior can be tested.
update public.whatsapp_settings set text_value='true' where key='enabled';

do $$
declare
  c uuid;
  o uuid;
  q uuid;
  q_status text;
  cancel_q uuid;
  cancel_status text;
begin
  insert into public.customers(phone) values('60122222222') returning id into c;
  insert into public.orders(
    customer_id,status,admin_status,fulfillment_stage,payment_status,payment,
    whatsapp_opt_in,delivery_phone,public_token,order_no,order_id
  ) values(
    c,'Confirmed','Confirmed','confirmed','pending','unpaid',true,
    '60122222222','tok_cancel','IC-CANCEL','IC-CANCEL'
  ) returning id into o;

  q := public.icetak_enqueue_whatsapp_event('order_created',o,'{}'::jsonb,null,now());
  if q is null then raise exception 'valid lifecycle event did not enqueue'; end if;

  update public.orders set status='Cancelled',admin_status='Cancelled' where id=o;
  select status into q_status from public.notification_queue where id=q;
  if q_status <> 'cancelled' then
    raise exception 'cancelled order left stale customer queue status=%',q_status;
  end if;

  cancel_q := public.icetak_enqueue_whatsapp_event('order_cancelled',o,'{}'::jsonb,null,now());
  if cancel_q is null then raise exception 'valid order_cancelled event was blocked'; end if;
  select status into cancel_status from public.notification_queue where id=cancel_q;
  if cancel_status <> 'pending' then
    raise exception 'order_cancelled event should remain pending, got %',cancel_status;
  end if;

  if public.icetak_enqueue_whatsapp_event('order_created',o,'{}'::jsonb,'again',now()) is not null then
    raise exception 'cancelled order accepted a non-cancellation lifecycle event';
  end if;
end $$;

-- Payment-pending must disappear once the order is paid.
do $$
declare
  c uuid;
  o uuid;
  q uuid;
  s text;
begin
  insert into public.customers(phone) values('60133333333') returning id into c;
  insert into public.orders(
    customer_id,status,admin_status,fulfillment_stage,payment_status,payment,
    whatsapp_opt_in,delivery_phone,public_token,order_no,order_id
  ) values(
    c,'Confirmed','Confirmed','confirmed','pending','unpaid',true,
    '60133333333','tok_pay','IC-PAY','IC-PAY'
  ) returning id into o;

  q := public.icetak_enqueue_whatsapp_event('payment_pending',o,'{}'::jsonb,null,now());
  if q is null then raise exception 'unpaid order failed to enqueue payment_pending'; end if;
  update public.orders set payment_status='paid',payment='paid' where id=o;
  perform public.icetak_whatsapp_cancel_invalid_jobs();
  select status into s from public.notification_queue where id=q;
  if s <> 'skipped' then raise exception 'paid order payment_pending was not skipped: %',s; end if;
end $$;

-- Stale admin notification for a cancelled order must be cancelled generically.
do $$
declare
  c uuid;
  o uuid;
  q uuid;
  s text;
begin
  insert into public.customers(phone) values('60144444444') returning id into c;
  insert into public.orders(
    customer_id,status,admin_status,fulfillment_stage,payment_status,payment,
    whatsapp_opt_in,delivery_phone,public_token,order_no,order_id
  ) values(
    c,'Cancelled','Cancelled','cancelled','pending','unpaid',true,
    '60144444444','tok_admin','IC-ADMIN','IC-ADMIN'
  ) returning id into o;

  insert into public.admin_order_notification_queue(order_id,event_type,status)
  values(o,'auto_order_created','pending') returning id into q;
  perform public.icetak_whatsapp_cancel_invalid_jobs();
  select status into s from public.admin_order_notification_queue where id=q;
  if s <> 'cancelled' then raise exception 'stale cancelled admin queue remained %',s; end if;
end $$;

-- Readiness must expose the pending/disabled cancellation template as a blocker.
do $$
declare
  r jsonb;
begin
  r := public.icetak_whatsapp_auto_readiness();
  if coalesce((r->>'template_blocker_count')::int,0) < 1 then
    raise exception 'readiness failed to report cancellation template blocker: %',r;
  end if;
  if coalesce((r->>'activation_ready')::boolean,true) then
    raise exception 'activation_ready should be false while template blocker exists: %',r;
  end if;
end $$;

select 'whatsapp hardening SQL tests passed' as result;
