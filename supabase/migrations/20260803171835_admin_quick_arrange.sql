-- Quick Arrange reuses the canonical admin order creator and ClickUp outbox flow.
-- It adds an explicit permission boundary and read/retry helpers for the UI.

update public.admin_permissions
set permissions = case
  when 'quick_arrange' = any(coalesce(permissions, '{}'::text[])) then permissions
  else array_append(coalesce(permissions, '{}'::text[]), 'quick_arrange')
end
where username = 'admin1';

create or replace function public.icetak_admin_quick_arrange(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_actor text;
  v_payload jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_order_no text;
  v_sync jsonb;
  v_existing_order_id uuid;
begin
  if not public.icetak_admin_has_permission('quick_arrange') then
    raise exception 'Forbidden: quick_arrange';
  end if;

  if nullif(trim(p_payload->>'request_id'), '') is not null then
    select nullif(a.order_db_id, '')::uuid
    into v_existing_order_id
    from public.admin_audit a
    where a.action = 'quick_arrange_create'
      and a.payload->>'request_id' = trim(p_payload->>'request_id')
    order by a.created_at desc nulls last
    limit 1;

    if v_existing_order_id is not null then
      return (
        select jsonb_build_object(
          'order_db_id', o.id,
          'order_id', coalesce(o.order_no, o.order_id),
          'order_token', o.public_token,
          'total', o.total,
          'source', 'admin_quick_arrange',
          'sync', public.icetak_admin_order_sync_status(o.id),
          'replayed', true
        )
        from public.orders o where o.id = v_existing_order_id
      );
    end if;
  end if;

  if jsonb_typeof(coalesce(p_payload->'items', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) = 0 then
    raise exception 'At least one item is required';
  end if;

  select username into v_actor
  from public.admin_users
  where auth_user_id = auth.uid() and is_active = true
  limit 1;

  v_payload := coalesce(p_payload, '{}'::jsonb)
    || jsonb_build_object(
      'admin_remark', concat_ws(E'\n', nullif(trim(p_payload->>'admin_remark'), ''), '[Quick Arrange]'),
      'quick_arrange_request_id', nullif(trim(p_payload->>'request_id'), '')
    );

  v_result := public.icetak_admin_create_order(v_payload);
  v_order_id := nullif(v_result->>'order_db_id', '')::uuid;

  if v_order_id is null then
    raise exception 'Quick Arrange order creation did not return an order id';
  end if;

  update public.orders
  set source = 'admin_quick_arrange', updated_at = now()
  where id = v_order_id
  returning coalesce(order_no, order_id) into v_order_no;

  insert into public.admin_audit(order_db_id, order_id, action, actor, payload)
  values (
    v_order_id::text,
    v_order_no,
    'quick_arrange_create',
    coalesce(v_actor, 'admin'),
    jsonb_build_object(
      'request_id', nullif(trim(p_payload->>'request_id'), ''),
      'item_count', jsonb_array_length(p_payload->'items')
    )
  );

  v_sync := public.icetak_admin_order_sync_status(v_order_id);

  return v_result || jsonb_build_object(
    'source', 'admin_quick_arrange',
    'sync', v_sync
  );
end;
$$;

create or replace function public.icetak_admin_quick_arrange_status(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_order public.orders%rowtype;
begin
  if not public.icetak_admin_has_permission('quick_arrange') then
    raise exception 'Forbidden: quick_arrange';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then raise exception 'Order not found'; end if;

  return jsonb_build_object(
    'order', jsonb_build_object(
      'db_id', v_order.id,
      'order_no', coalesce(v_order.order_no, v_order.order_id),
      'order_token', v_order.public_token,
      'payment', coalesce(v_order.payment, v_order.payment_status),
      'status', coalesce(v_order.admin_status, v_order.status),
      'production_ready', public.icetak_order_is_production_ready(v_order)
    ),
    'sync', public.icetak_admin_order_sync_status(v_order.id),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pc.id,
        'label', pc.label,
        'type', pc.component_type,
        'set_label', pc.set_label,
        'clickup_task_id', pc.clickup_task_id,
        'clickup_status', pc.clickup_status,
        'clickup_url', ct.url
      ) order by pc.created_at, pc.id)
      from public.production_components pc
      left join public.clickup_tasks ct on ct.component_id = pc.id
      where pc.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.icetak_admin_quick_arrange_retry(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_order public.orders%rowtype;
  v_updated integer := 0;
begin
  if not public.icetak_admin_has_permission('quick_arrange') then
    raise exception 'Forbidden: quick_arrange';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'Order not found'; end if;
  if not public.icetak_order_is_production_ready(v_order) then
    raise exception 'Order is not production-ready';
  end if;

  update public.integration_outbox
  set status = 'retry',
      next_attempt_at = now(),
      locked_at = null,
      processed_at = null,
      last_error = null,
      error = null
  where order_id = v_order.id
    and provider = 'activepieces'
    and event_type = 'clickup.production.create'
    and exists (
      select 1 from public.production_components pc
      where pc.order_id = v_order.id and pc.clickup_task_id is null
    );
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    perform public.enqueue_clickup_production_order(v_order.id);
  end if;

  return public.icetak_admin_quick_arrange_status(v_order.id);
end;
$$;

revoke all on function public.icetak_admin_quick_arrange(jsonb) from public, anon;
revoke all on function public.icetak_admin_quick_arrange_status(uuid) from public, anon;
revoke all on function public.icetak_admin_quick_arrange_retry(uuid) from public, anon;
grant execute on function public.icetak_admin_quick_arrange(jsonb) to authenticated, service_role;
grant execute on function public.icetak_admin_quick_arrange_status(uuid) to authenticated, service_role;
grant execute on function public.icetak_admin_quick_arrange_retry(uuid) to authenticated, service_role;

comment on function public.icetak_admin_quick_arrange(jsonb) is
'Admin-only fast order entry that preserves the canonical order, component and ClickUp outbox flow.';
