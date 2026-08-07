alter table public.tracking_system_settings
  add column if not exists auto_send_activated_at timestamptz,
  add column if not exists auto_send_disabled_at timestamptz,
  add column if not exists provider_name text not null default 'wasapflow',
  add column if not exists template_name text not null default 'tracking_update',
  add column if not exists last_provider_check_at timestamptz,
  add column if not exists provider_error text;

alter table public.shipment_tracking_state
  add column if not exists auto_queue_id uuid,
  add column if not exists auto_queued_at timestamptz,
  add column if not exists auto_attempted_at timestamptz,
  add column if not exists provider_message_id text;

alter table public.shipment_tracking_state drop constraint if exists shipment_tracking_state_send_status_check;
alter table public.shipment_tracking_state add constraint shipment_tracking_state_send_status_check
check (send_status = any(array['not_ready','blocked','ready','queued','opened','sent','failed','cancelled']::text[]));

insert into public.whatsapp_notification_rules(
  event_type,label,enabled,prefer_template_when_closed,freeform_text,template_name,
  template_language,template_params,sort_order,trigger_status,notes,available_fields,
  freeform_enabled,template_enabled,updated_at
)
values(
  'shipment_auto_tracking','Auto Tracking First Scan',true,true,
  E'Hi,\nThis tracking number for your order\n\nTracking Number: {tracking_number}\nTrack here: {tracking_link}',
  'tracking_update','ms','["customer_name","courier","tracking_number","tracking_link"]'::jsonb,
  91,null,
  'Tracking-only automation controlled by tracking_system_settings.auto_send_enabled. No historical backfill. Exact short text inside 24-hour window; approved tracking_update template outside it.',
  array['customer_name','courier','tracking_number','tracking_link'],true,true,now()
)
on conflict (event_type) do update set
  label=excluded.label,enabled=true,prefer_template_when_closed=true,
  freeform_text=excluded.freeform_text,template_name=excluded.template_name,
  template_language=excluded.template_language,template_params=excluded.template_params,
  notes=excluded.notes,available_fields=excluded.available_fields,
  freeform_enabled=true,template_enabled=true,updated_at=now();

create or replace function public.icetak_tracking_auto_provider_status()
returns jsonb language plpgsql stable security definer set search_path=public
as $function$
declare
  v_partner boolean; v_waba boolean; v_dispatch_url boolean; v_dispatch_key boolean;
  v_template boolean; v_ready boolean;
begin
  select exists(select 1 from public.whatsapp_settings where key='partner_key' and nullif(secret_value,'') is not null) into v_partner;
  select exists(select 1 from public.whatsapp_settings where key='waba_id' and nullif(text_value,'') is not null) into v_waba;
  select exists(select 1 from public.whatsapp_settings where key='dispatch_url' and nullif(text_value,'') is not null) into v_dispatch_url;
  select exists(select 1 from public.whatsapp_settings where key='dispatch_internal_key' and nullif(secret_value,'') is not null) into v_dispatch_key;
  select exists(select 1 from public.whatsapp_templates where name='tracking_update' and language='ms' and upper(status)='APPROVED') into v_template;
  v_ready := v_partner and v_waba and v_dispatch_url and v_dispatch_key and v_template;
  return jsonb_build_object('ready',v_ready,'provider','wasapflow','template_name','tracking_update',
    'checks',jsonb_build_object('partner_key',v_partner,'waba_id',v_waba,'dispatcher',v_dispatch_url and v_dispatch_key,'approved_template',v_template));
end;
$function$;

