-- Private derived observations only; canonical orders/work/approval remain untouched.
create schema if not exists task_detail_private;
revoke all on schema task_detail_private from public,anon,authenticated;
create table public.task_detail_automation (
 task_id text primary key, version integer not null default 0,
 data jsonb not null default '{}', last_checked_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.task_detail_automation_events (
 id bigint generated always as identity primary key, task_id text not null,
 version integer not null, data jsonb not null, created_at timestamptz not null default now(),
 unique(task_id,version)
);
create table task_detail_private.runtime (
 id boolean primary key default true check(id), enabled boolean not null default false,
 lease_id uuid, lease_until timestamptz, last_dispatch_at timestamptz,
 last_started_at timestamptz,last_finished_at timestamptz,last_result jsonb
);
insert into task_detail_private.runtime(id) values(true);
create table task_detail_private.order_signals (
 kind text not null, order_id uuid not null, reference text, signalled_at timestamptz not null default now(),
 primary key(kind,order_id)
);
alter table public.task_detail_automation enable row level security;
alter table public.task_detail_automation_events enable row level security;
alter table task_detail_private.runtime enable row level security;
alter table task_detail_private.order_signals enable row level security;
revoke all on public.task_detail_automation,public.task_detail_automation_events from public,anon,authenticated;
grant all on public.task_detail_automation,public.task_detail_automation_events to service_role;
grant usage,select on sequence public.task_detail_automation_events_id_seq to service_role;
grant usage on schema task_detail_private to service_role;
grant select,update on task_detail_private.runtime to service_role;
-- Token is generated and consumed entirely inside trusted server paths.
insert into public.private_runtime_settings(setting_key,setting_value)
 values('task_detail_worker_token',encode(extensions.gen_random_bytes(32),'hex')) on conflict(setting_key) do nothing;
create function public.icetak_task_detail_begin()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare run uuid:=gen_random_uuid(); tasks jsonb; total integer;
begin
 update task_detail_private.runtime set lease_id=run,lease_until=now()+interval '3 minutes',last_started_at=now()
 where id and enabled and (lease_until is null or lease_until<now());
 if not found then return jsonb_build_object('busy',true); end if;
 select jsonb_agg(to_jsonb(t)) into tasks from (
  select s.task_id,s.order_id,s.marketplace_order_id from public.ai_clickup_work_snapshots s
  left join public.task_detail_automation a using(task_id)
  left join public.orders o on o.id=s.order_id left join public.marketplace_orders m on m.id=s.marketplace_order_id
  where s.list_id='18375902' and lower(trim(s.clickup_status)) not in ('lain2','prospect','complete','closed','cancelled','canceled')
   and lower(coalesce(m.current_status,o.status,'')) not in ('shipped','completed','cancelled','canceled','customer_collected','returned','refunded')
   and not exists(select 1 from public.clickup_webhook_events d where d.task_id=s.task_id and lower(d.event_type) in ('taskdeleted','task_deleted') and d.received_at>=s.observed_at)
  order by a.last_checked_at nulls first,s.source_updated_at desc limit 100
 ) t;
 select count(*) into total from public.ai_clickup_work_snapshots where list_id='18375902' and lower(trim(clickup_status)) not in ('lain2','prospect','complete','closed','cancelled','canceled');
 return jsonb_build_object('run_id',run,'tasks',coalesce(tasks,'[]'),'truncated',total>100);
end;$$;
create function public.icetak_task_detail_record(p_run uuid,p_task_id text,p_version integer,p_source_token text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.task_detail_automation; source jsonb; changed boolean;
begin
 if not exists(select 1 from task_detail_private.runtime where id and lease_id=p_run and lease_until>now()) then raise exception 'LEASE_EXPIRED'; end if;
 if jsonb_typeof(p_data)<>'object' or length(p_data::text)>120000 or p_data->>'status' not in ('ready','missing','review') or p_data->>'attention' not in ('none','question','change') then raise exception 'INVALID_OBSERVATION'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_task_id,26));
 source:=public.icetak_task_readiness_sources(jsonb_build_array(p_task_id))#>array['sources',p_task_id];
 if source->>'source_token' is distinct from p_source_token then raise exception 'SOURCE_CHANGED_REFRESH'; end if;
 select * into old from public.task_detail_automation where task_id=p_task_id for update;
 if coalesce(old.version,0)<>p_version then raise exception 'VERSION_CONFLICT_REFRESH'; end if;
 changed:=old.task_id is null or (old.data-'checked_at') is distinct from (p_data-'checked_at');
 if changed then
  insert into public.task_detail_automation(task_id,version,data,last_checked_at)
  values(p_task_id,coalesce(old.version,0)+1,p_data,now()) on conflict(task_id) do update
   set version=excluded.version,data=excluded.data,last_checked_at=now(),updated_at=now();
  insert into public.task_detail_automation_events(task_id,version,data) values(p_task_id,coalesce(old.version,0)+1,p_data);
 else update public.task_detail_automation set last_checked_at=now() where task_id=p_task_id; end if;
 return jsonb_build_object('ok',true,'changed',changed,'version',coalesce(old.version,0)+case when changed then 1 else 0 end);
end;$$;
create function public.icetak_task_detail_finish(p_run uuid,p_result jsonb)
returns void language sql security invoker set search_path='' as $$
 update task_detail_private.runtime set lease_id=null,lease_until=null,last_finished_at=now(),last_result=p_result where id and lease_id=p_run;
