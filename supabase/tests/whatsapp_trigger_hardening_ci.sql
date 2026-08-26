\set ON_ERROR_STOP on

-- Reuse the base disposable schema + first-layer hardening scenarios.
\i supabase/tests/whatsapp_automation_hardening_ci.sql

-- Columns/functions referenced by the production event triggers but not needed by the base harness.
alter table public.orders
  add column if not exists pickup_ready_at timestamptz,
  add column if not exists pickup_collected_at timestamptz;

alter table public.notification_outbox
  add column if not exists confirm_token text,
  add column if not exists transaction_id text,
  add column if not exists amount numeric;

alter table public.notification_queue
  add column if not exists sent_at timestamptz,
  add column if not exists provider_message_id text;

create table public.pickup_notification_settings (
  singleton boolean primary key default true,
  auto_send_enabled boolean not null default false,
  delay_minutes integer not null default 10,
  provider_ready boolean not null default false,
  auto_send_activated_at timestamptz
);

create table public.tracking_system_settings (
  singleton boolean primary key default true,
  auto_send_enabled boolean not null default false,
  provider_ready boolean not null default false,
  auto_send_activated_at timestamptz
);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  recipient_phone text,
  recipient_name text,
  tracking_no text,
  courier text,
  cancelled_at timestamptz
);

create table public.shipment_tracking_state (
  shipment_id uuid primary key references public.shipments(id),
  send_status text,
  auto_send_enabled boolean not null default true,
  first_scan_at timestamptz,
  manual_cancelled_at timestamptz,
  auto_queue_id uuid,
  auto_queued_at timestamptz,
  auto_attempted_at timestamptz,
  provider_message_id text,
  send_method text,
  last_error text,
  updated_at timestamptz default now()
);

create or replace function public.icetak_refresh_shipment_tracking_state(p_shipment_id uuid)
returns void language plpgsql as $$ begin return; end $$;

create or replace function public.icetak_tracking_link(p_tracking_no text)
returns text language sql immutable as $$ select 'https://example.test/track/'||coalesce(p_tracking_no,'') $$;

create or replace function public.icetak_tracking_message(p_tracking_no text)
returns text language sql immutable as $$ select 'Tracking '||coalesce(p_tracking_no,'') $$;

create or replace function public.icetak_tracking_courier(p_tracking_no text,p_courier text)
returns text language sql immutable as $$ select coalesce(nullif(p_courier,''),'SPX') $$;

insert into public.pickup_notification_settings(singleton,auto_send_enabled,delay_minutes,provider_ready,auto_send_activated_at)
values(true,true,10,true,now()-interval '1 day');

insert into public.tracking_system_settings(singleton,auto_send_enabled,provider_ready,auto_send_activated_at)
values(true,true,true,now()-interval '1 day');

create or replace function public.icetak_enqueue_auto_pickup_ready(
  p_order_id uuid,
  p_ready_at timestamptz default null
)
returns uuid
language sql
as $$ select null::uuid $$;

insert into public.whatsapp_notification_rules(
  event_type,label,enabled,prefer_template_when_closed,freeform_text,
  template_name,template_language,template_params,freeform_enabled,template_enabled
) values
  ('payment_received','Payment Received',true,true,'Paid {order_id}','order_paid_notice','ms','[]',true,true)
on conflict(event_type) do update set enabled=true;

insert into public.whatsapp_templates(name,language,status,category)
values ('order_paid_notice','ms','APPROVED','UTILITY');

\i supabase/migrations/20260815083200_whatsapp_event_trigger_hardening.sql

insert into public.whatsapp_notification_rules(
  event_type,label,enabled,prefer_template_when_closed,freeform_text,
  template_name,template_language,template_params,freeform_enabled,template_enabled
) values
  ('order_ready_pickup_auto','Auto Ready Pickup',true,true,'Ready {order_id}','order_ready_pickup_notice','ms','[]',true,true),
  ('shipment_auto_tracking','Auto Tracking',true,true,'Track {order_id}','tracking_update','ms','[]',true,true)
