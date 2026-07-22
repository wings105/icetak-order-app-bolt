alter table public.orders
  add column if not exists clickup_order_task_id text,
  add column if not exists clickup_order_list_id text,
  add column if not exists clickup_order_url text;

create unique index if not exists orders_clickup_order_task_id_uidx
  on public.orders(clickup_order_task_id)
  where clickup_order_task_id is not null and clickup_order_task_id <> '';

create unique index if not exists clickup_tasks_component_id_uidx
  on public.clickup_tasks(component_id)
  where component_id is not null;

create unique index if not exists shipments_provider_order_uidx
  on public.shipments(provider, provider_order_id)
  where provider_order_id is not null and provider_order_id <> '';

create unique index if not exists shipments_provider_tracking_uidx
  on public.shipments(provider, tracking_no)
  where tracking_no is not null and tracking_no <> '';

alter table public.shipping_webhook_events
  add column if not exists reference text,
  add column if not exists shipment_id uuid references public.shipments(id) on delete set null,
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists resolution_status text;

create index if not exists shipping_webhook_events_reference_idx
  on public.shipping_webhook_events(provider, reference);

create or replace function public.normalize_shipping_status(
  p_status text,
  p_group text default null
) returns text
language plpgsql
immutable
as $$
declare
  s text := lower(trim(coalesce(p_status,'')));
  g text := lower(trim(coalesce(p_group,'')));
begin
  if s like '%out for delivery%'
     or s like '%on its way for delivery%'
     or g like '%on delivery%'
     or g like '%out for delivery%'
  then return 'out_for_delivery'; end if;

  if s like '%parcel has been received%'
     or s = 'delivered'
     or s like '%successfully delivered%'
     or g = 'delivered'
  then return 'delivered'; end if;

  if s like '%picked up%' or g like '%picked up%' then return 'picked_up'; end if;
  if s like '%transit%' or s like '%arrived hub%' or s like '%departed to hub%' or g like '%transit%' then return 'in_transit'; end if;
  if s like '%return%' or g like '%return%' then return 'returning'; end if;
  if s like '%cancel%' or g like '%cancel%' then return 'cancelled'; end if;
  if s like '%fail%' or s like '%exception%' or g like '%exception%' or g like '%failed%' then return 'delivery_exception'; end if;

  if s like '%shipment data received%'
     or s like '%awb created%'
     or s like '%consignment created%'
     or s like '%connote created%'
  then return 'awb_created'; end if;

  if s like '%book%' or s like '%checkout%' or s like '%paid%' then return 'awb_created'; end if;
  if s like '%create%' or s like '%pending%' then return 'shipment_created'; end if;
  return 'unknown';
end;
$$;

