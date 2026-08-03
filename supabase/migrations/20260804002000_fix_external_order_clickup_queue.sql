-- Keep ClickUp production eligibility separate from component shipping readiness.
-- Paid orders can enter production immediately. Pay-at-pickup orders require
-- customer confirmation and explicit production approval.

create or replace function public.icetak_order_is_production_ready(p_order public.orders)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    lower(coalesce(p_order.status, '')) not in ('cancelled', 'completed', 'delivered', 'customer collected')
    and lower(coalesce(p_order.fulfillment_stage, '')) not in ('cancelled', 'collected', 'delivered', 'completed')
    and (
      p_order.customer_confirm_token is null
      or coalesce(p_order.customer_confirmed, false)
    )
    and (
      lower(coalesce(p_order.payment_status, '')) in ('paid', 'matched', 'payment_received', 'success', 'completed')
      or lower(coalesce(p_order.payment, '')) = 'paid'
      or (
        lower(coalesce(p_order.delivery_method, p_order.delivery, '')) like '%pickup%'
        and coalesce(p_order.customer_confirmed, false)
        and coalesce(p_order.production_approved, false)
        and (
          lower(coalesce(p_order.payment_status, '')) = 'cash_counter'
          or lower(coalesce(p_order.payment_method, p_order.payment, ''))
             in ('cash at counter', 'cash counter', 'cash', 'counter', 'pay at pickup')
        )
      )
    );
$$;

comment on function public.icetak_order_is_production_ready(public.orders) is
'Eligibility for creating ClickUp production tasks. This is intentionally separate from component/shipping readiness.';

create or replace function public.link_clickup_production_task(
  p_order_reference text,
  p_component_id uuid,
  p_clickup_task_id text,
  p_clickup_list_id text default '18375902'::text,
  p_task_url text default null::text,
  p_status text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_order_id uuid;
  v_item_id uuid;
  v_mapping public.clickup_tasks%rowtype;
  v_replay jsonb;
begin
  if nullif(trim(p_clickup_task_id),'') is null then
    raise exception 'clickup_task_id_required';
  end if;

  v_order_id:=public.resolve_shipping_order_reference(p_order_reference);
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
    order_id,order_item_id,component_id,clickup_task_id,clickup_list_id,status,url,last_synced_at,updated_at
  ) values(
    v_order_id,v_item_id,p_component_id,trim(p_clickup_task_id),nullif(trim(p_clickup_list_id),''),
    nullif(trim(p_status),''),nullif(trim(p_task_url),''),now(),now()
  )
  on conflict(component_id) where component_id is not null do update set
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

  if not exists(
    select 1
    from public.production_components pc
    where pc.order_id=v_order_id
      and pc.clickup_task_id is null
  ) then
    update public.integration_outbox
    set status='processed',
        processed_at=coalesce(processed_at,now()),
        sent_at=coalesce(sent_at,now()),
        locked_at=null,
        last_error=null,
        error=null
    where order_id=v_order_id
      and provider='activepieces'
      and event_type='clickup.production.create'
      and status in ('pending','retry','processing');
  end if;

  perform public.reconcile_shipments_for_reference(trim(p_clickup_task_id));
  v_replay:=public.replay_clickup_events_for_task(trim(p_clickup_task_id));

  return jsonb_build_object(
    'ok',true,
    'order_id',v_order_id,
    'component_id',p_component_id,
    'clickup_task_id',v_mapping.clickup_task_id,
    'clickup_list_id',v_mapping.clickup_list_id,
    'shipment_reconciled',true,
    'replay',v_replay
  );
end;
$$;

-- Finalize any previously linked order whose outbox lease was left open.
update public.integration_outbox io
set status='processed',
    processed_at=coalesce(io.processed_at,now()),
    sent_at=coalesce(io.sent_at,now()),
    locked_at=null,
    last_error=null,
    error=null
where io.provider='activepieces'
  and io.event_type='clickup.production.create'
  and io.status in ('pending','retry','processing')
  and not exists(
    select 1
    from public.production_components pc
    where pc.order_id=io.order_id
      and pc.clickup_task_id is null
  );
