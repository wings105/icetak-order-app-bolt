-- Make the per-order WhatsApp switch authoritative for every automatic customer message.
-- This migration is activation-neutral: it does not enable any global, pickup or tracking switch.

create or replace function public.icetak_whatsapp_cancel_invalid_jobs()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cancelled_customer integer := 0;
  v_opted_out integer := 0;
  v_paid_pending integer := 0;
  v_cancelled_admin integer := 0;
  v_cancelled_outbox integer := 0;
  v_exhausted_customer integer := 0;
  v_exhausted_admin integer := 0;
  v_customer_automation text[] := array[
    'order_created','payment_pending','payment_received','production_started','review_ready',
    'order_ready_pickup','order_ready_pickup_auto','shipment_auto_tracking',
    'order_shipped','order_delivered','order_cancelled'
  ];
begin
  update public.notification_queue q
  set status='cancelled',
      processed_at=now(),
      locked_at=null,
      decision_mode='cancelled',
      decision_reason='order_cancelled_before_send',
      last_error=null
  from public.orders o
  where q.order_id=o.id
    and q.status in ('pending','processing')
    and q.event_type=any(v_customer_automation)
    and q.event_type<>'order_cancelled'
    and public.icetak_order_is_cancelled(o.id);
  get diagnostics v_cancelled_customer = row_count;

  update public.notification_queue q
  set status='skipped',
      processed_at=now(),
      locked_at=null,
      decision_mode='skipped',
      decision_reason='order_whatsapp_opted_out',
      last_error=null
  from public.orders o
  where q.order_id=o.id
    and q.status in ('pending','processing')
    and q.event_type=any(v_customer_automation)
    and coalesce(o.whatsapp_opt_in,false)=false;
  get diagnostics v_opted_out = row_count;

  update public.notification_queue q
  set status='skipped',
      processed_at=now(),
      locked_at=null,
      decision_mode='skipped',
      decision_reason='payment_already_received',
      last_error=null
  where q.status in ('pending','processing')
    and q.event_type='payment_pending'
    and q.order_id is not null
    and public.icetak_order_is_paid(q.order_id);
  get diagnostics v_paid_pending = row_count;

  update public.notification_queue
  set status='failed',
      processed_at=now(),
      locked_at=null,
      decision_reason=coalesce(decision_reason,'retry_limit_reached'),
      last_error=coalesce(last_error,'retry_limit_reached')
  where status in ('pending','processing')
    and coalesce(attempts,0)>=5;
  get diagnostics v_exhausted_customer = row_count;

  update public.admin_order_notification_queue q
  set status='cancelled',
      locked_at=null,
      last_error='order_cancelled_before_admin_notification',
      updated_at=now()
  where q.status in ('pending','retry','sending','dispatching')
    and public.icetak_order_is_cancelled(q.order_id);
  get diagnostics v_cancelled_admin = row_count;

  update public.admin_order_notification_queue
  set status='failed',
      locked_at=null,
      last_error=coalesce(last_error,'retry_limit_reached'),
      updated_at=now()
  where status in ('pending','retry','sending','dispatching')
    and coalesce(attempts,0)>=5;
  get diagnostics v_exhausted_admin = row_count;

  update public.notification_outbox n
  set status='skipped',
      error_code='order_cancelled',
      error_message='Order cancelled before WhatsApp enqueue'
  where coalesce(n.channel,'whatsapp')='whatsapp'
    and coalesce(n.status,'pending')='pending'
    and coalesce(n.event_type,'')<>'order_cancelled'
    and exists (
      select 1
      from public.orders o
      where public.icetak_order_is_cancelled(o.id)
        and (n.order_token=o.public_token or n.order_id=o.order_no or n.order_id=o.order_id)
    );
  get diagnostics v_cancelled_outbox = row_count;

  return jsonb_build_object(
    'cancelled_customer',v_cancelled_customer,
    'opted_out_customer',v_opted_out,
    'paid_payment_pending',v_paid_pending,
    'retry_exhausted_customer',v_exhausted_customer,
    'cancelled_admin',v_cancelled_admin,
    'retry_exhausted_admin',v_exhausted_admin,
    'cancelled_notification_outbox',v_cancelled_outbox
  );
end;
$function$;

create or replace function public.icetak_whatsapp_cancel_on_order_cancelled()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old_cancelled boolean;
  v_new_cancelled boolean;