on conflict(event_type) do update set enabled=true;

\i supabase/migrations/20260826113000_whatsapp_per_order_optout_auto_guard.sql

-- The follow-up migration must also remain activation-neutral.
do $$
begin
  -- The base harness turns this ON only for disposable behavioral tests. The trigger
  -- migration itself must not contain any statement that changes it; CI's activation
  -- guard separately scans the migration source for that class of mistake.
  if not exists(select 1 from public.whatsapp_settings where key='enabled') then
    raise exception 'master WhatsApp setting disappeared during trigger migration';
  end if;
end $$;

-- Regression 1: pending/unpaid -> paid must enqueue payment_received exactly once.
do $$
declare
  c uuid;
  o uuid;
  n integer;
begin
  update public.whatsapp_settings set text_value='true' where key='enabled';
  insert into public.customers(phone) values('60155555555') returning id into c;
  insert into public.orders(
    customer_id,status,admin_status,fulfillment_stage,payment_status,payment,
    whatsapp_opt_in,delivery_phone,public_token,order_no,order_id
  ) values(
    c,'Confirmed','Confirmed','confirmed','pending','unpaid',true,
    '60155555555','tok_transition','IC-TRANSITION','IC-TRANSITION'
  ) returning id into o;

  if public.icetak_payment_state_is_paid('pending','unpaid') then
    raise exception 'payment helper classified unpaid as paid';
  end if;

  update public.orders set payment_status='paid',payment='paid' where id=o;

  select count(*) into n
  from public.notification_queue
  where order_id=o and event_type='payment_received' and status='pending';

  if n<>1 then
    raise exception 'unpaid->paid should enqueue exactly one payment_received, found %',n;
  end if;
end $$;

-- Regression 2: master customer lifecycle OFF must not kill independent tracking/pickup jobs.
do $$
declare
  c uuid;
  o uuid;
  generic_id uuid:=gen_random_uuid();
  tracking_id uuid:=gen_random_uuid();
  pickup_id uuid:=gen_random_uuid();
  generic_status text;
  tracking_status text;
  pickup_status text;
begin
  update public.whatsapp_settings set text_value='true' where key='enabled';
  insert into public.customers(phone) values('60166666666') returning id into c;
  insert into public.orders(
    customer_id,status,admin_status,fulfillment_stage,payment_status,payment,
    whatsapp_opt_in,delivery_phone,public_token,order_no,order_id
  ) values(
    c,'Confirmed','Confirmed','confirmed','pending','unpaid',true,
    '60166666666','tok_global','IC-GLOBAL','IC-GLOBAL'
  ) returning id into o;

  insert into public.notification_queue(
    id,event_type,channel,order_id,customer_id,phone,status,attempts,scheduled_at,created_at,idempotency_key
  ) values
    (generic_id,'order_created','whatsapp',o,c,'60166666666','pending',0,now()+interval '1 hour',now(),'ci:generic:'||o),
    (tracking_id,'shipment_auto_tracking','whatsapp',o,c,'60166666666','pending',0,now()+interval '1 hour',now(),'ci:tracking:'||o),
    (pickup_id,'order_ready_pickup_auto','whatsapp',o,c,'60166666666','pending',0,now()+interval '1 hour',now(),'ci:pickup:'||o);

  update public.whatsapp_settings set text_value='false' where key='enabled';

  select status into generic_status from public.notification_queue where id=generic_id;
  select status into tracking_status from public.notification_queue where id=tracking_id;
  select status into pickup_status from public.notification_queue where id=pickup_id;

  if generic_status<>'skipped' then
    raise exception 'master OFF did not skip generic lifecycle queue: %',generic_status;
  end if;
  if tracking_status<>'pending' then
    raise exception 'master OFF incorrectly changed tracking queue: %',tracking_status;
  end if;
  if pickup_status<>'pending' then
    raise exception 'master OFF incorrectly changed dedicated pickup queue: %',pickup_status;
  end if;

  update public.whatsapp_settings set text_value='true' where key='enabled';
