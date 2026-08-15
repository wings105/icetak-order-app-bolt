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