$$;
create function task_detail_private.dispatch()
returns bigint language plpgsql security definer set search_path='' as $$
declare token text; request bigint;
begin
 update task_detail_private.runtime set last_dispatch_at=now()
 where id and enabled and (lease_until is null or lease_until<now())
 and (last_dispatch_at is null or last_dispatch_at<now()-interval '15 seconds');
 if not found then return null; end if;
 select setting_value into token from public.private_runtime_settings where setting_key='task_detail_worker_token';
 if nullif(token,'') is null then return null; end if;
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/task-detail-worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-task-detail-token',token),body:='{}'::jsonb,timeout_milliseconds:=120000) into request;
 return request;
end;$$;
create function task_detail_private.signal()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='marketplace_orders' then
  insert into task_detail_private.order_signals(kind,order_id,reference) values('shopee',new.id,new.order_sn)
  on conflict(kind,order_id) do update set signalled_at=now(),reference=excluded.reference;
 elsif tg_table_name='orders' then
  insert into task_detail_private.order_signals(kind,order_id,reference) values('icetak',new.id,new.order_no)
  on conflict(kind,order_id) do update set signalled_at=now(),reference=excluded.reference;
 end if;
 perform task_detail_private.dispatch();return new;
end;$$;
create trigger task_detail_new_marketplace after insert or update of buyer_message,buyer_user_id,current_status,payment_status on public.marketplace_orders for each row execute function task_detail_private.signal();
create trigger task_detail_new_order after insert or update of status,payment_status,admin_remark on public.orders for each row execute function task_detail_private.signal();
create trigger task_detail_task_available after insert or update of task_name,order_id,marketplace_order_id,source_updated_at on public.ai_clickup_work_snapshots for each row execute function task_detail_private.signal();
revoke all on all functions in schema task_detail_private from public,anon,authenticated;
revoke all on function public.icetak_task_detail_begin(),public.icetak_task_detail_record(uuid,text,integer,text,jsonb),public.icetak_task_detail_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_task_detail_begin(),public.icetak_task_detail_record(uuid,text,integer,text,jsonb),public.icetak_task_detail_finish(uuid,jsonb) to service_role;

create or replace function public.icetak_task_readiness_sources(p_task_ids jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
with selected as materialized (
 select s.* from public.ai_clickup_work_snapshots s
 where jsonb_array_length(p_task_ids) between 1 and 1000 and s.task_id in (select jsonb_array_elements_text(p_task_ids))
), sources as (
 select s.task_id,jsonb_build_object(
  'task_id',s.task_id,'title',s.task_name,'status',s.clickup_status,'source_updated_at',s.source_updated_at,
  'order_id',s.order_id,'marketplace_order_id',s.marketplace_order_id,'component_id',s.component_id,
  'mapping_status',s.mapping_status,'sets',s.set_labels,'review_status',s.review_status,
  'fields',coalesce(cf.fields,'{}'),
  'item',case when i.id is not null then jsonb_build_object('id',i.id,'title',i.title,'quantity',i.qty,'size',i.size,
   'style',i.style,'wording',coalesce(nullif(i.custom_text,''),i.wording),'product_type',i.product_type,
   'wording_mode',i.wording_mode,'sku',i.catalog_slug,'customization',i.customization,'review_required',i.review_required) end,
  'component',case when pc.id is not null then jsonb_build_object('type',pc.component_type,'label',pc.label,
   'review_required',pc.review_required,'review_status',pc.review_status,'set_index',pc.set_index) end,
  'order_status',coalesce(m.current_status,o.status),'payment_status',coalesce(m.payment_status,o.payment_status),
  'fulfillment_status',coalesce(m.fulfillment_status,o.fulfillment_stage),
  'customer_confirmed',o.customer_confirmed,
  'detail_check',(select st.data->'detail_check' from public.customer_focus_state st
    where st.row_key=case when m.id is not null then 'shopee:'||m.id::text else 'icetak:'||o.id::text end),
  'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime) order by f.id)
    from public.task_workspace_files f where f.task_id=s.task_id),'[]')
 ) data
 from selected s
 left join public.production_components pc on pc.id=s.component_id and pc.order_id=s.order_id
 left join public.order_items i on i.id=pc.order_item_id and i.order_id=s.order_id
 left join public.orders o on o.id=s.order_id
 left join public.marketplace_orders m on m.id=s.marketplace_order_id
 left join lateral (
  select coalesce(e.raw_payload->'task',e.raw_payload#>'{data,task}',e.raw_payload->'current_task') task
  from public.clickup_webhook_events e where e.task_id=s.task_id
  and jsonb_typeof(coalesce(e.raw_payload#>'{task,custom_fields}',e.raw_payload#>'{data,task,custom_fields}',e.raw_payload#>'{current_task,custom_fields}'))='array'
  order by e.task_updated_at desc nulls last,e.received_at desc limit 1
 ) raw on true
 left join lateral (
  select jsonb_object_agg(lower(trim(f->>'name')),f->'value') fields
  from jsonb_array_elements(coalesce(raw.task->'custom_fields','[]')) f
  where lower(trim(f->>'name')) in ('sku','customize name','customise name','confirmed','noted')
 ) cf on true
)
select jsonb_build_object('sources',coalesce((select jsonb_object_agg(task_id,data||jsonb_build_object('source_token',md5(data::text))) from sources),'{}'),
 'automations',coalesce((select jsonb_object_agg(a.task_id,to_jsonb(a)) from public.task_detail_automation a join selected s using(task_id)),'{}'),
 'briefs',coalesce((select jsonb_object_agg(b.task_id,to_jsonb(b)) from public.task_workspace_briefs b join selected s using(task_id)),'{}'));
$$;


notify pgrst,'reload schema';
