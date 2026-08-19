-- Keep order recipient fields single-line so external shipping JSON builders cannot
-- receive literal CR/LF/tab characters from pasted or manually edited addresses.

create or replace function public.icetak_normalize_order_shipping_text()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.delivery_name is not null then
    new.delivery_name := nullif(btrim(regexp_replace(new.delivery_name, '[[:space:]]+', ' ', 'g')), '');
  end if;
  if new.delivery_address is not null then
    new.delivery_address := nullif(btrim(regexp_replace(new.delivery_address, '[[:space:]]+', ' ', 'g')), '');
  end if;
  if new.delivery_city is not null then
    new.delivery_city := nullif(btrim(regexp_replace(new.delivery_city, '[[:space:]]+', ' ', 'g')), '');
  end if;
  if new.delivery_state is not null then
    new.delivery_state := nullif(btrim(regexp_replace(new.delivery_state, '[[:space:]]+', ' ', 'g')), '');
  end if;
  return new;
end;
$function$;

drop trigger if exists icetak_00_normalize_order_shipping_text_trg on public.orders;
create trigger icetak_00_normalize_order_shipping_text_trg
before insert or update of delivery_name, delivery_address, delivery_city, delivery_state
on public.orders
for each row
execute function public.icetak_normalize_order_shipping_text();

comment on function public.icetak_normalize_order_shipping_text() is
  'Normalizes order recipient text to one line before storage for JSON-safe shipping integrations.';

-- Repair only unfinished orders that can still enter the AWB flow. Historical
-- delivered/cancelled orders and shipment snapshots remain immutable.
update public.orders o
set delivery_name = case when o.delivery_name is null then null else nullif(btrim(regexp_replace(o.delivery_name, '[[:space:]]+', ' ', 'g')), '') end,
    delivery_address = case when o.delivery_address is null then null else nullif(btrim(regexp_replace(o.delivery_address, '[[:space:]]+', ' ', 'g')), '') end,
    delivery_city = case when o.delivery_city is null then null else nullif(btrim(regexp_replace(o.delivery_city, '[[:space:]]+', ' ', 'g')), '') end,
    delivery_state = case when o.delivery_state is null then null else nullif(btrim(regexp_replace(o.delivery_state, '[[:space:]]+', ' ', 'g')), '') end,
    updated_at = now()
where (
    coalesce(o.delivery_name, '')
    || coalesce(o.delivery_address, '')
    || coalesce(o.delivery_city, '')
    || coalesce(o.delivery_state, '')
  ) ~ E'[\r\n\t]'
  and lower(coalesce(o.status, '')) not in ('completed', 'delivered', 'cancelled', 'canceled')
  and nullif(btrim(coalesce(o.tracking, '')), '') is null
  and not exists (
    select 1
    from public.shipments s
    where s.order_id = o.id
      and lower(coalesce(nullif(s.normalized_status, ''), nullif(s.status, ''), 'active'))
        not in ('cancelled', 'archived')
  );

revoke all on function public.icetak_normalize_order_shipping_text() from public, anon, authenticated;
