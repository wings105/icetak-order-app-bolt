alter table public.shipment_tracking_state
  add column if not exists manual_cancelled_at timestamptz,
  add column if not exists manual_cancelled_by uuid,
  add column if not exists manual_cancel_reason text,
  add column if not exists pre_cancel_send_status text;

alter table public.shipment_tracking_state
  drop constraint if exists shipment_tracking_state_send_status_check;

alter table public.shipment_tracking_state
  add constraint shipment_tracking_state_send_status_check
  check (send_status in ('not_ready','blocked','ready','opened','sent','failed','cancelled'));

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
  select * into v_shipment from public.shipments where id = p_shipment_id;
  if not found then return; end if;

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
    shipment_id, first_scan_event_id, first_scan_at, first_scan_status,
    send_status, blocked_reason, updated_at
  ) values (
    p_shipment_id, v_event.id, coalesce(v_event.event_time, v_event.created_at),
    coalesce(v_event.status, v_event.normalized_status, v_event.status_group),
    v_base_status, v_blocked_reason, now()
  )
  on conflict (shipment_id) do update set
    first_scan_event_id = excluded.first_scan_event_id,
    first_scan_at = excluded.first_scan_at,
    first_scan_status = excluded.first_scan_status,
    send_status = case
      when shipment_tracking_state.send_status in ('opened','sent','cancelled')
        then shipment_tracking_state.send_status
      else excluded.send_status
    end,
    blocked_reason = case
      when shipment_tracking_state.send_status in ('sent','cancelled')
        then shipment_tracking_state.blocked_reason
      else excluded.blocked_reason
    end,
    updated_at = now();
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

  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;

  if v_action = 'opened' then
    if v_state.send_status not in ('ready','opened','sent') then
      raise exception 'TRACKING_NOT_READY';
    end if;
    update public.shipment_tracking_state
    set send_status = case when send_status = 'sent' then 'sent' else 'opened' end,
        manual_opened_at = now(), manual_opened_by = auth.uid(), updated_at = now()
    where shipment_id = p_shipment_id;

  elsif v_action = 'sent' then
    if v_state.send_status not in ('ready','opened','sent') then
      raise exception 'TRACKING_NOT_READY';
    end if;
    update public.shipment_tracking_state
    set send_status = 'sent', sent_at = coalesce(sent_at, now()), sent_by = auth.uid(),
        send_method = 'manual_whatsapp_link', last_error = null, updated_at = now()
    where shipment_id = p_shipment_id;

  elsif v_action = 'cancel' then
    update public.shipment_tracking_state
    set pre_cancel_send_status = case
          when send_status = 'cancelled' then pre_cancel_send_status else send_status end,
        send_status = 'cancelled',
        manual_cancelled_at = coalesce(manual_cancelled_at, now()),
        manual_cancelled_by = coalesce(manual_cancelled_by, auth.uid()),
        manual_cancel_reason = 'Cancelled manually in iCetak',
        last_error = null, updated_at = now()
    where shipment_id = p_shipment_id;

  elsif v_action = 'restore' then
    if v_state.send_status <> 'cancelled' then raise exception 'TRACKING_NOT_CANCELLED'; end if;
    update public.shipment_tracking_state st
    set send_status = case
          when st.pre_cancel_send_status = 'sent' then 'sent'
          when st.pre_cancel_send_status = 'opened'
               and st.first_scan_at is not null
               and nullif(btrim(coalesce(s.recipient_phone, '')), '') is not null
               and public.icetak_tracking_link(s.tracking_no) is not null then 'opened'
          when st.first_scan_at is null then 'not_ready'
          when nullif(btrim(coalesce(s.recipient_phone, '')), '') is null then 'blocked'
          when public.icetak_tracking_link(s.tracking_no) is null then 'blocked'
          else 'ready'
        end,
        blocked_reason = case
          when st.pre_cancel_send_status in ('sent','opened') then null
          when st.first_scan_at is null then null
          when nullif(btrim(coalesce(s.recipient_phone, '')), '') is null then 'MISSING_RECIPIENT_PHONE'
          when public.icetak_tracking_link(s.tracking_no) is null then 'UNSUPPORTED_TRACKING_FORMAT'
          else null
        end,
        manual_cancelled_at = null, manual_cancelled_by = null,
        manual_cancel_reason = null, pre_cancel_send_status = null,
        last_error = null, updated_at = now()
    from public.shipments s
    where st.shipment_id = p_shipment_id and s.id = st.shipment_id;

  elsif v_action = 'reopen' then
    if v_state.send_status = 'cancelled' then raise exception 'TRACKING_CANCELLED'; end if;
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
        manual_opened_at = null, manual_opened_by = null,
        sent_at = null, sent_by = null, send_method = null,
        last_error = null, updated_at = now()
    from public.shipments s
    where st.shipment_id = p_shipment_id and s.id = st.shipment_id;
  else
    raise exception 'UNSUPPORTED_ACTION';
  end if;

  select * into v_state from public.shipment_tracking_state where shipment_id = p_shipment_id;
  return to_jsonb(v_state);
end;
$function$;

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
          s.id, s.order_id, s.reference, s.tracking_no,
          public.icetak_tracking_courier(s.tracking_no, s.courier) as courier,
          public.icetak_tracking_link(s.tracking_no) as tracking_link,
          s.status, s.normalized_status, s.provider, s.service_provider,
          s.recipient_phone, s.recipient_name, s.recipient_address_text,
          s.shipped_at, s.delivered_at, s.created_at, s.updated_at,
          st.first_scan_at, st.first_scan_status,
          coalesce(st.send_status, 'not_ready') as send_status,
          st.blocked_reason, st.manual_opened_at, st.sent_at, st.send_method,
          st.manual_cancelled_at, st.manual_cancel_reason,
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

revoke all on function public.icetak_admin_tracking_action(uuid,text) from public, anon;
grant execute on function public.icetak_admin_tracking_action(uuid,text) to authenticated;
revoke all on function public.icetak_admin_tracking_dashboard(text,integer) from public, anon;
grant execute on function public.icetak_admin_tracking_dashboard(text,integer) to authenticated;