create or replace function public.resolve_shipping_order_reference(p_reference text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r text := nullif(trim(p_reference), '');
  resolved uuid;
begin
  if r is null then return null; end if;

  if r ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select id into resolved from public.orders where id = r::uuid limit 1;
    if resolved is not null then return resolved; end if;
  end if;

  select id into resolved
  from public.orders
  where order_no = r
     or order_id = r
     or external_order_id = r
     or clickup_order_task_id = r
  order by created_at desc
  limit 1;
  if resolved is not null then return resolved; end if;

  select order_id into resolved
  from public.clickup_tasks
  where clickup_task_id = r
  order by updated_at desc
  limit 1;
  if resolved is not null then return resolved; end if;

  select order_id into resolved
  from public.production_components
  where clickup_task_id = r
  order by updated_at desc
  limit 1;
  return resolved;
end;
$$;

revoke all on function public.resolve_shipping_order_reference(text) from public;
grant execute on function public.resolve_shipping_order_reference(text) to service_role;

create or replace function public.shipment_resolve_order_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payload jsonb;
  extracted_reference text;
  extracted_tracking_link text;
begin
  payload := coalesce(
    new.provider_payload->'last_webhook',
    new.provider_payload->'first_webhook',
    new.provider_payload->'checkout',
    new.provider_payload->'created',
    '{}'::jsonb
  );

  extracted_reference := coalesce(
    nullif(new.reference,''),
    nullif(payload->>'reference',''),
    nullif(payload#>>'{data,reference}','')
  );
  new.reference := extracted_reference;

  if new.order_id is null and extracted_reference is not null then
    new.order_id := public.resolve_shipping_order_reference(extracted_reference);
  end if;

  extracted_tracking_link := coalesce(
    nullif(new.tracking_link,''),
    nullif(payload#>>'{serviceProviderInfo,tracking_link}',''),
    nullif(payload#>>'{data,serviceProviderInfo,tracking_link}','')
  );
  new.tracking_link := extracted_tracking_link;

  if new.normalized_status is null or new.normalized_status = '' or new.normalized_status = 'unknown' then
    new.normalized_status := public.normalize_shipping_status(new.status, new.status_group);
  end if;
  new.status_group := coalesce(nullif(new.normalized_status,''), nullif(new.status_group,''), 'unknown');
  if new.public_tracking_token is null then new.public_tracking_token := gen_random_uuid(); end if;
  return new;
end;
$$;

drop trigger if exists trg_shipment_resolve_order_before_write on public.shipments;
create trigger trg_shipment_resolve_order_before_write
before insert or update of reference,order_id,provider_payload,status,status_group,normalized_status,tracking_link
on public.shipments
for each row execute function public.shipment_resolve_order_before_write();

create or replace function public.shipment_sync_order_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ns text := coalesce(nullif(new.normalized_status,''), public.normalize_shipping_status(new.status,new.status_group));
  next_status text;
  next_admin text;
  next_tab text;
begin
  if new.order_id is null then return new; end if;

  update public.shipment_events
  set order_id = new.order_id
  where shipment_id = new.id and order_id is distinct from new.order_id;

  next_status := case
    when ns = 'delivered' then 'Completed'
    when ns in ('out_for_delivery','picked_up','in_transit') then 'Shipped'
    when ns in ('awb_created','shipment_created') then 'AWB Created'
    else null
  end;
  next_admin := case
    when ns = 'delivered' then 'Delivered'
    when ns = 'out_for_delivery' then 'Out for Delivery'
    when ns = 'in_transit' then 'In Transit'
    when ns = 'picked_up' then 'Picked Up'
    when ns in ('awb_created','shipment_created') then 'AWB Created'
    else null
  end;
  next_tab := case when ns = 'delivered' then 'completed' else 'receive' end;

  update public.orders
  set tracking = coalesce(new.tracking_no, tracking),
      courier = coalesce(new.courier, new.service_provider, courier),
      tracking_link = coalesce(new.tracking_link, tracking_link),
      connote_url = coalesce(new.awb_pdf_url, new.connote_url, new.thermal_connote_url, connote_url),
      shipment_status = coalesce(new.status, shipment_status),
      shipment_status_group = coalesce(ns, new.status_group, shipment_status_group),
      shipment_updated_at = coalesce(new.updated_at, now()),
      status = coalesce(next_status, status),
      admin_status = coalesce(next_admin, admin_status),
      tab = coalesce(next_tab, tab),
      updated_at = greatest(coalesce(updated_at,'epoch'::timestamptz), coalesce(new.updated_at,now()))
  where id = new.order_id;
  return new;
end;
$$;

drop trigger if exists trg_shipment_sync_order_after_write on public.shipments;
create trigger trg_shipment_sync_order_after_write
after insert or update of order_id,tracking_no,courier,service_provider,tracking_link,connote_url,awb_pdf_url,status,status_group,normalized_status,updated_at
on public.shipments
for each row execute function public.shipment_sync_order_after_write();

create or replace function public.reconcile_shipments_for_reference(p_reference text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  oid uuid;
  affected integer := 0;
begin
  oid := public.resolve_shipping_order_reference(p_reference);
  if oid is null or nullif(trim(p_reference),'') is null then return 0; end if;

  update public.shipments
  set order_id = oid, updated_at = now()
  where order_id is null and reference = trim(p_reference);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.reconcile_shipments_for_reference(text) from public;
grant execute on function public.reconcile_shipments_for_reference(text) to service_role;

create or replace function public.clickup_mapping_reconcile_shipments()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'clickup_tasks' then
    perform public.reconcile_shipments_for_reference(new.clickup_task_id);
  elsif tg_table_name = 'production_components' then
    if new.clickup_task_id is distinct from old.clickup_task_id then
      perform public.reconcile_shipments_for_reference(new.clickup_task_id);
    end if;
  elsif tg_table_name = 'orders' then
    if new.clickup_order_task_id is distinct from old.clickup_order_task_id then
      perform public.reconcile_shipments_for_reference(new.clickup_order_task_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clickup_tasks_reconcile_shipments on public.clickup_tasks;
create trigger trg_clickup_tasks_reconcile_shipments
after insert or update of clickup_task_id,order_id
on public.clickup_tasks
for each row execute function public.clickup_mapping_reconcile_shipments();

drop trigger if exists trg_components_reconcile_shipments on public.production_components;
create trigger trg_components_reconcile_shipments
after update of clickup_task_id
on public.production_components
for each row execute function public.clickup_mapping_reconcile_shipments();

drop trigger if exists trg_orders_clickup_reconcile_shipments on public.orders;
create trigger trg_orders_clickup_reconcile_shipments
after update of clickup_order_task_id
on public.orders
for each row execute function public.clickup_mapping_reconcile_shipments();
