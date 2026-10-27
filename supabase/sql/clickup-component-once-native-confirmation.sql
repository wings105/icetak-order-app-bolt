
create table if not exists clickup_gate.component_dispatches(
 component_id uuid primary key references public.production_components(id),
 order_id uuid not null references public.orders(id),
 outbox_id uuid not null references public.integration_outbox(id),
 request_id uuid,
 claimed_at timestamptz not null default now()
);
alter table clickup_gate.component_dispatches enable row level security;
revoke all on clickup_gate.component_dispatches from public,anon,authenticated;
grant all on clickup_gate.component_dispatches to service_role;
insert into clickup_gate.component_dispatches(component_id,order_id,outbox_id)
 select pc.id,pc.order_id,b.id from public.production_components pc
 join lateral(select id from public.integration_outbox where order_id=pc.order_id and provider='activepieces' and event_type='clickup.production.create' order by created_at limit 1) b on true
 where pc.clickup_task_id is not null
 on conflict(component_id) do nothing;

CREATE OR REPLACE FUNCTION public.link_clickup_production_task(p_order_reference text, p_component_id uuid, p_clickup_task_id text, p_clickup_list_id text DEFAULT '18375902'::text, p_task_url text DEFAULT NULL::text, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order_id uuid;
  v_item_id uuid;
  v_existing_task_id text;
  v_mapping public.clickup_tasks%rowtype;
  v_replay jsonb;
  v_remaining integer := 0;
begin
  if nullif(trim(p_clickup_task_id),'') is null then
    raise exception 'clickup_task_id_required';
  end if;

  v_order_id:=public.resolve_shipping_order_reference(p_order_reference);
  if v_order_id is null then raise exception 'order_not_found'; end if;

  select order_item_id,clickup_task_id into v_item_id,v_existing_task_id
  from public.production_components
  where id=p_component_id and order_id=v_order_id for update;
  if not found then raise exception 'component_not_found_for_order'; end if;
  if v_existing_task_id is not null and v_existing_task_id<>trim(p_clickup_task_id) then
    raise exception 'component_already_linked_to_task:%',v_existing_task_id;
  end if;

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
$function$;


CREATE OR REPLACE FUNCTION public.icetak_clickup_production_outbox_watchdog()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_reconciled integer := 0;
  v_processed integer := 0;
  v_failed integer := 0;
  v_released integer := 0;
begin
  v_reconciled := public.icetak_reconcile_clickup_webhook_backfill(null);

  update public.integration_outbox o
  set status='processed',
      processed_at=coalesce(o.processed_at,now()),
      sent_at=coalesce(o.sent_at,now()),
      locked_at=null,
      next_attempt_at=null,
      last_error=null,
      error=null
  where o.provider='activepieces'
    and o.event_type='clickup.production.create'
    and o.status in ('pending','retry','processing','failed')
    and not exists(
      select 1
      from public.production_components pc
      where pc.order_id=o.order_id
        and pc.clickup_task_id is null
    );
  get diagnostics v_processed = row_count;

  update public.integration_outbox
  set status='failed',
      locked_at=null,
      next_attempt_at=null,
      last_error='activepieces_stale_after_max_attempts',
      error='Activepieces did not finish ClickUp create/link after repeated 3-minute leases'
  where provider='activepieces'
    and event_type='clickup.production.create'
    and status='processing'
    and locked_at < now()-interval '3 minutes'
    and coalesce(attempts,0) >= 5;
  get diagnostics v_failed = row_count;

  update public.integration_outbox
  set status='failed',
      locked_at=null,
      next_attempt_at=null,
      last_error='creation_confirmation_missing_reconcile_required',
      error=null
  where provider='activepieces'
    and event_type='clickup.production.create'
    and status='processing'
    and locked_at < now()-interval '3 minutes'
    and coalesce(attempts,0) < 5;
  get diagnostics v_released = row_count;

  return jsonb_build_object(
    'ok',true,
    'reconciled_from_clickup_webhook',v_reconciled,
    'marked_processed',v_processed,
    'failed_stale_processing',v_failed,
    'released_stale_processing',v_released,
    'at',now()
  );
end;
$function$;


create or replace function public.claim_clickup_production_outbox_event(
 p_event_id uuid,p_expected_missing_count integer default null,p_request_id uuid default null
) returns setof public.integration_outbox language plpgsql security definer
set search_path=public,pg_temp as $fn$
declare v_job public.integration_outbox%rowtype; v_component uuid; v_missing integer;
begin
 select * into v_job from public.integration_outbox where id=p_event_id
 and provider='activepieces' and event_type='clickup.production.create'
 and status in ('pending','retry') and coalesce(next_attempt_at,now())<=now()
 for update skip locked;
 if not found then return; end if;
 select count(*) into v_missing from public.production_components
 where order_id=v_job.order_id and clickup_task_id is null;
 if v_missing=0 or (p_expected_missing_count is not null and v_missing<>p_expected_missing_count) then return; end if;
 select id into v_component from public.production_components
 where order_id=v_job.order_id and clickup_task_id is null
 order by set_index asc nulls last,created_at asc,id asc limit 1;
 insert into clickup_gate.component_dispatches(component_id,order_id,outbox_id,request_id)
 values(v_component,v_job.order_id,v_job.id,p_request_id) on conflict(component_id) do nothing;
 if not found then
   update public.integration_outbox set status='failed',locked_at=null,next_attempt_at=null,
   last_error='component_already_dispatched_awaiting_confirmation',
   error='Reconcile the existing ClickUp task before retrying this component' where id=v_job.id;
   return;
 end if;
 return query update public.integration_outbox o set status='processing',locked_at=now(),
 next_attempt_at=null,last_error=null,error=null,attempts=coalesce(o.attempts,0)+1,
 payload=coalesce(public.icetak_clickup_production_payload_data(o.order_id),'{}'::jsonb)
 ||jsonb_build_object('claim_request_id',p_request_id,'claim_strategy','component_once_v4','dispatched_component_id',v_component)
 where id=v_job.id returning o.*;
end $fn$;

create or replace function public.claim_clickup_production_outbox(p_limit integer default 10)
returns setof public.integration_outbox language plpgsql security definer set search_path=public,pg_temp as $fn$
declare v_id uuid;
begin
 for v_id in select id from public.peek_clickup_production_outbox(p_limit)
 loop return query select * from public.claim_clickup_production_outbox_event(v_id,null,null); end loop;
end $fn$;

create or replace function public.icetak_accept_verified_clickup_snapshot(p_task jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
 v_task text:=nullif(p_task->>'id','');
 v_list text:=p_task#>>'{list,id}';
 v_order text; v_component text; v_pc public.production_components%rowtype;
 v_ingest jsonb; v_link jsonb;
begin
 if v_task is null or v_list not in ('18375902','901612769752') or v_list is null then
  return jsonb_build_object('accepted',false,'reason','task_list_not_allowed');
 end if;
 select f->>'value' into v_order from jsonb_array_elements(coalesce(p_task->'custom_fields','[]')) f where f->>'id'='1bf24635-5405-47ec-9985-4b4d21f9c937';
 select f->>'value' into v_component from jsonb_array_elements(coalesce(p_task->'custom_fields','[]')) f where f->>'id'='1aa98168-cf59-4f52-a892-3acce4977e52';
 if nullif(v_component,'') is not null then
  if v_component !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   return jsonb_build_object('accepted',false,'reason','invalid_component');
  end if;
  select * into v_pc from public.production_components where id=v_component::uuid for update;
  if not found or v_pc.order_id::text is distinct from v_order then
   return jsonb_build_object('accepted',false,'reason','component_order_mismatch');
  end if;
  if v_pc.clickup_task_id is not null and v_pc.clickup_task_id<>v_task then
   return jsonb_build_object('accepted',false,'reason','duplicate_task','canonical_task_id',v_pc.clickup_task_id);
  end if;
  v_link:=public.link_clickup_production_task(v_order,v_component::uuid,v_task,v_list,'https://app.clickup.com/t/'||v_task,p_task#>>'{status,status}');
 end if;
 v_ingest:=public.ingest_clickup_event(jsonb_build_object(
  'event_key','native-live:'||v_task||':'||coalesce(p_task->>'date_updated','')||':'||md5(p_task::text),
  'event_type','taskUpdated','task_id',v_task,'task_name',p_task->>'name',
  'list_id',v_list,'folder_id',p_task#>>'{folder,id}','current_status',p_task#>>'{status,status}',
  'webapp_order_id',v_order,'webapp_component_id',v_component,
  'task_updated_at',p_task->>'date_updated','raw_payload',jsonb_build_object('task',p_task,'source','verified_native_clickup_api')
 ));
 perform public.process_clickup_task_events(v_task);
 return jsonb_build_object('accepted',true,'linked',v_link,'event',v_ingest);
end $fn$;

revoke execute on function public.icetak_accept_verified_clickup_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_accept_verified_clickup_snapshot(jsonb) to service_role;
revoke execute on function public.claim_clickup_production_outbox_event(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_clickup_production_outbox_event(uuid,integer,uuid) to service_role;
revoke execute on function public.claim_clickup_production_outbox(integer) from public,anon,authenticated;
grant execute on function public.claim_clickup_production_outbox(integer) to service_role;
revoke execute on function public.icetak_clickup_production_outbox_watchdog() from public,anon,authenticated;
grant execute on function public.icetak_clickup_production_outbox_watchdog() to service_role;