create or replace function public.icetak_admin_set_tracking_auto_send(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public
as $function$
declare
  v_row public.tracking_system_settings%rowtype; v_status jsonb; v_enable boolean := coalesce(p_enabled,false);
begin
  if not public.icetak_admin_can_manage_shipping_messages() then raise exception 'ADMIN_REQUIRED'; end if;
  v_status := public.icetak_tracking_auto_provider_status();
  if v_enable and not coalesce((v_status->>'ready')::boolean,false) then raise exception 'TRACKING_PROVIDER_NOT_READY'; end if;

  update public.tracking_system_settings
  set auto_send_enabled=v_enable,
      provider_mode='external_provider',provider_name='wasapflow',template_name='tracking_update',
      provider_ready=coalesce((v_status->>'ready')::boolean,false),
      provider_error=case when coalesce((v_status->>'ready')::boolean,false) then null else 'Wasapflow credential, dispatcher or approved tracking template is incomplete' end,
      last_provider_check_at=now(),
      auto_send_activated_at=case when v_enable and not auto_send_enabled then now() else auto_send_activated_at end,
      auto_send_disabled_at=case when not v_enable then now() else auto_send_disabled_at end,
      updated_at=now(),updated_by=auth.uid()
  where singleton=true returning * into v_row;

  if not v_enable then
    update public.notification_queue
    set status='cancelled',processed_at=now(),locked_at=null,last_error='Auto Send Tracking switched OFF'
    where event_type='shipment_auto_tracking' and status in ('pending','processing');
  end if;

  return jsonb_build_object('auto_send_enabled',v_row.auto_send_enabled,'provider_mode',v_row.provider_mode,
    'provider_name',v_row.provider_name,'provider_ready',v_row.provider_ready,'template_name',v_row.template_name,
    'auto_send_activated_at',v_row.auto_send_activated_at,'updated_at',v_row.updated_at,'provider_status',v_status);
end;
$function$;

create or replace function public.icetak_enqueue_auto_tracking(p_shipment_id uuid,p_event_id uuid,p_event_created_at timestamptz default now())
returns uuid language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  s public.shipments%rowtype; st public.shipment_tracking_state%rowtype; cfg public.tracking_system_settings%rowtype;
  v_phone text; v_link text; v_message text; v_idem text; v_qid uuid;
begin
  select * into cfg from public.tracking_system_settings where singleton=true;
  if cfg.auto_send_enabled is not true or cfg.provider_ready is not true or cfg.auto_send_activated_at is null then return null; end if;
  if coalesce(p_event_created_at,now()) < cfg.auto_send_activated_at then return null; end if;
  perform public.icetak_refresh_shipment_tracking_state(p_shipment_id);
  select * into s from public.shipments where id=p_shipment_id;
  select * into st from public.shipment_tracking_state where shipment_id=p_shipment_id for update;
  if s.id is null or st.shipment_id is null or st.send_status <> 'ready' then return null; end if;
  v_phone := public.icetak_normalize_phone(s.recipient_phone);
  v_link := public.icetak_tracking_link(s.tracking_no);
  if v_phone !~ '^601[0-9]{8,9}$' or nullif(v_link,'') is null then return null; end if;
  v_message := public.icetak_tracking_message(s.tracking_no);
  v_idem := 'shipment_auto_tracking:' || s.id::text;

  insert into public.notification_queue(event_type,channel,order_id,customer_id,phone,payload,status,attempts,scheduled_at,created_at,idempotency_key)
  values('shipment_auto_tracking','whatsapp',s.order_id,(select customer_id from public.orders where id=s.order_id),v_phone,
    jsonb_build_object('event_type','shipment_auto_tracking','phone',v_phone,'mode','auto','text',v_message,
      'template_name','tracking_update','template_language','ms',
      'template_params',jsonb_build_array('customer_name','courier','tracking_number','tracking_link'),
      'vars',jsonb_build_object('customer_name',coalesce(nullif(btrim(s.recipient_name),''),'Customer'),
        'courier',upper(coalesce(public.icetak_tracking_courier(s.tracking_no,s.courier),'Courier')),
        'tracking_number',s.tracking_no,'tracking_link',v_link,'shipment_id',s.id::text),
      'source','tracking_auto','idempotency_key',v_idem,'shipment_id',s.id,'shipment_event_id',p_event_id),
    'pending',0,now(),now(),v_idem)
  on conflict(idempotency_key) do nothing returning id into v_qid;

  if v_qid is not null then
    update public.shipment_tracking_state
    set send_status='queued',auto_queue_id=v_qid,auto_queued_at=now(),auto_attempted_at=null,
        provider_message_id=null,send_method='wasapflow_api',last_error=null,updated_at=now()
    where shipment_id=s.id and send_status='ready';
  end if;
  return v_qid;
end;
$function$;

create or replace function public.icetak_shipment_auto_tracking_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
begin
  if new.shipment_id is not null and public.icetak_is_first_physical_scan(new.normalized_status,new.status_group,new.status) then
    perform public.icetak_enqueue_auto_tracking(new.shipment_id,new.id,new.created_at);
  end if;
  return new;
end;
$function$;

drop trigger if exists zz_trg_shipment_auto_tracking on public.shipment_events;
create trigger zz_trg_shipment_auto_tracking after insert or update of shipment_id,normalized_status,status_group,status,event_time
on public.shipment_events for each row execute function public.icetak_shipment_auto_tracking_trigger();

create or replace function public.icetak_shipping_notification_state_sync()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_shipment_id uuid;
begin
  if new.event_type not in ('shipment_checkout_confirmed','shipment_first_scan','shipment_auto_tracking') then return new; end if;
  v_shipment_id := nullif(new.payload->>'shipment_id','')::uuid;
  if v_shipment_id is null then return new; end if;
  insert into public.shipment_notification_state(shipment_id,updated_at) values(v_shipment_id,now()) on conflict(shipment_id) do nothing;

  if new.event_type='shipment_auto_tracking' then
    if new.status in ('pending','processing') then
      update public.shipment_tracking_state
      set send_status=case when send_status in ('cancelled','sent') then send_status else 'queued' end,
          auto_queue_id=new.id,auto_queued_at=coalesce(auto_queued_at,new.created_at,now()),
          auto_attempted_at=case when new.status='processing' then now() else auto_attempted_at end,
          last_error=null,updated_at=now()
      where shipment_id=v_shipment_id;
    elsif new.status='sent' then
      update public.shipment_tracking_state
      set send_status=case when send_status='cancelled' then 'cancelled' else 'sent' end,
          sent_at=case when send_status='cancelled' then sent_at else coalesce(new.sent_at,now()) end,
          sent_by=null,send_method=case when send_status='cancelled' then send_method else 'wasapflow_api' end,
          provider_message_id=coalesce(new.provider_message_id,provider_message_id),last_error=null,updated_at=now()
      where shipment_id=v_shipment_id;
      update public.shipment_notification_state set first_scan_sent_at=coalesce(first_scan_sent_at,new.sent_at,now()),last_error=null,updated_at=now()
      where shipment_id=v_shipment_id;
    elsif new.status='failed' then
      update public.shipment_tracking_state
      set send_status=case when send_status in ('cancelled','sent') then send_status else 'failed' end,last_error=new.last_error,updated_at=now()
      where shipment_id=v_shipment_id;
      update public.shipment_notification_state set last_error=new.last_error,updated_at=now() where shipment_id=v_shipment_id;
    elsif new.status='cancelled' then
      perform public.icetak_refresh_shipment_tracking_state(v_shipment_id);
      update public.shipment_tracking_state set auto_queue_id=null,auto_queued_at=null,
        last_error=case when send_status='cancelled' then last_error else new.last_error end,updated_at=now()
      where shipment_id=v_shipment_id;
    end if;
    return new;
  end if;

  if new.event_type='shipment_checkout_confirmed' then
    update public.shipment_notification_state set checkout_sent_at=case when new.status='sent' then coalesce(new.sent_at,now()) else checkout_sent_at end,
      last_error=case when new.status='failed' then new.last_error when new.status='sent' then null else last_error end,updated_at=now()
    where shipment_id=v_shipment_id;
  else
    update public.shipment_notification_state set first_scan_sent_at=case when new.status='sent' then coalesce(new.sent_at,now()) else first_scan_sent_at end,
      last_error=case when new.status='failed' then new.last_error when new.status='sent' then null else last_error end,updated_at=now()
    where shipment_id=v_shipment_id;
  end if;
  return new;
end;
$function$;

create or replace function public.icetak_admin_tracking_dashboard(p_search text default null,p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path=public
as $function$
declare v_result jsonb; v_search text := nullif(lower(btrim(coalesce(p_search,''))),''); v_limit integer := least(greatest(coalesce(p_limit,500),1),1000);
begin
  if not public.icetak_admin_can_manage_shipping_messages() then raise exception 'ADMIN_REQUIRED'; end if;
  select jsonb_build_object(
    'settings',jsonb_build_object('auto_send_enabled',cfg.auto_send_enabled,'provider_mode',cfg.provider_mode,
      'provider_name',cfg.provider_name,'provider_ready',cfg.provider_ready,'template_name',cfg.template_name,
      'auto_send_activated_at',cfg.auto_send_activated_at,'updated_at',cfg.updated_at,'provider_error',cfg.provider_error,
      'provider_status',public.icetak_tracking_auto_provider_status()),
    'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select s.id,s.order_id,s.reference,s.tracking_no,public.icetak_tracking_courier(s.tracking_no,s.courier) courier,
        public.icetak_tracking_link(s.tracking_no) tracking_link,s.status,s.normalized_status,s.provider,s.service_provider,
        s.recipient_phone,s.recipient_name,s.recipient_address_text,s.shipped_at,s.delivered_at,s.created_at,s.updated_at,
        st.first_scan_at,st.first_scan_status,coalesce(st.send_status,'not_ready') send_status,st.blocked_reason,
        st.manual_opened_at,st.sent_at,st.send_method,st.manual_cancelled_at,st.manual_cancel_reason,
        st.auto_queue_id,st.auto_queued_at,st.auto_attempted_at,st.provider_message_id,st.last_error,
        q.status auto_queue_status,q.attempts auto_attempts,q.scheduled_at auto_next_retry_at,
        public.icetak_tracking_message(s.tracking_no) message_body
      from public.shipments s left join public.shipment_tracking_state st on st.shipment_id=s.id
      left join public.notification_queue q on q.id=st.auto_queue_id
      where nullif(btrim(coalesce(s.tracking_no,'')),'') is not null
        and (v_search is null or lower(coalesce(s.tracking_no,'')) like '%'||v_search||'%'
          or lower(coalesce(s.recipient_phone,'')) like '%'||v_search||'%'
          or lower(coalesce(s.recipient_name,'')) like '%'||v_search||'%'
          or lower(coalesce(s.reference,'')) like '%'||v_search||'%'
          or lower(coalesce(s.status,'')) like '%'||v_search||'%')
      order by s.created_at desc limit v_limit) x),'[]'::jsonb)
  ) into v_result from public.tracking_system_settings cfg where cfg.singleton=true;
  return coalesce(v_result,jsonb_build_object('settings','{}'::jsonb,'rows','[]'::jsonb));
end;
$function$;

update public.tracking_system_settings
set provider_mode='external_provider',provider_name='wasapflow',template_name='tracking_update',
    provider_ready=coalesce((public.icetak_tracking_auto_provider_status()->>'ready')::boolean,false),
    provider_error=case when coalesce((public.icetak_tracking_auto_provider_status()->>'ready')::boolean,false) then null else 'Wasapflow credential, dispatcher or approved tracking template is incomplete' end,
    last_provider_check_at=now(),auto_send_enabled=false,updated_at=now()
where singleton=true;

grant execute on function public.icetak_tracking_auto_provider_status() to authenticated;
grant execute on function public.icetak_admin_set_tracking_auto_send(boolean) to authenticated;
grant execute on function public.icetak_admin_tracking_dashboard(text,integer) to authenticated;
