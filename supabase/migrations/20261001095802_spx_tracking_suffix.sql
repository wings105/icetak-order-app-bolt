-- Preserve ParcelDaily's tracking numbers, including the observed SPX suffix A.
-- Accept numeric MY tracking numbers and MY + digits + A; do not strip the suffix.
-- Only tracking-link/courier recognition changes. Notification guards are unchanged.

create or replace function public.icetak_shipping_courier_key(p_courier text, p_tracking_no text default null)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when upper(btrim(coalesce(p_tracking_no,''))) ~ '^NVMY[A-Z0-9]+$' then 'ninja'
    when upper(btrim(coalesce(p_tracking_no,''))) ~ '^MY[0-9]+A?$' then 'spx'
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
    when upper(btrim(coalesce(p_tracking_no,''))) ~ '^MY[0-9]+A?$'
      then 'https://spx.com.my/track?'||upper(btrim(p_tracking_no))
    when btrim(coalesce(p_tracking_no,'')) ~ '^[0-9]+$'
      then 'https://jtexpress.my/tracking/'||btrim(p_tracking_no)
    else null end;
$$;
