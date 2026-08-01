alter table public.production_components
  add column if not exists customer_stage text,
  add column if not exists customer_label text,
  add column if not exists progress_percent integer;

do $$ begin
  alter table public.production_components
    add constraint production_components_progress_percent_check
    check (progress_percent is null or progress_percent between 0 and 100);
exception when duplicate_object then null;
end $$;

create or replace function public.icetak_component_customer_projection(
  p_component_type text,
  p_workflow text,
  p_clickup_status text,
  p_review_required boolean,
  p_review_status text,
  p_delivery text
)
returns table(customer_stage text,customer_label text,progress_percent integer)
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_map public.clickup_status_mapping%rowtype;
  v_workflow text;
  v_review text:=lower(trim(coalesce(p_review_status,'')));
  v_delivery text:=lower(trim(coalesce(p_delivery,'')));
begin
  if nullif(trim(coalesce(p_clickup_status,'')),'') is not null then
    select m.* into v_map
    from public.clickup_status_mapping m
    where m.active=true
      and lower(trim(m.status_name))=lower(trim(p_clickup_status))
      and (
        lower(coalesce(m.component_scope,'any'))='any'
        or lower(trim(coalesce(p_component_type,'')))=lower(trim(m.component_scope))
        or lower(trim(coalesce(p_component_type,''))) like '%'||lower(trim(m.component_scope))||'%'
      )
    order by case when lower(coalesce(m.component_scope,'any'))='any' then 1 else 0 end
    limit 1;
  end if;

  v_workflow:=lower(regexp_replace(
    trim(coalesce(v_map.internal_workflow,p_workflow,'order_received')),
    '[\s-]+','_','g'
  ));

  if v_workflow='delivered' then
    customer_stage:='Delivered';
  elsif v_workflow in ('production_complete','complete','completed','ready','ready_to_pickup','ready_for_pickup') then
    customer_stage:=case when v_delivery like '%pickup%' then 'Ready' else 'Finishing' end;
  elsif v_workflow in ('packing','ready_stock','finishing','quality_check','qc','packed') then
    customer_stage:='Finishing';
  elsif v_workflow in ('printing','manual_processing','production','in_production','production_started','cutting','print','cut') then
    customer_stage:='Production';
  elsif v_workflow in ('approved','design_approved','customer_approved') or v_review='approved' then
    customer_stage:='Approved';
  elsif v_workflow in ('waiting_review','review_pending','pending_review','customer_review','awaiting_approval')
     or v_review in ('waiting_customer_review','waiting_review') then
    customer_stage:='Waiting Review';
  elsif v_workflow in (
    'design_new_custom','design_acrylic','design_edible','design_editing_topper','design_wafer',
    'design_pending','design_editing','designing','drafting','edit_requested','revision_requested'
  ) or v_review='edit_requested' then
    customer_stage:='Design Editing';
  else
    customer_stage:='Order Received';
  end if;

  customer_label:=coalesce(nullif(v_map.customer_label,''),case customer_stage
    when 'Order Received' then 'Order diterima'
    when 'Design Editing' then 'Design sedang disediakan'
    when 'Waiting Review' then 'Design sedia untuk semakan'
    when 'Approved' then 'Design telah diluluskan'
    when 'Production' then 'Item sedang diproses'
    when 'Finishing' then case
      when v_workflow in ('production_complete','complete','completed') then 'Production selesai, menunggu penghantaran'
      else 'Finishing dan packing'
    end
    when 'Ready' then 'Sedia untuk pickup'
    when 'Delivered' then 'Order selesai'
    else customer_stage
  end);

  progress_percent:=greatest(0,least(100,case
    when customer_stage='Finishing' and v_workflow in ('production_complete','complete','completed') then 95
    else coalesce(v_map.progress,case customer_stage
      when 'Order Received' then 10
      when 'Design Editing' then 25
      when 'Waiting Review' then 40
      when 'Approved' then 55
      when 'Production' then 70
      when 'Finishing' then 90
      when 'Ready' then 100
      when 'Delivered' then 100
      else 0
    end)
  end));
  return next;
end;
$$;

create or replace function public.icetak_sync_component_customer_projection()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_delivery text;
  v_projection record;
begin
  select coalesce(o.delivery_method,o.delivery,'') into v_delivery
  from public.orders o where o.id=new.order_id;

  select * into v_projection
  from public.icetak_component_customer_projection(
    new.component_type,
    new.workflow,
    new.clickup_status,
    new.review_required,
    new.review_status,
    v_delivery
  );
  new.customer_stage:=v_projection.customer_stage;
  new.customer_label:=v_projection.customer_label;
  new.progress_percent:=v_projection.progress_percent;
  return new;
