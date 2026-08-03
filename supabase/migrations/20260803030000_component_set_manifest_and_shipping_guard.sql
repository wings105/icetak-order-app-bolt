alter table public.production_components
  add column if not exists set_index integer,
  add column if not exists set_label text,
  add column if not exists clickup_set_option_id text;

alter table public.production_components
  drop constraint if exists production_components_set_index_check;

alter table public.production_components
  add constraint production_components_set_index_check
  check (set_index is null or set_index >= 1);

insert into public.system_settings(key, value, updated_at)
values (
  'clickup_component_set_manifest',
  jsonb_build_object(
    'field_id', '2670446d-5e5a-48ac-931d-c2be790d6b3b',
    'max_sets', 10,
    'options', jsonb_build_object(
      '1', '80bb319b-02c0-45d3-9ee1-4fcba7e3ee4b',
      '2', '88b687e3-1e73-44a3-b7e0-156217c7640c',
      '3', '4ab6c5d3-c585-4dae-abcb-5f09ef1e7403',
      '4', '93d579cf-c2cd-44c4-b6a7-59138a2213a2',
      '5', '5b6cb0da-f2bd-4b34-8274-b488094f4950',
      '6', 'f6c90078-fed3-4d64-aec7-e453294255f1',
      '7', 'db39efad-5128-48b0-8647-9bff6624ab54',
      '8', '632cdb56-ae91-4799-bfc7-3dd1220af4ac',
      '9', '330d3211-9663-4b87-b539-e49c755ff441',
      '10', 'acb9c0fd-dfaa-4e88-b011-3cda7843ed18'
    )
  ),
  now()
)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

with ranked as (
  select
    id,
    row_number() over (partition by order_id order by created_at, id) as rn
  from public.production_components
)
update public.production_components pc
set set_index = ranked.rn,
    set_label = 'set' || ranked.rn::text,
    clickup_set_option_id = case ranked.rn
      when 1 then '80bb319b-02c0-45d3-9ee1-4fcba7e3ee4b'
      when 2 then '88b687e3-1e73-44a3-b7e0-156217c7640c'
      when 3 then '4ab6c5d3-c585-4dae-abcb-5f09ef1e7403'
      when 4 then '93d579cf-c2cd-44c4-b6a7-59138a2213a2'
      when 5 then '5b6cb0da-f2bd-4b34-8274-b488094f4950'
      when 6 then 'f6c90078-fed3-4d64-aec7-e453294255f1'
      when 7 then 'db39efad-5128-48b0-8647-9bff6624ab54'
      when 8 then '632cdb56-ae91-4799-bfc7-3dd1220af4ac'
      when 9 then '330d3211-9663-4b87-b539-e49c755ff441'
      when 10 then 'acb9c0fd-dfaa-4e88-b011-3cda7843ed18'
      else null
    end,
    updated_at = now()
from ranked
where pc.id = ranked.id
  and pc.set_index is null;

create unique index if not exists production_components_order_set_index_uidx
  on public.production_components(order_id, set_index)
  where set_index is not null;

create or replace function public.assign_production_component_set_manifest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_config jsonb;
  v_next integer;
begin
  if new.order_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.order_id::text || ':component-set', 0));

  if new.set_index is null then
    select coalesce(max(set_index), 0) + 1
      into v_next
    from public.production_components
    where order_id = new.order_id;
    new.set_index := v_next;
  end if;

  new.set_label := coalesce(nullif(new.set_label, ''), 'set' || new.set_index::text);

  select value into v_config
  from public.system_settings
  where key = 'clickup_component_set_manifest';

  new.clickup_set_option_id := coalesce(
    nullif(new.clickup_set_option_id, ''),
    v_config -> 'options' ->> new.set_index::text
  );

  return new;
end;
$$;

drop trigger if exists trg_assign_production_component_set_manifest on public.production_components;
create trigger trg_assign_production_component_set_manifest
before insert on public.production_components
for each row execute function public.assign_production_component_set_manifest();