end $$;

-- Regression 3: notification_outbox must never silently re-enable a customer/order opt-in.
do $$
declare
  c uuid;
  o uuid;
  ob uuid;
  opted boolean;
  ob_status text;
  queued integer;
begin
  update public.whatsapp_settings set text_value='true' where key='enabled';
  insert into public.customers(phone) values('60177777777') returning id into c;
  insert into public.orders(
    customer_id,status,admin_status,fulfillment_stage,payment_status,payment,
    whatsapp_opt_in,delivery_phone,public_token,order_no,order_id
  ) values(
    c,'Confirmed','Confirmed','confirmed','pending','unpaid',false,
    '60177777777','tok_optout','IC-OPTOUT','IC-OPTOUT'
  ) returning id into o;

  insert into public.notification_outbox(
    channel,event_type,status,order_id,order_token,confirm_token
  ) values(
    'whatsapp','order_created','pending','IC-OPTOUT','tok_optout','confirm_test'
  ) returning id into ob;

  select whatsapp_opt_in into opted from public.orders where id=o;
  select status into ob_status from public.notification_outbox where id=ob;
  select count(*) into queued from public.notification_queue where order_id=o;

  if opted then
    raise exception 'notification_outbox silently re-enabled whatsapp_opt_in';
  end if;
  if ob_status<>'skipped' then
    raise exception 'opted-out notification_outbox should be skipped, got %',ob_status;
  end if;
  if queued<>0 then
    raise exception 'opted-out order generated % notification queue row(s)',queued;
  end if;
end $$;

-- Regression 4: per-order OFF must block both dedicated auto pipelines and cancel races.
do $$
declare
  c uuid;
  o uuid;
  s uuid;
  pickup_q uuid;
  tracking_q uuid;
  pickup_status text;
  tracking_status text;
begin
  insert into public.customers(phone) values('60199999999') returning id into c;
  insert into public.orders(
    customer_id,status,admin_status,fulfillment_stage,payment_status,payment,
    whatsapp_opt_in,delivery_phone,delivery_name,delivery_method,delivery,
    pickup_ready_at,public_token,order_no,order_id
  ) values(
    c,'Ready for Pickup','Ready for Pickup','ready_for_pickup','paid','paid',false,
    '60199999999','Opted Out','Pickup','Pickup',now(),
    'tok_auto_optout','IC-AUTO-OPTOUT','IC-AUTO-OPTOUT'
  ) returning id into o;

  if public.icetak_enqueue_auto_pickup_ready(o,now()) is not null then
    raise exception 'opted-out order entered pickup auto queue';
  end if;

  insert into public.shipments(order_id,recipient_phone,recipient_name,tracking_no,courier)
  values(o,'60199999999','Opted Out','SPXTEST001','SPX') returning id into s;
  insert into public.shipment_tracking_state(shipment_id,send_status,auto_send_enabled,first_scan_at)
  values(s,'ready',true,now());
  if public.icetak_enqueue_auto_tracking(s,gen_random_uuid(),now()) is not null then
    raise exception 'opted-out order entered tracking auto queue';
  end if;

  update public.orders set whatsapp_opt_in=true where id=o;
  insert into public.notification_queue(event_type,channel,order_id,customer_id,phone,status,attempts,scheduled_at,created_at,idempotency_key)
  values('order_ready_pickup_auto','whatsapp',o,c,'60199999999','pending',0,now(),now(),'ci:auto-pickup-race:'||o)
  returning id into pickup_q;
  insert into public.notification_queue(event_type,channel,order_id,customer_id,phone,status,attempts,scheduled_at,created_at,idempotency_key)
  values('shipment_auto_tracking','whatsapp',o,c,'60199999999','processing',1,now(),now(),'ci:auto-tracking-race:'||o)
  returning id into tracking_q;

  update public.orders set whatsapp_opt_in=false where id=o;
  select status into pickup_status from public.notification_queue where event_type='order_ready_pickup_auto' and order_id=o;
  select status into tracking_status from public.notification_queue where id=tracking_q;
  if pickup_status<>'skipped' then raise exception 'pickup auto race survived order OFF: %',pickup_status; end if;
  if tracking_status<>'skipped' then raise exception 'tracking auto race survived order OFF: %',tracking_status; end if;
