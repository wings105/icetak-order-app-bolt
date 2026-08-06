create table if not exists public.shipment_message_jobs (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  notification_type text not null check (notification_type in ('checkout_address','first_scan_tracking')),
  source_event_id uuid,
  source_event_time timestamptz,
  tracking_no text,
  courier text,
  tracking_link text,
  recipient_phone text,
  recipient_name text,
  recipient_address_text text,
  message_body text not null default '',
  status text not null default 'ready' check (status in ('ready','blocked','copied','done','dismissed')),
  blocked_reason text,
  idempotency_key text not null unique,
  copied_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.shipment_message_jobs is
  'Manual-only customer message preparation. No external messaging API or automatic send is connected.';

create index if not exists shipment_message_jobs_status_created_idx
  on public.shipment_message_jobs(status, created_at desc);
create index if not exists shipment_message_jobs_shipment_idx
  on public.shipment_message_jobs(shipment_id, notification_type);
create index if not exists shipment_message_jobs_tracking_idx
  on public.shipment_message_jobs(tracking_no);

create or replace function public.icetak_tracking_link(p_tracking_no text)
returns text
language sql
immutable
set search_path = public
as $function$
  select case
    when upper(trim(coalesce(p_tracking_no,''))) ~ '^MY[0-9]+$'
      then 'https://spx.com.my/track?' || upper(trim(p_tracking_no))
    when trim(coalesce(p_tracking_no,'')) ~ '^[0-9]+$'
      then 'https://jtexpress.my/tracking/' || trim(p_tracking_no)
    else null
  end;
$function$;

create or replace function public.icetak_tracking_courier(p_tracking_no text, p_courier text default null)
returns text
language sql
immutable
set search_path = public
as $function$
  select case
    when upper(trim(coalesce(p_tracking_no,''))) ~ '^MY[0-9]+$' then 'spx'
    when trim(coalesce(p_tracking_no,'')) ~ '^[0-9]+$' then 'jnt'
    when lower(trim(coalesce(p_courier,''))) in ('spx','jnt') then lower(trim(p_courier))
    else null
  end;
$function$;

create or replace function public.icetak_tracking_message(p_tracking_no text)
returns text
language sql
immutable
set search_path = public
as $function$
  select 'Hi,' || E'\n' ||
         'This tracking number for your order' || E'\n\n' ||
         'Tracking Number: ' || trim(coalesce(p_tracking_no,'')) || E'\n' ||
         'Track here: ' || coalesce(public.icetak_tracking_link(p_tracking_no),'');
$function$;

create or replace function public.icetak_checkout_address_message(
  p_name text,
  p_phone text,
  p_address text,
  p_tracking_no text
)
returns text
language sql
immutable
set search_path = public
as $function$
  select 'Hi,' || E'\n' ||
         'Your delivery details have been received.' || E'\n\n' ||
         'Name: ' || trim(coalesce(p_name,'')) || E'\n' ||
         'Phone: ' || trim(coalesce(p_phone,'')) || E'\n' ||
         'Address: ' || trim(coalesce(p_address,'')) || E'\n\n' ||
         'Tracking Number: ' || trim(coalesce(p_tracking_no,''));
$function$;

create or replace function public.icetak_admin_can_manage_shipping_messages()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.admin_users au
    left join public.admin_permissions ap
      on ap.auth_user_id=au.auth_user_id
      or ap.admin_user_id=au.id
      or ap.username=au.username
    where au.auth_user_id=auth.uid()
      and coalesce(au.is_active,true)
      and (
        lower(coalesce(au.role,'')) in ('owner','admin','super_admin')
        or 'manage_shipping'=any(coalesce(ap.permissions,'{}'::text[]))
      )
  );
$function$;

