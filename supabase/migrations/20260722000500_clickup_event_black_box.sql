create table if not exists public.clickup_integration_settings (
  setting_key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.clickup_integration_settings(setting_key,value)
values ('black_box', jsonb_build_object(
  'enabled',true,
  'mode','observe',
  'allowed_folder_id','7999455',
  'allowed_list_ids',jsonb_build_array('18375902','901612769752'),
  'debounce_seconds',5,
  'secret_sha256',''
))
on conflict(setting_key) do update set
  value=(excluded.value - 'secret_sha256') || jsonb_build_object(
    'secret_sha256',coalesce(public.clickup_integration_settings.value->>'secret_sha256','')
  ),
  updated_at=now();

create table if not exists public.clickup_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  webhook_id text,
  history_id text,
  event_type text not null default 'taskUpdated',
  task_id text not null,
  task_name text,
  folder_id text,
  list_id text,
  current_status text,
  changed_field text,
  before_value jsonb,
  after_value jsonb,
  webapp_order_id text,
  webapp_component_id text,
  task_updated_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  processing_status text not null default 'received',
  processing_result jsonb not null default '{}'::jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists clickup_webhook_events_task_received_idx
  on public.clickup_webhook_events(task_id,received_at desc);
create index if not exists clickup_webhook_events_processing_idx
  on public.clickup_webhook_events(processing_status,received_at);
create index if not exists clickup_webhook_events_component_idx
  on public.clickup_webhook_events(webapp_component_id)
  where webapp_component_id is not null and webapp_component_id<>'';

create table if not exists public.clickup_task_sync_queue (
  task_id text primary key,
  first_event_at timestamptz not null default now(),
  last_event_at timestamptz not null default now(),
  event_count integer not null default 1,
  run_after timestamptz not null default now(),
  status text not null default 'pending',
  attempts integer not null default 0,
  last_event_id uuid references public.clickup_webhook_events(id) on delete set null,
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
create index if not exists clickup_task_sync_queue_due_idx
  on public.clickup_task_sync_queue(status,run_after);

create table if not exists public.clickup_status_mapping (
  status_name text primary key,
  component_scope text not null default 'any',
  internal_workflow text not null,
  customer_label text not null,
  progress integer not null default 0 check(progress between 0 and 100),
  review_status text,
  is_terminal boolean not null default false,
  active boolean not null default true,
  notes text,
  updated_at timestamptz not null default now()
);

insert into public.clickup_status_mapping(
  status_name,component_scope,internal_workflow,customer_label,progress,review_status,is_terminal,notes
) values
  ('new custom','printed','design_new_custom','Design baru sedang disediakan',20,null,false,'Printed cake topper yang perlu design dari kosong'),
  ('design editing -topper','printed','design_editing_topper','Design sedang dikemaskini',25,null,false,'Printed topper edit ringan seperti nama atau umur'),
  ('design edible image','edible','design_edible','Design edible image sedang disediakan',25,null,false,'Edible image custom design'),
  ('wafer paper','wafer','design_wafer','Design wafer sedang disediakan',25,null,false,'Wafer paper design stage'),
  ('acrylic','acrylic','design_acrylic','Design acrylic sedang disediakan',25,null,false,'Acrylic paid order enters designer queue'),
  ('review','any','waiting_review','Design sedia untuk semakan',40,'waiting_customer_review',false,'Waiting customer review or internal review'),
  ('cake topper - printing','printed','printing','Cake topper sedang dicetak',70,null,false,'Printed topper production'),
  ('edible image -printing','edible','printing','Edible image sedang dicetak',70,null,false,'Edible printing'),
  ('wafer - printing','wafer','printing','Wafer sedang dicetak',70,null,false,'Wafer printing'),
  ('ready stock','printed','ready_stock','Item ready stock sedang disediakan',75,'not_required',false,'Printed topper already available on rack; no design process'),
  ('edible print ready stock','edible','ready_stock','Item ready stock sedang disediakan',75,'not_required',false,'Edible product already prepared; no design process'),
  ('print alamat','any','packing','Packing dan persediaan penghantaran',90,null,false,'Address or shipping label preparation'),
  ('lain2','any','manual_processing','Order sedang diproses',40,null,false,'Manual or uncategorized production work'),
  ('prospect','any','hold','Menunggu tindakan',10,null,false,'Hold or prospect status'),
  ('complete','any','production_complete','Production item selesai',100,null,true,'Production complete only; not customer delivered')
on conflict(status_name) do update set
  component_scope=excluded.component_scope,
  internal_workflow=excluded.internal_workflow,
  customer_label=excluded.customer_label,
  progress=excluded.progress,
  review_status=excluded.review_status,
  is_terminal=excluded.is_terminal,
  notes=excluded.notes,
  updated_at=now();

create or replace function public.clickup_extract_text(p_value jsonb)
returns text language sql immutable as $$
  select nullif(trim(coalesce(
    case jsonb_typeof(p_value)
      when 'string' then p_value #>> '{}'
      when 'number' then p_value #>> '{}'
      when 'boolean' then p_value #>> '{}'
      when 'object' then coalesce(p_value->>'status',p_value->>'name',p_value->>'value',p_value->>'label',p_value->>'id')
      else null
    end,''
  )), '');
$$;

create or replace function public.ingest_clickup_event(p_event jsonb)
returns jsonb language plpgsql security definer
set search_path=public,extensions,pg_temp as $$
declare
  v_task_id text;
  v_event_key text;
  v_event_id uuid;
  v_debounce integer:=5;
  v_folder_id text;
  v_allowed_folder text;
  v_settings jsonb;
begin
  select value into v_settings from public.clickup_integration_settings where setting_key='black_box';
  if coalesce((v_settings->>'enabled')::boolean,true)=false then raise exception 'clickup_black_box_disabled'; end if;

  v_task_id:=nullif(trim(coalesce(p_event->>'task_id',p_event#>>'{task,id}',p_event#>>'{taskId}')),'');
  if v_task_id is null then raise exception 'task_id_required'; end if;

  v_folder_id:=nullif(trim(coalesce(p_event->>'folder_id',p_event#>>'{task,folder,id}',p_event#>>'{folder,id}')),'');
  v_allowed_folder:=nullif(v_settings->>'allowed_folder_id','');
  if v_allowed_folder is not null and v_folder_id is not null and v_folder_id<>v_allowed_folder then
    return jsonb_build_object('accepted',false,'ignored',true,'reason','folder_not_allowed','task_id',v_task_id);
  end if;

  v_event_key:=nullif(trim(p_event->>'event_key'),'');
  if v_event_key is null then
    v_event_key:=encode(digest(concat_ws('|',
      coalesce(p_event->>'webhook_id',''),coalesce(p_event->>'history_id',''),
      coalesce(p_event->>'event_type','taskUpdated'),v_task_id,
      coalesce(p_event->>'changed_field',''),coalesce(p_event->'after_value','null'::jsonb)::text,
      coalesce(p_event->>'task_updated_at',''),p_event::text
    ),'sha256'),'hex');
  end if;

  insert into public.clickup_webhook_events(
    event_key,webhook_id,history_id,event_type,task_id,task_name,folder_id,list_id,current_status,
    changed_field,before_value,after_value,webapp_order_id,webapp_component_id,task_updated_at,
    raw_payload,processing_status
  ) values (
    v_event_key,nullif(p_event->>'webhook_id',''),nullif(p_event->>'history_id',''),
    coalesce(nullif(p_event->>'event_type',''),'taskUpdated'),v_task_id,
    nullif(coalesce(p_event->>'task_name',p_event#>>'{task,name}'),''),v_folder_id,
    nullif(coalesce(p_event->>'list_id',p_event#>>'{task,list,id}',p_event#>>'{list,id}'),''),
    nullif(coalesce(p_event->>'current_status',p_event#>>'{task,status,status}',p_event#>>'{task,status}'),''),
    nullif(coalesce(p_event->>'changed_field',p_event->>'field'),''),p_event->'before_value',p_event->'after_value',
    nullif(p_event->>'webapp_order_id',''),nullif(p_event->>'webapp_component_id',''),
    case
      when nullif(p_event->>'task_updated_at','') is null then null
      when p_event->>'task_updated_at' ~ '^[0-9]{13}$' then to_timestamp((p_event->>'task_updated_at')::numeric/1000)
      when p_event->>'task_updated_at' ~ '^[0-9]{10}$' then to_timestamp((p_event->>'task_updated_at')::numeric)
      else (p_event->>'task_updated_at')::timestamptz
    end,
    coalesce(p_event->'raw_payload',p_event),'received'
  ) on conflict(event_key) do nothing returning id into v_event_id;

  if v_event_id is null then
    select id into v_event_id from public.clickup_webhook_events where event_key=v_event_key;
    return jsonb_build_object('accepted',true,'duplicate',true,'event_id',v_event_id,'task_id',v_task_id);
  end if;

  v_debounce:=greatest(0,coalesce((v_settings->>'debounce_seconds')::integer,5));
  insert into public.clickup_task_sync_queue(task_id,first_event_at,last_event_at,event_count,run_after,status,last_event_id,updated_at)
  values(v_task_id,now(),now(),1,now()+make_interval(secs=>v_debounce),'pending',v_event_id,now())
  on conflict(task_id) do update set
    last_event_at=now(),event_count=public.clickup_task_sync_queue.event_count+1,
    run_after=now()+make_interval(secs=>v_debounce),status='pending',last_event_id=excluded.last_event_id,
    locked_at=null,processed_at=null,last_error=null,updated_at=now();

  update public.clickup_webhook_events set processing_status='queued' where id=v_event_id;
  return jsonb_build_object('accepted',true,'duplicate',false,'event_id',v_event_id,'task_id',v_task_id,'queued',true);
end;
$$;
revoke all on function public.ingest_clickup_event(jsonb) from public;
grant execute on function public.ingest_clickup_event(jsonb) to service_role;

create or replace function public.process_clickup_task_events(p_task_id text)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  v_settings jsonb;
  v_mode text:='observe';
  v_mapping_id uuid;
  v_order_id uuid;
  v_component_id uuid;
  v_item_id uuid;
  v_status_text text;
  v_mapped public.clickup_status_mapping%rowtype;
  v_event public.clickup_webhook_events%rowtype;
  v_processed integer:=0;
  v_ignored integer:=0;
  v_applied integer:=0;
  v_result jsonb;
begin
  select value into v_settings from public.clickup_integration_settings where setting_key='black_box';
  v_mode:=coalesce(nullif(v_settings->>'mode',''),'observe');

  select ct.id,ct.order_id,ct.component_id,ct.order_item_id
  into v_mapping_id,v_order_id,v_component_id,v_item_id
  from public.clickup_tasks ct where ct.clickup_task_id=p_task_id
  order by ct.updated_at desc limit 1;

  if v_component_id is null then
    select pc.order_id,pc.id,pc.order_item_id into v_order_id,v_component_id,v_item_id
    from public.production_components pc where pc.clickup_task_id=p_task_id
    order by pc.updated_at desc limit 1;
  end if;

  for v_event in
    select * from public.clickup_webhook_events
    where task_id=p_task_id and processing_status in ('received','queued','retry')
    order by received_at,id for update skip locked
  loop
    begin
      if v_component_id is null then
        update public.clickup_webhook_events set
          processing_status='ignored_unlinked',
          processing_result=jsonb_build_object('mode',v_mode,'reason','task_not_linked','webapp_order_id',v_event.webapp_order_id,'webapp_component_id',v_event.webapp_component_id),
          processed_at=now(),error_message=null
        where id=v_event.id;
        v_ignored:=v_ignored+1;
        continue;
      end if;

      v_status_text:=null;
      if lower(coalesce(v_event.changed_field,'')) in ('status','task_status') then
        v_status_text:=public.clickup_extract_text(v_event.after_value);
      end if;
      v_status_text:=coalesce(v_status_text,nullif(v_event.current_status,''));

      if v_status_text is not null then
        select * into v_mapped from public.clickup_status_mapping
        where lower(status_name)=lower(trim(v_status_text)) and active=true limit 1;
      else
        v_mapped:=null;
      end if;

      v_result:=jsonb_build_object(
        'mode',v_mode,'linked',true,'order_id',v_order_id,'component_id',v_component_id,
        'clickup_mapping_id',v_mapping_id,'status_received',v_status_text,
        'mapped',case when v_mapped.status_name is null then null else jsonb_build_object(
          'status_name',v_mapped.status_name,'internal_workflow',v_mapped.internal_workflow,
          'customer_label',v_mapped.customer_label,'progress',v_mapped.progress,
          'review_status',v_mapped.review_status,'is_terminal',v_mapped.is_terminal
        ) end,
        'list_id',v_event.list_id,'changed_field',v_event.changed_field
      );

      if v_mode='apply' then
        update public.clickup_tasks set
          status=coalesce(v_status_text,status),clickup_list_id=coalesce(nullif(v_event.list_id,''),clickup_list_id),
          last_synced_at=now(),updated_at=now()
        where clickup_task_id=p_task_id;
        update public.production_components set
          clickup_status=coalesce(v_status_text,clickup_status),
          workflow=case when v_mapped.status_name is not null then v_mapped.internal_workflow else workflow end,
          review_status=case when v_mapped.review_status is not null then v_mapped.review_status else review_status end,
          last_synced_at=now(),updated_at=now()
        where id=v_component_id;
        update public.clickup_webhook_events set processing_status='applied',processing_result=v_result,processed_at=now(),error_message=null where id=v_event.id;
        v_applied:=v_applied+1;
      else
        update public.clickup_webhook_events set processing_status='observed_linked',processing_result=v_result,processed_at=now(),error_message=null where id=v_event.id;
      end if;

      insert into public.clickup_sync_logs(task_id,order_id,action,status,request_payload,response_payload,error)
      values(v_mapping_id,v_order_id,'clickup_event_'||coalesce(v_event.changed_field,v_event.event_type),
        case when v_mode='apply' then 'applied' else 'observed' end,
        jsonb_build_object('event_id',v_event.id,'task_id',p_task_id,'raw',v_event.raw_payload),v_result,null);
      v_processed:=v_processed+1;
    exception when others then
      update public.clickup_webhook_events set processing_status='error',error_message=sqlerrm,processed_at=now() where id=v_event.id;
      insert into public.clickup_sync_logs(task_id,order_id,action,status,request_payload,response_payload,error)
      values(v_mapping_id,v_order_id,'clickup_event_process','error',jsonb_build_object('event_id',v_event.id,'task_id',p_task_id),'{}'::jsonb,sqlerrm);
    end;
  end loop;

  update public.clickup_task_sync_queue set status='done',processed_at=now(),locked_at=null,last_error=null,updated_at=now() where task_id=p_task_id;
  return jsonb_build_object('ok',true,'task_id',p_task_id,'mode',v_mode,'linked',v_component_id is not null,
    'processed',v_processed,'applied',v_applied,'ignored',v_ignored,'order_id',v_order_id,'component_id',v_component_id);
exception when others then
  update public.clickup_task_sync_queue set status='error',attempts=attempts+1,locked_at=null,last_error=sqlerrm,
    updated_at=now(),run_after=now()+interval '1 minute' where task_id=p_task_id;
  return jsonb_build_object('ok',false,'task_id',p_task_id,'error',sqlerrm);
end;
$$;
revoke all on function public.process_clickup_task_events(text) from public;
grant execute on function public.process_clickup_task_events(text) to service_role;

create or replace function public.process_clickup_sync_queue(p_limit integer default 100)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  v_row record;
  v_count integer:=0;
  v_results jsonb:='[]'::jsonb;
begin
  for v_row in
    select task_id from public.clickup_task_sync_queue
    where status in ('pending','error') and run_after<=now()
    order by run_after limit greatest(1,least(coalesce(p_limit,100),500))
    for update skip locked
  loop
    update public.clickup_task_sync_queue set status='processing',locked_at=now(),attempts=attempts+1,updated_at=now() where task_id=v_row.task_id;
    v_results:=v_results||jsonb_build_array(public.process_clickup_task_events(v_row.task_id));
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('ok',true,'processed_tasks',v_count,'results',v_results);
end;
$$;
revoke all on function public.process_clickup_sync_queue(integer) from public;
grant execute on function public.process_clickup_sync_queue(integer) to service_role;

alter table public.clickup_integration_settings enable row level security;
alter table public.clickup_webhook_events enable row level security;
alter table public.clickup_task_sync_queue enable row level security;
alter table public.clickup_status_mapping enable row level security;
revoke all on public.clickup_integration_settings from anon,authenticated;
revoke all on public.clickup_webhook_events from anon,authenticated;
revoke all on public.clickup_task_sync_queue from anon,authenticated;
revoke all on public.clickup_status_mapping from anon,authenticated;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='clickup-black-box-processor' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('clickup-black-box-processor','* * * * *','select public.process_clickup_sync_queue(100);');
end $$;