create or replace function public.icetak_order_component_readiness(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with component_state as (
    select
      id,
      coalesce(set_index, 0) as set_index,
      coalesce(set_label, 'set?') as set_label,
      component_type,
      label,
      workflow,
      clickup_status,
      coalesce(progress_stage, 0) as progress_stage,
      coalesce(progress_percent, 0) as progress_percent,
      (
        coalesce(progress_stage, 0) >= 6
        or lower(coalesce(workflow, '')) in ('finishing', 'complete', 'completed', 'production_complete', 'ready', 'ready_to_ship')
        or lower(coalesce(clickup_status, '')) in ('print alamat', 'complete')
      ) as is_shipping_ready
    from public.production_components
    where order_id = p_order_id
  ), summary as (
    select
      count(*)::integer as total_components,
      count(*) filter (where is_shipping_ready)::integer as ready_components,
      count(*) filter (where not is_shipping_ready)::integer as pending_components,
      coalesce(bool_and(is_shipping_ready), false) as all_components_ready,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'component_id', id,
            'set_index', set_index,
            'set_label', set_label,
            'component_type', component_type,
            'label', label,
            'workflow', workflow,
            'clickup_status', clickup_status,
            'progress_stage', progress_stage,
            'progress_percent', progress_percent,
            'shipping_ready', is_shipping_ready
          ) order by set_index, id
        ),
        '[]'::jsonb
      ) as components
    from component_state
  )
  select jsonb_build_object(
    'order_id', p_order_id,
    'total_components', total_components,
    'ready_components', ready_components,
    'pending_components', pending_components,
    'all_components_ready', case when total_components = 0 then false else all_components_ready end,
    'minimum_stage', 6,
    'components', components
  )
  from summary;
$$;

create or replace function public.icetak_order_is_production_ready(p_order public.orders)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from public.production_components pc where pc.order_id = p_order.id
    ) then coalesce((public.icetak_order_component_readiness(p_order.id) ->> 'all_components_ready')::boolean, false)
    else coalesce(p_order.production_approved, false)
      or lower(coalesce(p_order.status, '')) in ('ready_to_ship', 'ready', 'completed')
  end;
$$;

update public.clickup_status_mapping
set active = false,
    updated_at = now(),
    notes = concat_ws(' | ', nullif(notes, ''), 'Disabled 2026-08-03: edible components must begin at design edible image')
where lower(status_name) = 'edible print ready stock'
  and lower(component_scope) = 'edible';

insert into public.shipping_settings(key, value, description, updated_at)
values (
  'component_readiness_policy',
  jsonb_build_object(
    'enabled', true,
    'minimum_progress_stage', 6,
    'shipping_ready_statuses', jsonb_build_array('print alamat', 'complete'),
    'block_when_any_component_pending', true
  ),
  'Blocks quote, shipment booking and AWB flow until every production component is at finishing/print alamat or complete.',
  now()
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

create or replace function public.guard_shipping_agent_component_readiness()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_readiness jsonb;
  v_total integer;
  v_ready boolean;
begin
  if new.order_id is null then
    return new;
  end if;

  if lower(coalesce(new.action, '')) not in (
    'get_quote',
    'create_shipment',
    'create_and_checkout',
    'create_and_book_shipment'
  ) then
    return new;
  end if;

  v_readiness := public.icetak_order_component_readiness(new.order_id);
  v_total := coalesce((v_readiness ->> 'total_components')::integer, 0);
  v_ready := coalesce((v_readiness ->> 'all_components_ready')::boolean, false);

  if v_total > 0 and not v_ready then
    raise exception using
      errcode = 'P0001',
      message = 'ORDER_COMPONENTS_NOT_READY',
      detail = v_readiness::text,
      hint = 'Every component must reach progress stage 6 (print alamat/finishing) or complete before quote, shipment creation, checkout or booking.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_shipping_agent_component_readiness on public.shipping_agent_runs;
create trigger trg_guard_shipping_agent_component_readiness
before insert on public.shipping_agent_runs
for each row execute function public.guard_shipping_agent_component_readiness();

create or replace function public.guard_shipment_component_readiness()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_readiness jsonb;
  v_total integer;
  v_ready boolean;
  v_is_shipping_transition boolean;
begin
  if new.order_id is null then
    return new;
  end if;

  v_is_shipping_transition := tg_op = 'INSERT'
    or lower(coalesce(new.status, '')) in ('created', 'booked', 'ready', 'ready_to_ship')
    or lower(coalesce(new.awb_status, '')) = 'ready';

  if not v_is_shipping_transition then
    return new;
  end if;

  v_readiness := public.icetak_order_component_readiness(new.order_id);
  v_total := coalesce((v_readiness ->> 'total_components')::integer, 0);
  v_ready := coalesce((v_readiness ->> 'all_components_ready')::boolean, false);

  if v_total > 0 and not v_ready then
    raise exception using
      errcode = 'P0001',
      message = 'ORDER_COMPONENTS_NOT_READY',
      detail = v_readiness::text,
      hint = 'Shipment or AWB cannot be created while any component is still in production.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_shipment_component_readiness on public.shipments;
create trigger trg_guard_shipment_component_readiness
before insert or update of status, awb_status on public.shipments
for each row execute function public.guard_shipment_component_readiness();

create or replace view public.order_shipping_readiness as
select
  o.id as order_id,
  o.order_no,
  o.payment_status,
  o.status as order_status,
  o.production_approved,
  public.icetak_order_component_readiness(o.id) as component_readiness,
  public.icetak_order_is_production_ready(o) as production_ready
from public.orders o;