end $$;

-- Regression 5: opted-in orders still queue, while cancelled orders remain blocked.
do $$
declare
  c uuid;
  o uuid;
  s uuid;
begin
  insert into public.customers(phone) values('60190000000') returning id into c;
  insert into public.orders(
    customer_id,status,admin_status,fulfillment_stage,payment_status,payment,
    whatsapp_opt_in,delivery_phone,delivery_name,delivery_method,delivery,
    pickup_ready_at,public_token,order_no,order_id
  ) values(
    c,'Ready for Pickup','Ready for Pickup','ready_for_pickup','paid','paid',true,
    '60190000000','Positive Auto','Pickup','Pickup',now(),
    'tok_auto_positive','IC-AUTO-POSITIVE','IC-AUTO-POSITIVE'
  ) returning id into o;

  if public.icetak_enqueue_auto_pickup_ready(o,now()) is null then
    raise exception 'opted-in pickup order did not queue';
  end if;

  insert into public.shipments(order_id,recipient_phone,recipient_name,tracking_no,courier)
  values(o,'60190000000','Positive Auto','SPXTEST002','SPX') returning id into s;
  insert into public.shipment_tracking_state(shipment_id,send_status,auto_send_enabled,first_scan_at)
  values(s,'ready',true,now());
  if public.icetak_enqueue_auto_tracking(s,gen_random_uuid(),now()) is null then
    raise exception 'opted-in tracking order did not queue';
  end if;

  update public.orders set status='Cancelled',admin_status='Cancelled',fulfillment_stage='cancelled' where id=o;
  update public.shipment_tracking_state set send_status='ready' where shipment_id=s;
  if public.icetak_enqueue_auto_pickup_ready(o,now()) is not null then
    raise exception 'cancelled order entered pickup auto queue';
  end if;
  if public.icetak_enqueue_auto_tracking(s,gen_random_uuid(),now()) is not null then
    raise exception 'cancelled order entered tracking auto queue';
  end if;
end $$;

-- Positive control: opted-in unpaid order_created still queues order_created + delayed payment_pending.
do $$
declare
  c uuid;
  o uuid;
  created_count integer;
  pending_count integer;
begin
  update public.whatsapp_settings set text_value='true' where key='enabled';
  insert into public.customers(phone) values('60188888888') returning id into c;
  insert into public.orders(
    customer_id,status,admin_status,fulfillment_stage,payment_status,payment,
    whatsapp_opt_in,delivery_phone,public_token,order_no,order_id
  ) values(
    c,'Confirmed','Confirmed','confirmed','pending','unpaid',true,
    '60188888888','tok_positive','IC-POSITIVE','IC-POSITIVE'
  ) returning id into o;

  insert into public.notification_outbox(channel,event_type,status,order_id,order_token)
  values('whatsapp','order_created','pending','IC-POSITIVE','tok_positive');

  select count(*) into created_count
  from public.notification_queue where order_id=o and event_type='order_created';
  select count(*) into pending_count
  from public.notification_queue where order_id=o and event_type='payment_pending';

  if created_count<>1 then
    raise exception 'opted-in order_created expected 1 queue row, found %',created_count;
  end if;
  if pending_count<>1 then
    raise exception 'opted-in unpaid order expected delayed payment_pending, found %',pending_count;
  end if;
end $$;

select 'whatsapp event trigger hardening tests passed' as result;