begin
  v_old_cancelled := lower(concat_ws(' ',old.status,old.admin_status,old.fulfillment_stage)) like '%cancel%';
  v_new_cancelled := lower(concat_ws(' ',new.status,new.admin_status,new.fulfillment_stage)) like '%cancel%';
  if v_old_cancelled or not v_new_cancelled then return new; end if;

  update public.notification_queue
  set status='cancelled',processed_at=now(),locked_at=null,
      decision_mode='cancelled',decision_reason='order_cancelled_before_send',last_error=null
  where order_id=new.id
    and status in ('pending','processing')
    and event_type=any(array[
      'order_created','payment_pending','payment_received','production_started','review_ready',
      'order_ready_pickup','order_ready_pickup_auto','shipment_auto_tracking',
      'order_shipped','order_delivered'
    ]::text[]);

  update public.admin_order_notification_queue
  set status='cancelled',locked_at=null,last_error='order_cancelled_before_admin_notification',updated_at=now()
  where order_id=new.id and status in ('pending','retry','sending','dispatching');

  update public.notification_outbox
  set status='skipped',error_code='order_cancelled',error_message='Order cancelled before WhatsApp enqueue'
  where coalesce(channel,'whatsapp')='whatsapp'
    and coalesce(status,'pending')='pending'
    and coalesce(event_type,'')<>'order_cancelled'
    and (order_token=new.public_token or order_id=new.order_no or order_id=new.order_id);
  return new;
end;
$function$;

create or replace function public.icetak_whatsapp_cancel_on_order_opt_out()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if coalesce(new.whatsapp_opt_in,false)
     or coalesce(old.whatsapp_opt_in,false)=coalesce(new.whatsapp_opt_in,false) then
    return new;
  end if;

  update public.notification_queue
  set status='skipped',processed_at=now(),locked_at=null,
      decision_mode='skipped',decision_reason='order_whatsapp_opted_out',last_error=null
  where order_id=new.id
    and status in ('pending','processing')
    and event_type=any(array[
      'order_created','payment_pending','payment_received','production_started','review_ready',
      'order_ready_pickup','order_ready_pickup_auto','shipment_auto_tracking',
      'order_shipped','order_delivered','order_cancelled'
    ]::text[]);
  return new;
end;
$function$;

drop trigger if exists zz_icetak_whatsapp_cancel_on_order_opt_out_trg on public.orders;
create trigger zz_icetak_whatsapp_cancel_on_order_opt_out_trg
after update of whatsapp_opt_in on public.orders
for each row execute function public.icetak_whatsapp_cancel_on_order_opt_out();