end;
$$;

drop trigger if exists trg_sync_component_customer_projection on public.production_components;
create trigger trg_sync_component_customer_projection
before insert or update of order_id,component_type,workflow,clickup_status,review_required,review_status
on public.production_components
for each row execute function public.icetak_sync_component_customer_projection();

update public.production_components set workflow=workflow;

create or replace function public.process_clickup_task_events(p_task_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_settings jsonb;
  v_mode text:='observe';
  v_mapping_id uuid;
  v_order_id uuid;
  v_component_id uuid;
  v_item_id uuid;
  v_component_type text;
  v_component_workflow text;
  v_component_review_required boolean;
  v_component_review_status text;
  v_delivery text;
  v_status_text text;
  v_mapped public.clickup_status_mapping%rowtype;
  v_event public.clickup_webhook_events%rowtype;
  v_processed integer:=0;
  v_ignored integer:=0;
  v_applied integer:=0;
  v_result jsonb;
  v_candidate uuid;
  v_projection record;
begin
  select value into v_settings
  from public.clickup_integration_settings
  where setting_key='black_box';
  v_mode:=coalesce(nullif(v_settings->>'mode',''),'observe');

  select ct.id,ct.order_id,ct.component_id,ct.order_item_id
  into v_mapping_id,v_order_id,v_component_id,v_item_id
  from public.clickup_tasks ct
  where ct.clickup_task_id=p_task_id
  order by ct.updated_at desc
  limit 1;

  if v_component_id is null then
    select pc.order_id,pc.id,pc.order_item_id
    into v_order_id,v_component_id,v_item_id
    from public.production_components pc
    where pc.clickup_task_id=p_task_id
    order by pc.updated_at desc
    limit 1;
  end if;

  if v_component_id is null then
    select case
      when e.webapp_component_id ~* '^[0-9a-f-]{36}$' then e.webapp_component_id::uuid
      else null
    end
    into v_candidate
    from public.clickup_webhook_events e
    where e.task_id=p_task_id and e.webapp_component_id is not null
    order by e.received_at desc
    limit 1;

    if v_candidate is not null
       and not exists(
         select 1 from public.clickup_tasks ct
         where ct.clickup_task_id=p_task_id and ct.component_id is distinct from v_candidate
       ) then
      select pc.order_id,pc.id,pc.order_item_id
      into v_order_id,v_component_id,v_item_id
      from public.production_components pc
      where pc.id=v_candidate;
    end if;
  end if;

  if v_component_id is not null and v_mapping_id is null then
    insert into public.clickup_tasks(
      order_id,order_item_id,component_id,clickup_task_id,clickup_list_id,last_synced_at,updated_at
    )
    values(
      v_order_id,v_item_id,v_component_id,p_task_id,
      (select list_id from public.clickup_webhook_events where task_id=p_task_id order by received_at desc limit 1),
      now(),now()
    )
    on conflict(component_id) where component_id is not null do update set
      clickup_task_id=excluded.clickup_task_id,
      clickup_list_id=coalesce(excluded.clickup_list_id,public.clickup_tasks.clickup_list_id),
      last_synced_at=now(),
      updated_at=now()
    returning id into v_mapping_id;

    update public.production_components
    set clickup_task_id=p_task_id,last_synced_at=now(),updated_at=now()
    where id=v_component_id;
  end if;

  if v_component_id is not null then
    select pc.component_type,pc.workflow,pc.review_required,pc.review_status,
           coalesce(o.delivery_method,o.delivery,'')
    into v_component_type,v_component_workflow,v_component_review_required,
         v_component_review_status,v_delivery
    from public.production_components pc
    join public.orders o on o.id=pc.order_id
    where pc.id=v_component_id;
  end if;

  for v_event in
    select *
    from public.clickup_webhook_events
    where task_id=p_task_id and processing_status in ('received','queued','retry')
    order by received_at,id
    for update skip locked
  loop
    begin
      if v_component_id is null then
        update public.clickup_webhook_events
        set processing_status='ignored_unlinked',
            processing_result=jsonb_build_object(
              'mode',v_mode,
              'reason','task_not_linked',
              'webapp_order_id',v_event.webapp_order_id,
              'webapp_component_id',v_event.webapp_component_id
            ),
            processed_at=now(),
            error_message=null
        where id=v_event.id;
        v_ignored:=v_ignored+1;
        continue;
      end if;

      v_status_text:=null;
      if lower(coalesce(v_event.changed_field,'')) in ('status','task_status') then
        v_status_text:=public.clickup_extract_text(v_event.after_value);
      end if;
      v_status_text:=coalesce(v_status_text,nullif(v_event.current_status,''));
      v_mapped:=null;

      if v_status_text is not null then
        select m.* into v_mapped
        from public.clickup_status_mapping m
        where lower(trim(m.status_name))=lower(trim(v_status_text))
          and m.active=true
          and (
            lower(coalesce(m.component_scope,'any'))='any'
            or lower(coalesce(v_component_type,''))=lower(m.component_scope)
            or lower(coalesce(v_component_type,'')) like '%'||lower(m.component_scope)||'%'
          )
        order by case when lower(coalesce(m.component_scope,'any'))='any' then 1 else 0 end
        limit 1;
      end if;

      select * into v_projection
      from public.icetak_component_customer_projection(
        v_component_type,
        coalesce(v_mapped.internal_workflow,v_component_workflow),
        v_status_text,
        v_component_review_required,
        coalesce(v_mapped.review_status,v_component_review_status),
        v_delivery
      );

      v_result:=jsonb_build_object(
        'mode',v_mode,
        'linked',true,
        'order_id',v_order_id,
        'component_id',v_component_id,
        'clickup_mapping_id',v_mapping_id,
        'status_received',v_status_text,
        'mapped',case when v_mapped.status_name is null then null else jsonb_build_object(
          'status_name',v_mapped.status_name,
          'internal_workflow',v_mapped.internal_workflow,
          'customer_label',v_mapped.customer_label,
          'progress',v_mapped.progress,
          'review_status',v_mapped.review_status,
          'is_terminal',v_mapped.is_terminal
        ) end,
        'customer_projection',jsonb_build_object(
          'stage',v_projection.customer_stage,
          'label',v_projection.customer_label,
          'progress',v_projection.progress_percent
        ),
        'list_id',v_event.list_id,
        'changed_field',v_event.changed_field
      );

      if v_mode='apply' then
        update public.clickup_tasks
        set status=coalesce(v_status_text,status),
            clickup_list_id=coalesce(nullif(v_event.list_id,''),clickup_list_id),
            last_synced_at=now(),
            updated_at=now()
        where clickup_task_id=p_task_id;

        if v_mapped.status_name is not null then
          update public.production_components
          set clickup_status=coalesce(v_status_text,clickup_status),
              workflow=v_projection.customer_stage,
              review_status=coalesce(v_mapped.review_status,review_status),
              customer_stage=v_projection.customer_stage,
              customer_label=v_projection.customer_label,
              progress_percent=v_projection.progress_percent,
              last_synced_at=now(),
              updated_at=now()
          where id=v_component_id;
        elsif v_status_text is not null then
          update public.production_components
          set clickup_status=v_status_text,last_synced_at=now(),updated_at=now()
          where id=v_component_id;
        end if;

        update public.clickup_webhook_events
        set processing_status='applied',processing_result=v_result,processed_at=now(),error_message=null
        where id=v_event.id;
        v_applied:=v_applied+1;
      else
        update public.clickup_webhook_events
        set processing_status='observed_linked',processing_result=v_result,processed_at=now(),error_message=null
        where id=v_event.id;
      end if;

      insert into public.clickup_sync_logs(
        task_id,order_id,action,status,request_payload,response_payload,error
      )
      values(
        v_mapping_id,
        v_order_id,
        'clickup_event_'||coalesce(v_event.changed_field,v_event.event_type),
        case when v_mode='apply' then 'applied' else 'observed' end,
        jsonb_build_object('event_id',v_event.id,'task_id',p_task_id,'raw',v_event.raw_payload),
        v_result,
        null
      );
      v_processed:=v_processed+1;
    exception when others then
      update public.clickup_webhook_events
      set processing_status='error',error_message=sqlerrm,processed_at=now()
      where id=v_event.id;
    end;
  end loop;

  update public.clickup_task_sync_queue
  set status='done',processed_at=now(),locked_at=null,last_error=null,updated_at=now()
  where task_id=p_task_id;

  return jsonb_build_object(
    'ok',true,
    'task_id',p_task_id,
    'mode',v_mode,
    'linked',v_component_id is not null,
    'processed',v_processed,
    'applied',v_applied,
    'ignored',v_ignored,
    'order_id',v_order_id,
    'component_id',v_component_id
  );
exception when others then
  update public.clickup_task_sync_queue
  set status='error',attempts=attempts+1,locked_at=null,last_error=sqlerrm,
      updated_at=now(),run_after=now()+interval '1 minute'
  where task_id=p_task_id;
  return jsonb_build_object('ok',false,'task_id',p_task_id,'error',sqlerrm);
end;
$$;

create or replace function public.replay_clickup_observed_events(
  p_task_id text default null,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_count integer:=0;
  v_tasks integer:=0;
  v_task record;
begin
  with selected as (
    select id,task_id
    from public.clickup_webhook_events
    where processing_status='observed_linked'
      and (p_task_id is null or task_id=trim(p_task_id))
      and exists(
        select 1 from public.clickup_tasks ct
        where ct.clickup_task_id=clickup_webhook_events.task_id
      )
    order by received_at
    limit greatest(1,least(coalesce(p_limit,1000),5000))
  )
  update public.clickup_webhook_events e
  set processing_status='retry',
      processed_at=null,
      error_message=null,
      processing_result=coalesce(e.processing_result,'{}'::jsonb)
        || jsonb_build_object('replay_requested_at',now())
  from selected s
  where e.id=s.id;
  get diagnostics v_count=row_count;

  for v_task in
    select task_id,count(*) event_count
    from public.clickup_webhook_events
    where processing_status='retry'
      and (p_task_id is null or task_id=trim(p_task_id))
    group by task_id
  loop
    insert into public.clickup_task_sync_queue(
      task_id,first_event_at,last_event_at,event_count,run_after,status,updated_at
    )
    values(v_task.task_id,now(),now(),v_task.event_count,now(),'pending',now())
    on conflict(task_id) do update set
      last_event_at=now(),
      event_count=public.clickup_task_sync_queue.event_count+excluded.event_count,
      run_after=now(),
      status='pending',
      locked_at=null,
      processed_at=null,
      last_error=null,
      updated_at=now();
    v_tasks:=v_tasks+1;
  end loop;

  return jsonb_build_object('ok',true,'events_requeued',v_count,'tasks_requeued',v_tasks);
end;
$$;

revoke all on function public.icetak_component_customer_projection(text,text,text,boolean,text,text)
  from public,anon,authenticated;
revoke all on function public.replay_clickup_observed_events(text,integer)
  from public,anon,authenticated;
grant execute on function public.icetak_component_customer_projection(text,text,text,boolean,text,text)
  to service_role;
grant execute on function public.replay_clickup_observed_events(text,integer)
  to service_role;

insert into public.system_settings(key,value)
values('order_app','{}'::jsonb)
on conflict(key) do nothing;

delete from public.system_settings
where key='public_app' and coalesce(value->>'base_url','') ilike '%appdeploy%';

create or replace function public.icetak_public_app_base_url()
returns text
language sql
stable
security definer
set search_path to 'public','pg_temp'
as $$
  select nullif(rtrim(coalesce(
    (select value->>'base_url' from public.system_settings where key='order_app' limit 1),
    ''
  ),'/'),'');
$$;

create or replace function public.icetak_order_links(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_temp'
as $$
  with target as (
    select o.*,public.icetak_public_app_base_url() base_url
    from public.orders o where o.id=p_order_id
  )
  select coalesce((
    select jsonb_build_object(
      'order_path','/?order='||t.public_token,
      'customer_history_path','/?c='||coalesce(t.customer_token,''),
      'admin_order_path','/?admin=1&order='||t.public_token,
      'order_link',case when t.base_url is null then null else t.base_url||'/?order='||t.public_token end,
      'customer_history_link',case when t.base_url is null then null else t.base_url||'/?c='||coalesce(t.customer_token,'') end,
      'admin_order_link',case when t.base_url is null then null else t.base_url||'/?admin=1&order='||t.public_token end,
      'components',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',pc.id,
          'label',pc.label,
          'customer_path','/?order='||t.public_token||'#component-'||pc.id::text,
          'system_path','/?admin=1&order='||t.public_token||'&component='||pc.id::text,
          'customer_link',case when t.base_url is null then null else t.base_url||'/?order='||t.public_token||'#component-'||pc.id::text end,
          'system_link',case when t.base_url is null then null else t.base_url||'/?admin=1&order='||t.public_token||'&component='||pc.id::text end,
          'clickup_task_id',pc.clickup_task_id,
          'clickup_status',pc.clickup_status
        ) order by pc.created_at,pc.id)
        from public.production_components pc where pc.order_id=t.id
      ),'[]'::jsonb)
    ) from target t
  ),'{}'::jsonb);
$$;
