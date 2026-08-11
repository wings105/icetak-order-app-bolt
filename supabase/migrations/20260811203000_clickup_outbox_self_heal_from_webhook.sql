create index if not exists idx_clickup_webhook_events_component_received
  on public.clickup_webhook_events (webapp_component_id, received_at)
  where webapp_component_id is not null and task_id is not null;

create or replace function public.icetak_reconcile_clickup_webhook_backfill(p_order_id uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select distinct on (pc.id)
      pc.order_id,
      pc.id as component_id,
      e.task_id,
      coalesce(nullif(e.current_status,''),'') as current_status,
      coalesce(nullif(e.raw_payload#>>'{task,list,id}',''),'18375902') as list_id,
      e.received_at
    from public.production_components pc
    join public.clickup_webhook_events e
      on e.webapp_component_id = pc.id::text
    where pc.clickup_task_id is null
      and nullif(e.task_id,'') is not null
      and (p_order_id is null or pc.order_id = p_order_id)
    order by pc.id, e.received_at asc, e.id asc
  loop
    begin
      perform public.link_clickup_production_task(
        r.order_id::text,
        r.component_id,
        r.task_id,
        r.list_id,
        'https://app.clickup.com/t/' || r.task_id,
        nullif(r.current_status,'')
      );
      v_count := v_count + 1;
    exception when others then
      raise warning 'clickup webhook backfill skipped component %, task %: %', r.component_id, r.task_id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

create or replace function public.icetak_link_clickup_from_webhook_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_component_id uuid;
  v_order_id uuid;
  v_list_id text;
begin
  if nullif(new.task_id,'') is null or nullif(new.webapp_component_id,'') is null then
    return new;
  end if;

  begin
    v_component_id := new.webapp_component_id::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  select pc.order_id
    into v_order_id
  from public.production_components pc
  where pc.id = v_component_id
    and pc.clickup_task_id is null;

  if v_order_id is null then
    return new;
  end if;

  v_list_id := coalesce(nullif(new.raw_payload#>>'{task,list,id}',''),'18375902');

  begin
    perform public.link_clickup_production_task(
      v_order_id::text,
      v_component_id,
      new.task_id,
      v_list_id,
      'https://app.clickup.com/t/' || new.task_id,
      nullif(new.current_status,'')
    );
  exception when others then
    raise warning 'clickup webhook auto-link skipped component %, task %: %', v_component_id, new.task_id, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_clickup_webhook_auto_link_component on public.clickup_webhook_events;
create trigger trg_clickup_webhook_auto_link_component
after insert or update of task_id, webapp_component_id, current_status
on public.clickup_webhook_events
for each row
execute function public.icetak_link_clickup_from_webhook_trigger();

create or replace function public.claim_clickup_production_outbox(p_limit integer default 10)
returns setof public.integration_outbox
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  perform public.icetak_reconcile_clickup_webhook_backfill(null);

  update public.integration_outbox o
  set status='processed',
      processed_at=coalesce(o.processed_at,now()),
      sent_at=coalesce(o.sent_at,now()),
      locked_at=null,
      last_error=null,
      error=null
  where o.provider='activepieces'
    and o.event_type='clickup.production.create'
    and o.status in ('pending','retry','processing')
    and not exists(
      select 1
      from public.production_components pc
      where pc.order_id=o.order_id
        and pc.clickup_task_id is null
    );

  update public.integration_outbox
  set status='retry',
      locked_at=null,
      next_attempt_at=now(),
      last_error='stale_processing_lease_recovered'
  where provider='activepieces'
    and event_type='clickup.production.create'
    and status='processing'
    and locked_at < now()-interval '3 minutes';

  return query
  with picked as (
    select id
    from public.integration_outbox
    where provider='activepieces'
      and event_type='clickup.production.create'
      and status in ('pending','retry')
      and coalesce(next_attempt_at,now()) <= now()
    order by created_at
    limit greatest(1,least(coalesce(p_limit,10),50))
    for update skip locked
  )
  update public.integration_outbox o
  set status='processing',
      locked_at=now(),
      attempts=coalesce(o.attempts,0)+1,
      payload=public.icetak_clickup_production_payload_data(o.order_id)
  from picked
  where o.id=picked.id
  returning o.*;
end;
$$;
