-- Process exactly one production component per Activepieces claim.
-- When ClickUp links that component, immediately release the outbox for the
-- next component instead of waiting for the 3-minute stale watchdog.

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
set search_path to 'public','pg_temp'
as $$
declare
  v_order_id uuid;
  v_item_id uuid;
  v_mapping public.clickup_tasks%rowtype;
  v_replay jsonb;
  v_remaining integer := 0;
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

  select count(*)::integer
    into v_remaining
  from public.production_components pc
  where pc.order_id=v_order_id
    and pc.clickup_task_id is null;

  if v_remaining = 0 then
    update public.integration_outbox
    set status='processed',
        processed_at=coalesce(processed_at,now()),
        sent_at=coalesce(sent_at,now()),
        locked_at=null,
        next_attempt_at=null,
        last_error=null,
        error=null
    where order_id=v_order_id
      and provider='activepieces'
      and event_type='clickup.production.create'
      and status in ('pending','retry','processing','failed');
  else
    update public.integration_outbox
    set status='retry',
        locked_at=null,
        next_attempt_at=now(),
        last_error=null,
        error=null,
        payload=coalesce(public.icetak_clickup_production_payload_data(v_order_id),'{}'::jsonb)
          || jsonb_build_object('remaining_components',v_remaining,'release_source','component_linked')
    where order_id=v_order_id
      and provider='activepieces'
      and event_type='clickup.production.create'
      and status in ('pending','retry','processing','failed');
  end if;

  perform public.reconcile_shipments_for_reference(trim(p_clickup_task_id));
  v_replay:=public.replay_clickup_events_for_task(trim(p_clickup_task_id));

  return jsonb_build_object(
    'ok',true,
    'order_id',v_order_id,
    'component_id',p_component_id,
    'clickup_task_id',v_mapping.clickup_task_id,
    'clickup_list_id',v_mapping.clickup_list_id,
    'remaining_components',v_remaining,
    'outbox_status',case when v_remaining=0 then 'processed' else 'retry' end,
    'shipment_reconciled',true,
    'replay',v_replay
  );
end;
$$;

comment on function public.link_clickup_production_task(text,uuid,text,text,text,text) is
  'Idempotently links one ClickUp task to one production component. Immediately releases the Activepieces outbox for the next component, or marks it processed when complete.';
