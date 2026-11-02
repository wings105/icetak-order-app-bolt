-- Accept SPX numeric tracking with an optional single alphabetic suffix.
-- Pause only existing newly recognized unsent shipments before repairing their links.
-- Retain the bounded recovery snapshot privately; do not enqueue historical messages.
insert into public.private_runtime_settings(setting_key,setting_value)
select 'spx_alphabetic_suffix_recovery_20261103',coalesce(jsonb_object_agg(st.shipment_id::text,
 jsonb_build_object('auto_send_enabled',st.auto_send_enabled,'send_status',st.send_status,
 'blocked_reason',st.blocked_reason,'held_at',now(),'reason','Owner requested format repair without historical tracking sends')),'{}'::jsonb)::text
from public.shipments s join public.shipment_tracking_state st on st.shipment_id=s.id
where upper(btrim(s.tracking_no)) ~ '^MY[0-9]+[B-Z]$'
 and public.icetak_tracking_link(s.tracking_no) is null
 and st.send_status in ('blocked','not_ready') and st.auto_queue_id is null and st.sent_at is null
on conflict(setting_key) do nothing;

update public.shipment_tracking_state st set auto_send_enabled=false,auto_send_updated_at=now(),updated_at=now()
where st.shipment_id::text in (
 select jsonb_object_keys(setting_value::jsonb) from public.private_runtime_settings
 where setting_key='spx_alphabetic_suffix_recovery_20261103');

create or replace function public.icetak_shipping_courier_key(p_courier text, p_tracking_no text default null)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when upper(btrim(coalesce(p_tracking_no,''))) ~ '^NVMY[A-Z0-9]+$' then 'ninja'
    when upper(btrim(coalesce(p_tracking_no,''))) ~ '^MY[0-9]+[A-Z]?$' then 'spx'
    when btrim(coalesce(p_tracking_no,'')) ~ '^[0-9]+$' then 'jnt'
    when lower(btrim(coalesce(p_courier,''))) in ('ninja','ninjavan','ninja van') then 'ninja'
    when lower(btrim(coalesce(p_courier,''))) in ('spx','shopee express','shopee xpress') then 'spx'
    when lower(btrim(coalesce(p_courier,''))) in ('jnt','j&t','j&t express','jnt express') then 'jnt'
    when lower(btrim(coalesce(p_courier,''))) in ('pickup','self pickup','self-pickup') then 'pickup'
    else nullif(lower(regexp_replace(btrim(coalesce(p_courier,'')),'[^a-zA-Z0-9]+','','g')),'') end;
$$;

create or replace function public.icetak_tracking_link(p_tracking_no text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when upper(btrim(coalesce(p_tracking_no,''))) ~ '^NVMY[A-Z0-9]+$'
      then 'https://www.ninjavan.co/en-my/tracking?id='||upper(btrim(p_tracking_no))
    when upper(btrim(coalesce(p_tracking_no,''))) ~ '^MY[0-9]+[A-Z]?$'
      then 'https://spx.com.my/track?'||upper(btrim(p_tracking_no))
    when btrim(coalesce(p_tracking_no,'')) ~ '^[0-9]+$'
      then 'https://jtexpress.my/tracking/'||btrim(p_tracking_no)
    else null end;
$$;

-- Refresh only the privately snapshotted old records; queue creation is never called here.
do $recovery$
declare sid text;
begin
 for sid in select jsonb_object_keys(setting_value::jsonb) from public.private_runtime_settings
  where setting_key='spx_alphabetic_suffix_recovery_20261103'
 loop
  perform public.icetak_refresh_shipment_tracking_state(sid::uuid);
 end loop;
 if exists(select 1 from public.shipment_tracking_state st where st.shipment_id::text in (
  select jsonb_object_keys(setting_value::jsonb) from public.private_runtime_settings where setting_key='spx_alphabetic_suffix_recovery_20261103')
  and (st.auto_send_enabled or st.auto_queue_id is not null or st.sent_at is not null))
 then raise exception 'HISTORICAL_TRACKING_HOLD_FAILED';end if;
end $recovery$;
