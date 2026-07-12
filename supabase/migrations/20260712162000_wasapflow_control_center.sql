alter table public.whatsapp_settings add column if not exists updated_by text;
alter table public.whatsapp_settings add column if not exists description text;
alter table public.whatsapp_outbox add column if not exists request_payload jsonb not null default '{}'::jsonb;
alter table public.whatsapp_outbox add column if not exists response_payload jsonb not null default '{}'::jsonb;
alter table public.whatsapp_outbox add column if not exists idempotency_key text;
alter table public.whatsapp_outbox add column if not exists updated_at timestamptz default now();
alter table public.whatsapp_outbox add column if not exists source text default 'manual';
alter table public.whatsapp_messages add column if not exists provider_message_id text;
alter table public.whatsapp_messages add column if not exists raw_payload jsonb default '{}'::jsonb;
alter table public.whatsapp_messages add column if not exists sent_at timestamptz;
alter table public.whatsapp_messages add column if not exists delivered_at timestamptz;
alter table public.whatsapp_messages add column if not exists read_at timestamptz;
alter table public.whatsapp_contacts add column if not exists name text;
alter table public.whatsapp_contacts add column if not exists source text;
alter table public.whatsapp_contacts add column if not exists unread_count int default 0;
alter table public.whatsapp_contacts add column if not exists last_message_at timestamptz;

create unique index if not exists whatsapp_settings_key_unique on public.whatsapp_settings(key);
create unique index if not exists whatsapp_outbox_idempotency_key_unique on public.whatsapp_outbox(idempotency_key) where idempotency_key is not null;
create index if not exists whatsapp_outbox_created_idx on public.whatsapp_outbox(created_at desc);
create index if not exists whatsapp_templates_status_idx on public.whatsapp_templates(status, language);
create index if not exists whatsapp_notification_rules_sort_idx on public.whatsapp_notification_rules(sort_order);

create table if not exists public.wasapflow_template_blueprints (
  name text primary key,
  language text not null default 'ms',
  category text not null default 'UTILITY',
  body text not null,
  params jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wasapflow_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event text,
  waba_id text,
  phone_number_id text,
  provider_message_id text,
  phone text,
  signature_valid boolean,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists wasapflow_webhook_events_created_idx on public.wasapflow_webhook_events(created_at desc);
create index if not exists wasapflow_webhook_events_message_idx on public.wasapflow_webhook_events(provider_message_id);

insert into public.whatsapp_settings(provider,key,value,text_value,is_secret,description)
values
('wasapflow','enabled','{}'::jsonb,'false',false,'Enable/disable native WasapFlow notifications'),
('wasapflow','default_language','{}'::jsonb,'ms',false,'Default WhatsApp template language'),
('wasapflow','webhook_url','{}'::jsonb,'https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/wasapflow-webhook',false,'Public webhook URL for WasapFlow dashboard'),
('wasapflow','auto_magic_login','{}'::jsonb,'true',false,'Auto send customer magic login link'),
('wasapflow','auto_order_created','{}'::jsonb,'true',false,'Auto order created notification'),
('wasapflow','auto_payment','{}'::jsonb,'true',false,'Auto payment notification'),
('wasapflow','auto_production','{}'::jsonb,'true',false,'Auto production/review notification'),
('wasapflow','auto_shipping','{}'::jsonb,'true',false,'Auto shipping/delivered notification')
on conflict(key) do nothing;

insert into public.wasapflow_template_blueprints(name,language,category,body,params)
values
('magic_login_link','ms','UTILITY','Hi {{1}}, ini link login My Orders iCetak anda:\n\n{{2}}\n\nLink sah 15 minit dan sekali guna.','["customer_name","login_link"]'::jsonb),
('order_created_notice','ms','UTILITY','Hi {{1}}, order iCetak anda telah direkodkan.\n\nOrder ID: {{2}}\nJumlah: {{3}}\n\nSemak order:\n{{4}}','["customer_name","order_no","amount","order_link"]'::jsonb),
('order_paid_notice','ms','UTILITY','Hi {{1}}, bayaran untuk order {{2}} telah diterima. Kami akan proses order anda.','["customer_name","order_no"]'::jsonb),
('production_approved_notice','ms','UTILITY','Hi {{1}}, order {{2}} telah masuk proses production.','["customer_name","order_no"]'::jsonb),
('order_confirmed_notice','ms','UTILITY','Hi {{1}}, order {{2}} telah disahkan. Terima kasih.','["customer_name","order_no"]'::jsonb),
('payment_pending_notice','ms','UTILITY','Hi {{1}}, bayaran order {{2}} masih pending. Jumlah: {{3}}. Link: {{4}}','["customer_name","order_no","amount","payment_link"]'::jsonb),
('review_ready_notice','ms','UTILITY','Hi {{1}}, design order {{2}} sudah ready untuk review. Link: {{3}}','["customer_name","order_no","review_link"]'::jsonb),
('order_shipped_notice','ms','UTILITY','Hi {{1}}, order {{2}} telah dipos. Tracking: {{3}}','["customer_name","order_no","tracking_link"]'::jsonb),
('order_delivered_notice','ms','UTILITY','Hi {{1}}, order {{2}} telah delivered. Terima kasih order dengan iCetak.','["customer_name","order_no"]'::jsonb)
on conflict(name) do update set body=excluded.body, params=excluded.params, updated_at=now();

update public.whatsapp_notification_rules set
  template_name = case event_type
    when 'customer_login' then 'magic_login_link'
    when 'magic_login' then 'magic_login_link'
    when 'order_created' then 'order_created_notice'
    when 'payment_received' then 'order_paid_notice'
    when 'payment_pending' then 'payment_pending_notice'
    when 'review_ready' then 'review_ready_notice'
    when 'order_shipped' then 'order_shipped_notice'
    when 'order_delivered' then 'order_delivered_notice'
    else template_name end,
  template_language = coalesce(template_language,'ms'),
  enabled = coalesce(enabled,true)
where event_type in ('customer_login','magic_login','order_created','payment_received','payment_pending','review_ready','order_shipped','order_delivered');

create or replace view public.wasapflow_control_status as
select
  (select count(*) from public.whatsapp_templates) as template_count,
  (select count(*) from public.whatsapp_notification_rules) as rule_count,
  (select count(*) from public.whatsapp_outbox) as outbox_count,
  (select count(*) from public.whatsapp_contacts where window_expires_at > now()) as open_window_count,
  jsonb_object_agg(key, jsonb_build_object(
    'configured', case when is_secret then coalesce(secret_value,'') <> '' else coalesce(text_value,'') <> '' end,
    'is_secret', is_secret,
    'value', case when is_secret then null else text_value end,
    'updated_at', updated_at
  )) as settings
from public.whatsapp_settings;
