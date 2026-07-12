create table if not exists public.whatsapp_template_blueprints (
  name text primary key,
  label text not null,
  category text not null default 'UTILITY',
  language text not null default 'ms',
  body_text text not null,
  param_order text[] not null default '{}',
  event_type text,
  notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.whatsapp_notification_rules add column if not exists available_fields text[] not null default '{}';
alter table public.whatsapp_notification_rules add column if not exists sort_order int not null default 100;
alter table public.whatsapp_notification_rules add column if not exists updated_at timestamptz not null default now();
alter table public.whatsapp_notification_rules add column if not exists freeform_enabled boolean not null default true;
alter table public.whatsapp_notification_rules add column if not exists template_enabled boolean not null default true;

alter table public.whatsapp_settings add column if not exists secret_value text;
alter table public.whatsapp_settings add column if not exists text_value text;
alter table public.whatsapp_settings add column if not exists is_secret boolean not null default false;
alter table public.whatsapp_settings add column if not exists updated_at timestamptz not null default now();

insert into public.whatsapp_settings(provider,key,text_value,secret_value,is_secret,updated_at,created_at)
values
  ('wasapflow','base_url','https://officialapi.wasapflow.com/bridge/v1',null,false,now(),now()),
  ('icetak','customer_app_base_url','https://icetak.bolt.host',null,false,now(),now()),
  ('wasapflow','default_language','ms',null,false,now(),now()),
  ('wasapflow','enabled','false',null,false,now(),now()),
  ('unified_inbox','unified_inbox_24h_url','https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/check-24h-window',null,false,now(),now()),
  ('unified_inbox','unified_inbox_24h_key',null,null,true,now(),now())
on conflict (key) do update set
  text_value = coalesce(public.whatsapp_settings.text_value, excluded.text_value),
  is_secret = excluded.is_secret,
  updated_at = now();

insert into public.whatsapp_template_blueprints(name,label,category,language,body_text,param_order,event_type,notes,updated_at,created_at)
values
('order_created_notice','Order Created','UTILITY','ms','Hi {{1}}, order iCetak anda telah diterima.\n\nOrder ID: {{2}}\nJumlah: {{3}}\nTarikh perlu: {{4}}\n\nSemak order:\n{{5}}',array['customer_name','order_id','order_total','date_need','order_link'],'order_created','Create manually in Meta/WasapFlow and wait for APPROVED.',now(),now()),
('payment_pending_notice','Payment Pending','UTILITY','ms','Hi {{1}}, bayaran untuk order {{2}} masih belum diterima.\n\nJumlah: {{3}}\n\nBayar / upload resit di sini:\n{{4}}',array['customer_name','order_id','order_total','payment_link'],'payment_pending','Payment reminder.',now(),now()),
('order_paid_notice','Payment Received','UTILITY','ms','Hi {{1}}, bayaran untuk order {{2}} telah diterima.\n\nJumlah: {{3}}\n\nOrder anda akan diproses mengikut tarikh diperlukan.',array['customer_name','order_id','order_total'],'payment_received','Payment matched or admin confirmed.',now(),now()),
('review_ready_notice','Design Review Ready','UTILITY','ms','Hi {{1}}, design untuk order {{2}} sudah ready untuk semakan.\n\nSila review di sini:\n{{3}}',array['customer_name','order_id','review_link'],'review_ready','Design review link available.',now(),now()),
('production_started_notice','Production Started','UTILITY','ms','Hi {{1}}, order {{2}} telah masuk proses production.\n\nKami akan update bila order siap / shipped.',array['customer_name','order_id'],'production_started','Production starts.',now(),now()),
('order_ready_pickup_notice','Ready For Pickup','UTILITY','ms','Hi {{1}}, order {{2}} sudah siap untuk pickup.\n\nLokasi pickup:\n{{3}}\n\nSila maklumkan sebelum datang.',array['customer_name','order_id','pickup_location'],'order_ready_pickup','Pickup orders.',now(),now()),
('order_shipped_notice','Order Shipped','UTILITY','ms','Hi {{1}}, order {{2}} telah dihantar melalui {{3}}.\n\nTracking No: {{4}}\n\nTrack parcel:\n{{5}}',array['customer_name','order_id','courier','tracking_number','tracking_link'],'order_shipped','Courier shipped.',now(),now()),
('order_delivered_notice','Order Delivered','UTILITY','ms','Hi {{1}}, parcel untuk order {{2}} telah delivered.\n\nTerima kasih kerana order dengan iCetak.',array['customer_name','order_id'],'order_delivered','Delivered.',now(),now()),
('order_cancelled_notice','Order Cancelled','UTILITY','ms','Hi {{1}}, order {{2}} telah dibatalkan.\n\nJika ada pertanyaan, boleh hubungi kami semula.',array['customer_name','order_id'],'order_cancelled','Cancelled.',now(),now()),
('magic_login_link','Magic Login Link','UTILITY','ms','Hi {{1}}, ini link login My Orders iCetak anda:\n\n{{2}}\n\nLink sah {{3}} minit dan hanya boleh digunakan sekali.',array['customer_name','magic_link','expiry_minutes'],'customer_login','Customer magic login link.',now(),now()),
('customer_login_otp','Customer Login OTP','AUTHENTICATION','ms','Kod login iCetak anda ialah {{1}}.\n\nKod sah selama {{2}} minit.',array['otp_code','expiry_minutes'],'customer_login_otp','Use AUTHENTICATION if Meta allows.',now(),now())
on conflict (name) do update set label=excluded.label, category=excluded.category, language=excluded.language, body_text=excluded.body_text, param_order=excluded.param_order, event_type=excluded.event_type, notes=excluded.notes, updated_at=now();
