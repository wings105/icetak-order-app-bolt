create table if not exists public.tracking_system_settings (
  singleton boolean primary key default true check (singleton),
  auto_send_enabled boolean not null default false,
  provider_mode text not null default 'manual_whatsapp_link' check (provider_mode in ('manual_whatsapp_link','external_provider')),
  provider_ready boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.tracking_system_settings (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.tracking_system_settings enable row level security;
revoke all on table public.tracking_system_settings from anon, authenticated;

create table if not exists public.shipment_tracking_state (
  shipment_id uuid primary key references public.shipments(id) on delete cascade,
  first_scan_event_id uuid,
  first_scan_at timestamptz,
  first_scan_status text,
  send_status text not null default 'not_ready' check (send_status in ('not_ready','blocked','ready','opened','sent','failed')),
  blocked_reason text,
  manual_opened_at timestamptz,
  manual_opened_by uuid,
  sent_at timestamptz,
  sent_by uuid,
  send_method text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipment_tracking_state_status_idx
  on public.shipment_tracking_state(send_status, updated_at desc);
create index if not exists shipment_tracking_state_first_scan_idx
  on public.shipment_tracking_state(first_scan_at desc);

alter table public.shipment_tracking_state enable row level security;
revoke all on table public.shipment_tracking_state from anon, authenticated;

create or replace function public.icetak_refresh_shipment_tracking_state(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_shipment public.shipments%rowtype;
  v_event public.shipment_events%rowtype;
  v_base_status text;
  v_blocked_reason text;
begin
  select * into v_shipment
  from public.shipments
  where id = p_shipment_id;

  if not found then
    return;
  end if;

  select e.* into v_event
  from public.shipment_events e
  where e.shipment_id = p_shipment_id
    and public.icetak_is_first_physical_scan(e.normalized_status, e.status_group, e.status)
  order by coalesce(e.event_time, e.created_at) asc, e.created_at asc
  limit 1;

  if v_event.id is null then
    v_base_status := 'not_ready';
  elsif nullif(btrim(coalesce(v_shipment.recipient_phone, '')), '') is null then
    v_base_status := 'blocked';
    v_blocked_reason := 'MISSING_RECIPIENT_PHONE';
  elsif nullif(btrim(coalesce(v_shipment.tracking_no, '')), '') is null then
    v_base_status := 'blocked';
    v_blocked_reason := 'MISSING_TRACKING_NUMBER';
  elsif public.icetak_tracking_link(v_shipment.tracking_no) is null then
    v_base_status := 'blocked';
    v_blocked_reason := 'UNSUPPORTED_TRACKING_FORMAT';
  else
    v_base_status := 'ready';
  end if;

  insert into public.shipment_tracking_state (
    shipment_id,
    first_scan_event_id,
    first_scan_at,
    first_scan_status,
    send_status,
    blocked_reason,
    updated_at
  ) values (
    p_shipment_id,
    v_event.id,
    coalesce(v_event.event_time, v_event.created_at),
    coalesce(v_event.status, v_event.normalized_status, v_event.status_group),
    v_base_status,
    v_blocked_reason,
    now()
  )
  on conflict (shipment_id) do update set
    first_scan_event_id = excluded.first_scan_event_id,
    first_scan_at = excluded.first_scan_at,
    first_scan_status = excluded.first_scan_status,
    send_status = case
      when shipment_tracking_state.send_status in ('opened','sent') then shipment_tracking_state.send_status
      else excluded.send_status
    end,
    blocked_reason = case
      when shipment_tracking_state.send_status = 'sent' then shipment_tracking_state.blocked_reason
      else excluded.blocked_reason
    end,
    updated_at = now();
end;
$function$;

create or replace function public.icetak_refresh_tracking_state_from_shipment()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.icetak_refresh_shipment_tracking_state(new.id);
  return new;
end;
$function$;

create or replace function public.icetak_refresh_tracking_state_from_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.shipment_id is not null
     and public.icetak_is_first_physical_scan(new.normalized_status, new.status_group, new.status) then
    perform public.icetak_refresh_shipment_tracking_state(new.shipment_id);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_shipment_refresh_tracking_dashboard on public.shipments;
create trigger trg_shipment_refresh_tracking_dashboard
after insert or update of tracking_no, courier, recipient_phone, recipient_name, recipient_address_text, normalized_status, status
on public.shipments
for each row execute function public.icetak_refresh_tracking_state_from_shipment();

drop trigger if exists trg_shipment_event_refresh_tracking_dashboard on public.shipment_events;
create trigger trg_shipment_event_refresh_tracking_dashboard
after insert or update of shipment_id, normalized_status, status_group, status, event_time
on public.shipment_events
for each row execute function public.icetak_refresh_tracking_state_from_event();

do $block$
declare
  v_id uuid;
begin
  for v_id in select id from public.shipments loop
    perform public.icetak_refresh_shipment_tracking_state(v_id);
  end loop;
end
$block$;

create or replace function public.icetak_admin_tracking_dashboard(
  p_search text default null,
  p_limit integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
begin
  if not public.icetak_admin_can_manage_shipping_messages() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select jsonb_build_object(
    'settings', jsonb_build_object(
      'auto_send_enabled', settings.auto_send_enabled,
      'provider_mode', settings.provider_mode,
      'provider_ready', settings.provider_ready,
      'updated_at', settings.updated_at
    ),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc)
      from (
        select
          s.id,
          s.order_id,
          s.reference,
          s.tracking_no,
          public.icetak_tracking_courier(s.tracking_no, s.courier) as courier,
          public.icetak_tracking_link(s.tracking_no) as tracking_link,
          s.status,
          s.normalized_status,
          s.provider,
          s.service_provider,
          s.recipient_phone,
          s.recipient_name,
          s.recipient_address_text,
          s.shipped_at,
          s.delivered_at,
          s.created_at,
          s.updated_at,
          st.first_scan_at,
          st.first_scan_status,
          coalesce(st.send_status, 'not_ready') as send_status,
          st.blocked_reason,
          st.manual_opened_at,
          st.sent_at,
          st.send_method,
          public.icetak_tracking_message(s.tracking_no) as message_body
        from public.shipments s
        left join public.shipment_tracking_state st on st.shipment_id = s.id
        where nullif(btrim(coalesce(s.tracking_no, '')), '') is not null
          and (
            v_search is null
            or lower(coalesce(s.tracking_no, '')) like '%' || v_search || '%'
            or lower(coalesce(s.recipient_phone, '')) like '%' || v_search || '%'
            or lower(coalesce(s.recipient_name, '')) like '%' || v_search || '%'
            or lower(coalesce(s.reference, '')) like '%' || v_search || '%'
            or lower(coalesce(s.status, '')) like '%' || v_search || '%'
          )
        order by s.created_at desc
        limit v_limit
      ) row_data
    ), '[]'::jsonb)
  ) into v_result
  from public.tracking_system_settings settings
  where settings.singleton = true;

  return coalesce(v_result, jsonb_build_object('settings', '{}'::jsonb, 'rows', '[]'::jsonb));
end;
$function$;

create or replace function public.icetak_admin_set_tracking_auto_send(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row public.tracking_system_settings%rowtype;
begin
  if not public.icetak_admin_can_manage_shipping_messages() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  update public.tracking_system_settings
  set auto_send_enabled = coalesce(p_enabled, false),
      updated_at = now(),
      updated_by = auth.uid()
  where singleton = true
  returning * into v_row;

  return jsonb_build_object(
    'auto_send_enabled', v_row.auto_send_enabled,
    'provider_mode', v_row.provider_mode,
    'provider_ready', v_row.provider_ready,
    'updated_at', v_row.updated_at
  );
end;
$function$;

create or replace function public.icetak_admin_tracking_action(
  p_shipment_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_state public.shipment_tracking_state%rowtype;
  v_action text := lower(btrim(coalesce(p_action, '')));
begin
  if not public.icetak_admin_can_manage_shipping_messages() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  perform public.icetak_refresh_shipment_tracking_state(p_shipment_id);

  select * into v_state
  from public.shipment_tracking_state
  where shipment_id = p_shipment_id
  for update;

  if not found then
    raise exception 'SHIPMENT_NOT_FOUND';
  end if;

  if v_action = 'opened' then
    if v_state.send_status not in ('ready','opened','sent') then
      raise exception 'TRACKING_NOT_READY';
    end if;
    update public.shipment_tracking_state
    set send_status = case when send_status = 'sent' then 'sent' else 'opened' end,
        manual_opened_at = now(),
        manual_opened_by = auth.uid(),
        updated_at = now()
    where shipment_id = p_shipment_id;
  elsif v_action = 'sent' then
    if v_state.send_status not in ('ready','opened','sent') then
      raise exception 'TRACKING_NOT_READY';
    end if;
    update public.shipment_tracking_state
    set send_status = 'sent',
        sent_at = coalesce(sent_at, now()),
        sent_by = auth.uid(),
        send_method = 'manual_whatsapp_link',
        last_error = null,
        updated_at = now()
    where shipment_id = p_shipment_id;
  elsif v_action = 'reopen' then
    update public.shipment_tracking_state st
    set send_status = case
          when st.first_scan_at is null then 'not_ready'
          when nullif(btrim(coalesce(s.recipient_phone, '')), '') is null then 'blocked'
          when public.icetak_tracking_link(s.tracking_no) is null then 'blocked'
          else 'ready'
        end,
        blocked_reason = case
          when st.first_scan_at is null then null
          when nullif(btrim(coalesce(s.recipient_phone, '')), '') is null then 'MISSING_RECIPIENT_PHONE'
          when public.icetak_tracking_link(s.tracking_no) is null then 'UNSUPPORTED_TRACKING_FORMAT'
          else null
        end,
        manual_opened_at = null,
        manual_opened_by = null,
        sent_at = null,
        sent_by = null,
        send_method = null,
        last_error = null,
        updated_at = now()
    from public.shipments s
    where st.shipment_id = p_shipment_id
      and s.id = st.shipment_id;
  else
    raise exception 'UNSUPPORTED_ACTION';
  end if;

  select * into v_state
  from public.shipment_tracking_state
  where shipment_id = p_shipment_id;

  return to_jsonb(v_state);
end;
$function$;

revoke all on function public.icetak_admin_tracking_dashboard(text, integer) from public, anon;
revoke all on function public.icetak_admin_set_tracking_auto_send(boolean) from public, anon;
revoke all on function public.icetak_admin_tracking_action(uuid, text) from public, anon;
grant execute on function public.icetak_admin_tracking_dashboard(text, integer) to authenticated;
grant execute on function public.icetak_admin_set_tracking_auto_send(boolean) to authenticated;
grant execute on function public.icetak_admin_tracking_action(uuid, text) to authenticated;
