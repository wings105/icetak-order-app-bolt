-- Allow Admin V2 to edit the order-level recipient snapshot used by shipping/AWB.
-- Customer profile/master data remains separate and is not changed here.

create or replace function public.icetak_admin_order_recipient_update(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_actor text;
  v_name text;
  v_phone text;
  v_address text;
  v_city text;
  v_postcode text;
  v_state text;
  v_delivery_key text;
  v_locked boolean;
  v_before jsonb;
  v_after jsonb;
begin
  if not public.icetak_admin_has_permission('edit_order') then
    raise exception 'Forbidden';
  end if;

  begin
    v_order_id := nullif(p_payload->>'order_db_id', '')::uuid;
  exception when invalid_text_representation then
    v_order_id := null;
  end;
  if v_order_id is null then raise exception 'order_db_id required'; end if;

  select * into v_order
  from public.orders
  where id = v_order_id
  for update;
  if v_order.id is null then raise exception 'Order not found'; end if;

  v_locked := nullif(btrim(coalesce(v_order.tracking, '')), '') is not null
    or exists (
      select 1
      from public.shipments s
      where s.order_id = v_order_id
        and lower(coalesce(nullif(s.normalized_status, ''), nullif(s.status, ''), 'active'))
          not in ('cancelled', 'archived')
    );
  if v_locked then
    raise exception 'Customer/address cannot be changed after a shipment or tracking number has been created';
  end if;

  v_name := nullif(btrim(coalesce(p_payload->>'delivery_name', '')), '');
  v_phone := regexp_replace(coalesce(p_payload->>'delivery_phone', ''), '[^0-9]', '', 'g');
  v_address := nullif(btrim(coalesce(p_payload->>'delivery_address', '')), '');
  v_city := nullif(btrim(coalesce(p_payload->>'delivery_city', '')), '');
  v_postcode := regexp_replace(coalesce(p_payload->>'delivery_postcode', ''), '[^0-9]', '', 'g');
  v_state := nullif(btrim(coalesce(p_payload->>'delivery_state', '')), '');
  v_delivery_key := lower(btrim(coalesce(v_order.delivery_method, v_order.delivery, '')));

  if v_name is null then raise exception 'Recipient name is required'; end if;
  if length(v_name) > 200 then raise exception 'Recipient name cannot exceed 200 characters'; end if;

  if left(v_phone, 1) = '0' then v_phone := '60' || substr(v_phone, 2);
  elsif left(v_phone, 1) = '1' then v_phone := '60' || v_phone;
  end if;
  if v_phone !~ '^601[0-9]{8,9}$' then raise exception 'Invalid Malaysia recipient phone'; end if;

  if v_delivery_key not like '%pickup%' then
    if v_address is null or length(v_address) < 5 then raise exception 'Delivery address is required'; end if;
    if v_city is null then raise exception 'City is required'; end if;
    if v_postcode !~ '^[0-9]{5}$' or v_postcode = '00000' then raise exception 'Valid 5-digit postcode is required'; end if;
    if v_state is null then raise exception 'State is required'; end if;
  end if;

  if length(coalesce(v_address, '')) > 500 then raise exception 'Delivery address cannot exceed 500 characters'; end if;
  if length(coalesce(v_city, '')) > 100 then raise exception 'City cannot exceed 100 characters'; end if;
  if length(coalesce(v_state, '')) > 100 then raise exception 'State cannot exceed 100 characters'; end if;

  v_before := jsonb_build_object(
    'deliveryName', v_order.delivery_name,
    'deliveryPhone', v_order.delivery_phone,
    'deliveryAddress', v_order.delivery_address,
    'deliveryPostcode', v_order.delivery_postcode,
    'deliveryCity', v_order.delivery_city,
    'deliveryState', v_order.delivery_state,
    'deliveryAddressId', v_order.delivery_address_id
  );

  update public.orders
  set delivery_name = v_name,
      delivery_phone = v_phone,
      delivery_address = v_address,
      delivery_postcode = nullif(v_postcode, ''),
      delivery_city = v_city,
      delivery_state = v_state,
      delivery_address_id = null,
      updated_at = now()
  where id = v_order_id;

  v_after := jsonb_build_object(
    'deliveryName', v_name,
    'deliveryPhone', v_phone,
    'deliveryAddress', v_address,
    'deliveryPostcode', nullif(v_postcode, ''),
    'deliveryCity', v_city,
    'deliveryState', v_state,
    'deliveryAddressId', null
  );

  select username into v_actor
  from public.admin_users
  where auth_user_id = auth.uid() and is_active = true
  limit 1;

  insert into public.admin_audit(order_db_id, order_id, action, actor, payload)
  values (
    v_order_id::text,
    coalesce(v_order.order_no, v_order.order_id),
    'update_order_recipient',
    coalesce(v_actor, 'admin'),
    jsonb_build_object('before', v_before, 'after', v_after, 'source', 'admin_order_detail')
  );

  return jsonb_build_object(
    'ok', true,
    'recipient', v_after,
    'recipientLocked', false
  );
end;
$function$;

revoke all on function public.icetak_admin_order_recipient_update(jsonb) from public, anon;
grant execute on function public.icetak_admin_order_recipient_update(jsonb) to authenticated, service_role;

comment on function public.icetak_admin_order_recipient_update(jsonb) is
  'Updates the order-level recipient snapshot used by shipping/AWB without changing customer master data.';

-- Make Admin V2 display the order snapshot first, and expose whether recipient editing is locked.
do $migration$
declare
  v_oid oid;
  v_definition text;
  v_old text;
  v_new text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'icetak_admin_order_detail_v2'
    and p.oid::regprocedure::text = 'icetak_admin_order_detail_v2(text)';
  if v_oid is null then raise exception 'icetak_admin_order_detail_v2(text) not found'; end if;

  v_definition := pg_get_functiondef(v_oid);
  v_old := $find$'customerName',coalesce(c.name,o.delivery_name,''),'customerPhone',coalesce(c.phone,o.delivery_phone,'')$find$;
  v_new := $replace$'customerName',coalesce(nullif(o.delivery_name,''),c.name,''),'customerPhone',coalesce(nullif(o.delivery_phone,''),c.phone,'')$replace$;
  if position(v_old in v_definition) = 0 then raise exception 'Admin detail customer snapshot pattern changed'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $find$'deliveryState',coalesce(o.delivery_state,''),'courier'$find$;
  v_new := $replace$'deliveryState',coalesce(o.delivery_state,''),'recipientLocked',(
        nullif(btrim(coalesce(o.tracking,'')),'') is not null
        or exists (
          select 1 from public.shipments recipient_shipment
          where recipient_shipment.order_id=o.id
            and lower(coalesce(nullif(recipient_shipment.normalized_status,''),nullif(recipient_shipment.status,''),'active')) not in ('cancelled','archived')
        )
      ),'courier'$replace$;
  if position(v_old in v_definition) = 0 then raise exception 'Admin detail delivery snapshot pattern changed'; end if;
  execute replace(v_definition, v_old, v_new);

  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'icetak_admin_orders_enterprise'
    and p.oid::regprocedure::text = 'icetak_admin_orders_enterprise(text,jsonb,text,text,integer,integer)';
  if v_oid is null then raise exception 'icetak_admin_orders_enterprise(...) not found'; end if;

  v_definition := pg_get_functiondef(v_oid);
  v_old := $find$coalesce(c.name,o.delivery_name,'') customer_name,coalesce(c.phone,o.delivery_phone,'') customer_phone$find$;
  v_new := $replace$coalesce(nullif(o.delivery_name,''),c.name,'') customer_name,coalesce(nullif(o.delivery_phone,''),c.phone,'') customer_phone$replace$;
  if position(v_old in v_definition) = 0 then raise exception 'Admin list customer snapshot pattern changed'; end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;
