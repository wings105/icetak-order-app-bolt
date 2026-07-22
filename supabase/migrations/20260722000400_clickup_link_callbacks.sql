create or replace function public.link_clickup_production_task(
  p_order_reference text,
  p_component_id uuid,
  p_clickup_task_id text,
  p_clickup_list_id text default '18375902',
  p_task_url text default null,
  p_status text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_item_id uuid;
  v_mapping public.clickup_tasks%rowtype;
begin
  if nullif(trim(p_clickup_task_id),'') is null then
    raise exception 'clickup_task_id_required';
  end if;

  v_order_id := public.resolve_shipping_order_reference(p_order_reference);
  if v_order_id is null then raise exception 'order_not_found'; end if;

  select order_item_id into v_item_id
  from public.production_components
  where id=p_component_id and order_id=v_order_id;
  if not found then raise exception 'component_not_found_for_order'; end if;

  if exists(
    select 1 from public.clickup_tasks
    where clickup_task_id=trim(p_clickup_task_id)
      and component_id is distinct from p_component_id
  ) then
    raise exception 'clickup_task_already_linked_to_another_component';
  end if;

  insert into public.clickup_tasks(
    order_id,order_item_id,component_id,clickup_task_id,clickup_list_id,
    status,url,last_synced_at,updated_at
  ) values (
    v_order_id,v_item_id,p_component_id,trim(p_clickup_task_id),
    nullif(trim(p_clickup_list_id),''),nullif(trim(p_status),''),
    nullif(trim(p_task_url),''),now(),now()
  )
  on conflict(component_id) where component_id is not null
  do update set
    order_id=excluded.order_id,
    order_item_id=excluded.order_item_id,
    clickup_task_id=excluded.clickup_task_id,
    clickup_list_id=coalesce(excluded.clickup_list_id,public.clickup_tasks.clickup_list_id),
    status=coalesce(excluded.status,public.clickup_tasks.status),
    url=coalesce(excluded.url,public.clickup_tasks.url),
    last_synced_at=now(),
    updated_at=now()
  returning * into v_mapping;

  update public.production_components
  set clickup_task_id=trim(p_clickup_task_id),
      clickup_status=coalesce(nullif(trim(p_status),''),clickup_status),
      last_synced_at=now(),
      updated_at=now()
  where id=p_component_id;

  perform public.reconcile_shipments_for_reference(trim(p_clickup_task_id));

  return jsonb_build_object(
    'ok',true,
    'order_id',v_order_id,
    'component_id',p_component_id,
    'clickup_task_id',v_mapping.clickup_task_id,
    'clickup_list_id',v_mapping.clickup_list_id,
    'shipment_reconciled',true
  );
end;
$$;

revoke all on function public.link_clickup_production_task(text,uuid,text,text,text,text) from public;
grant execute on function public.link_clickup_production_task(text,uuid,text,text,text,text) to service_role;

create or replace function public.link_clickup_order_record(
  p_order_reference text,
  p_clickup_task_id text,
  p_clickup_list_id text default '901600842214',
  p_task_url text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
begin
  if nullif(trim(p_clickup_task_id),'') is null then
    raise exception 'clickup_task_id_required';
  end if;

  v_order_id := public.resolve_shipping_order_reference(p_order_reference);
  if v_order_id is null then raise exception 'order_not_found'; end if;

  if exists(
    select 1 from public.orders
    where clickup_order_task_id=trim(p_clickup_task_id) and id<>v_order_id
  ) then
    raise exception 'clickup_order_task_already_linked';
  end if;

  update public.orders
  set clickup_order_task_id=trim(p_clickup_task_id),
      clickup_order_list_id=nullif(trim(p_clickup_list_id),''),
      clickup_order_url=nullif(trim(p_task_url),''),
      updated_at=now()
  where id=v_order_id;

  perform public.reconcile_shipments_for_reference(trim(p_clickup_task_id));

  return jsonb_build_object(
    'ok',true,
    'order_id',v_order_id,
    'clickup_task_id',trim(p_clickup_task_id),
    'clickup_list_id',nullif(trim(p_clickup_list_id),''),
    'shipment_reconciled',true
  );
end;
$$;

revoke all on function public.link_clickup_order_record(text,text,text,text) from public;
grant execute on function public.link_clickup_order_record(text,text,text,text) to service_role;