create or replace function public.icetak_enqueue_auto_pickup_ready(
  p_order_id uuid,
  p_ready_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  o public.orders%rowtype;
  c public.customers%rowtype;
  cfg public.pickup_notification_settings%rowtype;
  r public.whatsapp_notification_rules%rowtype;
  v_status jsonb;
  v_ready timestamptz;
  v_phone text;
  v_vars jsonb;
  v_idem text;
  v_qid uuid;
begin
  select * into cfg from public.pickup_notification_settings where singleton=true;
  if cfg.auto_send_enabled is not true or cfg.auto_send_activated_at is null then return null; end if;
  v_status:=public.icetak_pickup_auto_provider_status();
  if not coalesce((v_status->>'ready')::boolean,false) then return null; end if;

  select * into o from public.orders where id=p_order_id;
  if o.id is null or coalesce(o.whatsapp_opt_in,false)=false then return null; end if;
  if public.icetak_order_is_cancelled(o.id) then return null; end if;

  v_ready:=coalesce(p_ready_at,o.pickup_ready_at);
  if v_ready is null or v_ready < cfg.auto_send_activated_at then return null; end if;
  if lower(coalesce(o.delivery_method,o.delivery,'')) not like '%pickup%' then return null; end if;
  if o.pickup_ready_at is null or o.pickup_collected_at is not null then return null; end if;

  select * into r from public.whatsapp_notification_rules where event_type='order_ready_pickup_auto' limit 1;
  if r.id is null or not coalesce(r.enabled,false) then return null; end if;
  select * into c from public.customers where id=o.customer_id;
  v_phone:=public.icetak_normalize_phone(coalesce(c.phone,o.delivery_phone));
  if v_phone !~ '^601[0-9]{8,9}$' then return null; end if;

  v_vars:=public.icetak_whatsapp_vars(o.id,'{}'::jsonb)
    || jsonb_build_object('order_db_id',o.id::text,'pickup_ready_at',v_ready);
  v_idem:='order_ready_pickup_auto:'||o.id::text;
  insert into public.notification_queue(
    event_type,channel,order_id,customer_id,phone,payload,status,attempts,
    scheduled_at,created_at,idempotency_key
  ) values(
    'order_ready_pickup_auto','whatsapp',o.id,o.customer_id,v_phone,
    jsonb_build_object(
      'event_type','order_ready_pickup_auto','phone',v_phone,'mode','auto','vars',v_vars,
      'source','pickup_auto','order_db_id',o.id,'pickup_ready_at',v_ready,
      'template_name','order_ready_pickup_notice','template_language','ms',
      'template_params',jsonb_build_array('customer_name','order_id','pickup_location'),
      'idempotency_key',v_idem
    ),
    'pending',0,greatest(now(),v_ready+make_interval(mins=>coalesce(cfg.delay_minutes,10))),now(),v_idem
  ) on conflict(idempotency_key) do nothing returning id into v_qid;
  return v_qid;
end;
$function$;

create or replace function public.icetak_enqueue_auto_tracking(
  p_shipment_id uuid,
  p_event_id uuid,
  p_event_created_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  s public.shipments%rowtype;
  st public.shipment_tracking_state%rowtype;
  cfg public.tracking_system_settings%rowtype;
  o public.orders%rowtype;
  v_phone text;
  v_link text;
  v_message text;
  v_idem text;
  v_qid uuid;
  v_existing_status text;
begin
  select * into cfg from public.tracking_system_settings where singleton=true;
  if cfg.auto_send_enabled is not true or cfg.provider_ready is not true or cfg.auto_send_activated_at is null then return null; end if;
  if coalesce(p_event_created_at,now()) < cfg.auto_send_activated_at then return null; end if;

  perform public.icetak_refresh_shipment_tracking_state(p_shipment_id);
  select * into s from public.shipments where id=p_shipment_id;
  if s.id is null or s.cancelled_at is not null then return null; end if;
  select * into o from public.orders where id=s.order_id;
  if o.id is null or coalesce(o.whatsapp_opt_in,false)=false then return null; end if;
  if public.icetak_order_is_cancelled(o.id) then return null; end if;

  select * into st from public.shipment_tracking_state where shipment_id=p_shipment_id for update;
  if st.shipment_id is null or st.send_status<>'ready' then return null; end if;
  if st.auto_send_enabled is not true then return null; end if;
  if st.first_scan_at is null or st.first_scan_at<cfg.auto_send_activated_at then return null; end if;

  v_phone:=public.icetak_normalize_phone(s.recipient_phone);
  v_link:=public.icetak_tracking_link(s.tracking_no);
  if v_phone !~ '^601[0-9]{8,9}$' or nullif(v_link,'') is null then return null; end if;
  v_message:=public.icetak_tracking_message(s.tracking_no);
  v_idem:='shipment_auto_tracking:'||s.id::text;

  select id,status into v_qid,v_existing_status
  from public.notification_queue where idempotency_key=v_idem limit 1 for update;
  if v_qid is not null then
    if v_existing_status='sent' then return v_qid; end if;
    if v_existing_status in ('cancelled','failed') then
      update public.notification_queue
      set status='pending',attempts=0,scheduled_at=now(),sent_at=null,processed_at=null,locked_at=null,
          provider_message_id=null,decision_mode=null,decision_reason=null,last_error=null
      where id=v_qid;
      update public.shipment_tracking_state
      set send_status='queued',auto_queue_id=v_qid,auto_queued_at=now(),auto_attempted_at=null,
          provider_message_id=null,send_method='wasapflow_api',last_error=null,updated_at=now()
      where shipment_id=s.id and auto_send_enabled=true;
      return v_qid;
    end if;
    return null;
  end if;

  insert into public.notification_queue(
    event_type,channel,order_id,customer_id,phone,payload,status,attempts,
    scheduled_at,created_at,idempotency_key
  ) values(
    'shipment_auto_tracking','whatsapp',s.order_id,o.customer_id,v_phone,
    jsonb_build_object(
      'event_type','shipment_auto_tracking','phone',v_phone,'mode','auto','text',v_message,
      'template_name','tracking_update','template_language','ms',
      'template_params',jsonb_build_array('customer_name','courier','tracking_number','tracking_link'),
      'vars',jsonb_build_object(
        'customer_name',coalesce(nullif(btrim(s.recipient_name),''),'Customer'),
        'courier',upper(coalesce(public.icetak_tracking_courier(s.tracking_no,s.courier),'Courier')),
        'tracking_number',s.tracking_no,'tracking_link',v_link,'shipment_id',s.id::text
      ),
      'source','tracking_auto','idempotency_key',v_idem,'shipment_id',s.id,'shipment_event_id',p_event_id
    ),
    'pending',0,now(),now(),v_idem
  ) on conflict(idempotency_key) do nothing returning id into v_qid;

  if v_qid is not null then
    update public.shipment_tracking_state
    set send_status='queued',auto_queue_id=v_qid,auto_queued_at=now(),auto_attempted_at=null,
        provider_message_id=null,send_method='wasapflow_api',last_error=null,updated_at=now()
    where shipment_id=s.id and send_status='ready' and auto_send_enabled=true;
  end if;
  return v_qid;
end;
$function$;

-- Internal trigger/worker functions must not become public RPC endpoints.
revoke all on function public.icetak_whatsapp_cancel_invalid_jobs() from public,anon,authenticated;
revoke all on function public.icetak_whatsapp_cancel_on_order_cancelled() from public,anon,authenticated;
revoke all on function public.icetak_whatsapp_cancel_on_order_opt_out() from public,anon,authenticated;
revoke all on function public.icetak_enqueue_auto_pickup_ready(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.icetak_enqueue_auto_tracking(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.icetak_whatsapp_cancel_invalid_jobs() to service_role;
grant execute on function public.icetak_enqueue_auto_pickup_ready(uuid,timestamptz) to service_role;
grant execute on function public.icetak_enqueue_auto_tracking(uuid,uuid,timestamptz) to service_role;

-- Clean up anything queued before this guard was installed. Sent history is retained.
select public.icetak_whatsapp_cancel_invalid_jobs();