create or replace function public.icetak_upsert_shipment_message_job(
  p_shipment_id uuid,
  p_notification_type text,
  p_source_event_id uuid default null,
  p_source_event_time timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_shipment public.shipments%rowtype;
  v_link text;
  v_courier text;
  v_message text;
  v_blocked text;
  v_key text;
  v_id uuid;
begin
  if p_notification_type not in ('checkout_address','first_scan_tracking') then
    raise exception 'UNSUPPORTED_NOTIFICATION_TYPE';
  end if;

  select * into v_shipment from public.shipments where id=p_shipment_id;
  if not found then return null; end if;

  v_link := public.icetak_tracking_link(v_shipment.tracking_no);
  v_courier := public.icetak_tracking_courier(v_shipment.tracking_no, v_shipment.courier);
  v_key := p_notification_type || ':' || v_shipment.id::text;

  if p_notification_type='first_scan_tracking' then
    v_message := public.icetak_tracking_message(v_shipment.tracking_no);
    if nullif(trim(coalesce(v_shipment.recipient_phone,'')),'') is null then
      v_blocked := 'MISSING_RECIPIENT_PHONE';
    elsif nullif(trim(coalesce(v_shipment.tracking_no,'')),'') is null then
      v_blocked := 'MISSING_TRACKING_NUMBER';
    elsif v_link is null then
      v_blocked := 'UNSUPPORTED_TRACKING_FORMAT';
    end if;
  else
    v_message := public.icetak_checkout_address_message(
      v_shipment.recipient_name,
      v_shipment.recipient_phone,
      v_shipment.recipient_address_text,
      v_shipment.tracking_no
    );
    if nullif(trim(coalesce(v_shipment.recipient_phone,'')),'') is null then
      v_blocked := 'MISSING_RECIPIENT_PHONE';
    elsif nullif(trim(coalesce(v_shipment.recipient_name,'')),'') is null then
      v_blocked := 'MISSING_RECIPIENT_NAME';
    elsif nullif(trim(coalesce(v_shipment.recipient_address_text,'')),'') is null then
      v_blocked := 'MISSING_RECIPIENT_ADDRESS';
    elsif nullif(trim(coalesce(v_shipment.tracking_no,'')),'') is null then
      v_blocked := 'MISSING_TRACKING_NUMBER';
    end if;
  end if;

  insert into public.shipment_message_jobs (
    shipment_id, notification_type, source_event_id, source_event_time,
    tracking_no, courier, tracking_link,
    recipient_phone, recipient_name, recipient_address_text,
    message_body, status, blocked_reason, idempotency_key, metadata
  ) values (
    v_shipment.id, p_notification_type, p_source_event_id, p_source_event_time,
    v_shipment.tracking_no, v_courier, v_link,
    v_shipment.recipient_phone, v_shipment.recipient_name, v_shipment.recipient_address_text,
    v_message, case when v_blocked is null then 'ready' else 'blocked' end,
    v_blocked, v_key,
    jsonb_build_object('manual_only',true,'external_send_enabled',false)
  )
  on conflict (idempotency_key) do update set
    source_event_id=coalesce(excluded.source_event_id, shipment_message_jobs.source_event_id),
    source_event_time=coalesce(excluded.source_event_time, shipment_message_jobs.source_event_time),
    tracking_no=excluded.tracking_no,
    courier=excluded.courier,
    tracking_link=excluded.tracking_link,
    recipient_phone=excluded.recipient_phone,
    recipient_name=excluded.recipient_name,
    recipient_address_text=excluded.recipient_address_text,
    message_body=case
      when shipment_message_jobs.status in ('done','dismissed','copied') then shipment_message_jobs.message_body
      else excluded.message_body
    end,
    status=case
      when shipment_message_jobs.status in ('done','dismissed','copied') then shipment_message_jobs.status
      when excluded.blocked_reason is null then 'ready'
      else 'blocked'
    end,
    blocked_reason=case
      when shipment_message_jobs.status in ('done','dismissed') then shipment_message_jobs.blocked_reason
      else excluded.blocked_reason
    end,
    metadata=shipment_message_jobs.metadata || excluded.metadata,
    updated_at=now()
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.icetak_prepare_checkout_address_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_shipment_id uuid;
begin
  if upper(coalesce(new.event_type,'')) <> 'CHECKOUT'
     or lower(coalesce(new.processing_status,'')) <> 'processed' then
    return new;
  end if;

  if tg_op='UPDATE'
     and lower(coalesce(old.processing_status,''))='processed'
     and old.shipment_id is not distinct from new.shipment_id then
    return new;
  end if;

  v_shipment_id := new.shipment_id;
  if v_shipment_id is null and nullif(trim(coalesce(new.reference,'')),'') is not null then
    select s.id into v_shipment_id
    from public.shipments s
    where s.reference=new.reference
    order by s.created_at desc
    limit 1;
  end if;

  if v_shipment_id is not null then
    perform public.icetak_upsert_shipment_message_job(
      v_shipment_id,
      'checkout_address',
      new.id,
      coalesce(new.processed_at,new.received_at,now())
    );
  end if;
  return new;
end;
$function$;

create or replace function public.icetak_is_first_physical_scan(
  p_normalized_status text,
  p_status_group text,
  p_status text
)
returns boolean
language sql
immutable
set search_path = public
as $function$
  select case
    when lower(trim(coalesce(p_normalized_status,''))) in ('picked_up','accepted_by_courier') then true
    when lower(trim(coalesce(p_status_group,''))) in ('picked_up','accepted_by_courier') then true
    when lower(coalesce(p_status,'')) like '%shipment data received%' then false
    when lower(coalesce(p_status,'')) like '%picked up by%' then true
    when lower(coalesce(p_status,'')) like '%accepted by courier%' then true
    when lower(coalesce(p_status,'')) like '%received by courier%' then true
    else false
  end;
$function$;

create or replace function public.icetak_prepare_first_scan_tracking_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.shipment_id is not null
     and public.icetak_is_first_physical_scan(new.normalized_status,new.status_group,new.status) then
    perform public.icetak_upsert_shipment_message_job(
      new.shipment_id,
      'first_scan_tracking',
      new.id,
      coalesce(new.event_time,new.created_at,now())
    );
  end if;
  return new;
end;
$function$;

create or replace function public.icetak_refresh_existing_shipment_message_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if exists (
    select 1 from public.shipment_message_jobs
    where shipment_id=new.id and notification_type='checkout_address'
  ) then
    perform public.icetak_upsert_shipment_message_job(new.id,'checkout_address',null,null);
  end if;

  if exists (
    select 1 from public.shipment_message_jobs
    where shipment_id=new.id and notification_type='first_scan_tracking'
  ) then
    perform public.icetak_upsert_shipment_message_job(new.id,'first_scan_tracking',null,null);
  end if;
  return new;
end;
$function$;

create or replace function public.icetak_set_shipment_message_job_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := now();
  if new.status='copied' and old.status is distinct from new.status and new.copied_at is null then
    new.copied_at := now();
  end if;
  if new.status='done' and old.status is distinct from new.status and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_shipping_webhook_prepare_manual_message on public.shipping_webhook_events;
create trigger trg_shipping_webhook_prepare_manual_message
after insert or update of processing_status, shipment_id, resolution_status
on public.shipping_webhook_events
for each row execute function public.icetak_prepare_checkout_address_job();

drop trigger if exists trg_shipment_event_prepare_manual_tracking on public.shipment_events;
create trigger trg_shipment_event_prepare_manual_tracking
after insert on public.shipment_events
for each row execute function public.icetak_prepare_first_scan_tracking_job();

drop trigger if exists trg_shipment_refresh_manual_messages on public.shipments;
create trigger trg_shipment_refresh_manual_messages
after update of recipient_phone, recipient_name, recipient_address_text, tracking_no, courier
on public.shipments
for each row execute function public.icetak_refresh_existing_shipment_message_jobs();

drop trigger if exists trg_shipment_message_jobs_updated_at on public.shipment_message_jobs;
create trigger trg_shipment_message_jobs_updated_at
before update on public.shipment_message_jobs
for each row execute function public.icetak_set_shipment_message_job_updated_at();

alter table public.shipment_message_jobs enable row level security;

drop policy if exists shipment_message_jobs_admin_select on public.shipment_message_jobs;
create policy shipment_message_jobs_admin_select
on public.shipment_message_jobs for select
to authenticated
using (public.icetak_admin_can_manage_shipping_messages());

drop policy if exists shipment_message_jobs_admin_update on public.shipment_message_jobs;
create policy shipment_message_jobs_admin_update
on public.shipment_message_jobs for update
to authenticated
using (public.icetak_admin_can_manage_shipping_messages())
with check (public.icetak_admin_can_manage_shipping_messages());

revoke all on public.shipment_message_jobs from anon;
grant select, update on public.shipment_message_jobs to authenticated;
revoke all on function public.icetak_upsert_shipment_message_job(uuid,text,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.icetak_admin_can_manage_shipping_messages() to authenticated;
