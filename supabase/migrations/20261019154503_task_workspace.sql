-- Native staff work is separate from provider/canonical fulfillment facts.
create table public.task_workspace_state (
 task_id text primary key, version integer not null default 0,
 stage text, assignee text not null default '', note text not null default '',
 source_revision timestamptz, updated_at timestamptz not null default now(), updated_by text not null,
 check (stage is null or stage in ('new custom','design editing -topper','design edible image','acrylic','wafer paper','review','cake topper - printing','edible image -printing','wafer - printing','print alamat','ready stock','complete'))
);
create table public.task_workspace_events (
 request_id uuid primary key, task_id text not null, actor text not null,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
create index task_workspace_events_task_idx on public.task_workspace_events(task_id,created_at desc);
create table public.task_workspace_files (
 id uuid primary key default gen_random_uuid(), task_id text not null,
 storage_path text unique not null, name text not null, mime text not null,
 uploaded_by text not null, created_at timestamptz not null default now()
);
create index task_workspace_files_task_idx on public.task_workspace_files(task_id,created_at desc);
alter table public.task_workspace_state enable row level security;
alter table public.task_workspace_events enable row level security;
alter table public.task_workspace_files enable row level security;
revoke all on public.task_workspace_state,public.task_workspace_events,public.task_workspace_files from public,anon,authenticated;
grant select,insert,update on public.task_workspace_state to service_role;
grant select,insert on public.task_workspace_events,public.task_workspace_files to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('task-workspace','task-workspace',false,15728640,array['image/png','image/jpeg','image/webp','application/pdf']);

create function public.icetak_task_workspace_read(p_task_id text default null)
returns jsonb language sql stable security invoker set search_path='' as $fn$
with eligible as materialized (
 select s.*,w.stage native_stage,w.version,w.assignee,w.note,w.source_revision,w.updated_by,w.updated_at work_updated_at
 from public.ai_clickup_work_snapshots s left join public.task_workspace_state w using(task_id)
 where (p_task_id is null and s.list_id='18375902' and lower(trim(s.clickup_status)) not in ('lain2','prospect','complete','closed','cancelled','canceled'))
 or (p_task_id is not null and s.task_id=p_task_id)
), bounded as (select * from eligible order by source_updated_at desc,task_id limit 1001),
rows as (
 select s.task_id,s.task_name title,s.order_reference,s.order_id,s.marketplace_order_id,s.component_id,s.mapping_status,
 s.clickup_status source_status,s.source_updated_at,s.observed_at,s.set_labels sets,s.review_status,
 case when s.source_revision=s.source_updated_at and s.native_stage is not null then s.native_stage else s.clickup_status end status,
 (s.source_revision=s.source_updated_at and s.native_stage is not null) native_status,
 coalesce(s.version,0) version,coalesce(s.assignee,'') assignee,coalesce(s.note,'') note,s.updated_by,s.work_updated_at,
 coalesce(o.delivery_phone,f.fields->>'phone','') phone,
 coalesce(o.delivery_name,m.buyer_username,'') customer,
 coalesce(o.courier,m.courier_name,f.fields->>'courier','') courier,
 coalesce(o.payment_status,m.payment_status,'') payment_status,
 coalesce(o.fulfillment_stage,m.fulfillment_status,'') fulfillment_status,
 o.date_need needed_at,m.ship_by_at,
 case when o.id is not null then 'iCetak' when m.id is not null then 'Shopee' else 'ClickUp' end source,
 coalesce(oi.custom_text,oi.wording,f.fields->>'customize name',f.fields->>'customise name','') wording,
 coalesce(f.fields->>'sku','') sku,raw.task->>'due_date' due_date,
 coalesce(p.attachments,'[]') attachments,coalesce(p.comment_images,'[]') comment_images,
 (select count(*) from public.task_workspace_files tf where tf.task_id=s.task_id) file_count,
 case when p_task_id is not null then coalesce((select jsonb_agg(to_jsonb(tf) order by tf.created_at desc) from public.task_workspace_files tf where tf.task_id=s.task_id),'[]') else '[]'::jsonb end files,
 case when p_task_id is not null then coalesce((select jsonb_agg(jsonb_build_object('actor',e.actor,'at',e.created_at,'stage',e.payload->>'stage','note',e.payload->>'note','kind',case when e.payload ? 'file' then 'upload' else 'save' end) order by e.created_at desc) from (select * from public.task_workspace_events ev where ev.task_id=s.task_id order by ev.created_at desc limit 30) e),'[]') else '[]'::jsonb end history
 from bounded s
 left join public.orders o on o.id=s.order_id
 left join public.marketplace_orders m on m.id=s.marketplace_order_id
 left join public.production_components pc on pc.id=s.component_id
 left join public.order_items oi on oi.id=pc.order_item_id
 left join public.clickup_awb_preview_tasks p on p.task_id=s.task_id
 left join lateral (
  select coalesce(e.raw_payload->'task',e.raw_payload#>'{data,task}',e.raw_payload->'current_task') task
  from public.clickup_webhook_events e where e.task_id=s.task_id
   and jsonb_typeof(coalesce(e.raw_payload#>'{task,custom_fields}',e.raw_payload#>'{data,task,custom_fields}',e.raw_payload#>'{current_task,custom_fields}'))='array'
  order by e.task_updated_at desc nulls last,e.received_at desc limit 1
 ) raw on true
 left join lateral (
  select jsonb_object_agg(lower(trim(f->>'name')),case
   when f->>'type'='drop_down' then (select coalesce(opt->>'name',opt->>'label') from jsonb_array_elements(coalesce(f#>'{type_config,options}','[]')) opt where opt->>'id'=f->>'value' or opt->>'orderindex'=f->>'value' limit 1)
   else f->>'value' end) fields
  from jsonb_array_elements(coalesce(raw.task->'custom_fields','[]')) f
  where lower(trim(f->>'name')) in ('phone','sku','customize name','customise name','courier')
 ) f on true
 where not exists(select 1 from public.clickup_webhook_events d where d.task_id=s.task_id and lower(d.event_type) in ('taskdeleted','task_deleted') and d.received_at>=s.observed_at)
 order by s.source_updated_at desc,s.task_id limit 1000
)
select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)) from rows r),'[]'),
 'truncated',(select count(*)>1000 from bounded),
 'last_webhook_at',(select max(received_at) from public.clickup_webhook_events where list_id='18375902'),
 'staff',coalesce((select jsonb_agg(jsonb_build_object('username',username,'name',coalesce(display_name,username)) order by username) from public.admin_users where is_active),'[]'));
$fn$;

create function public.icetak_task_workspace_save(p_actor text,p_request uuid,p_task_id text,p_version integer,p_source_revision timestamptz,p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare v public.task_workspace_state; s public.ai_clickup_work_snapshots; old public.task_workspace_events; result jsonb;
begin
 if not exists(select 1 from public.admin_users a left join public.admin_permissions ap on ap.username=a.username
  where a.username=p_actor and a.is_active and (a.role='owner' or ap.permissions && array['edit_order','approve_production','manage_admins'])) then raise exception 'WORK_PERMISSION_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into old from public.task_workspace_events where request_id=p_request;
 if found then
  if old.actor<>p_actor or old.task_id<>p_task_id or old.payload<>p_patch then raise exception 'REQUEST_CONFLICT'; end if;
  return old.result;
 end if;
 select * into s from public.ai_clickup_work_snapshots where task_id=p_task_id for share;
 if not found or s.list_id<>'18375902' or lower(trim(s.clickup_status)) in ('complete','closed','cancelled','canceled','lain2','prospect') then raise exception 'TASK_NOT_ACTIVE'; end if;
 if s.source_updated_at is distinct from p_source_revision then raise exception 'SOURCE_CHANGED_REFRESH'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_task_id,1));
 select * into v from public.task_workspace_state where task_id=p_task_id for update;
 if coalesce(v.version,0) is distinct from p_version then raise exception 'VERSION_CONFLICT_REFRESH'; end if;
 if jsonb_typeof(p_patch)<>'object' or p_version is null or p_request is null
  or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('stage','assignee','note','file')) then raise exception 'INVALID_PATCH'; end if;
 if length(coalesce(p_patch->>'note',''))>10000 or length(coalesce(p_patch->>'assignee',''))>200 then raise exception 'INVALID_LENGTH'; end if;
 if p_patch ? 'assignee' and coalesce(p_patch->>'assignee','')<>'' and not exists(select 1 from public.admin_users where username=p_patch->>'assignee' and is_active) then raise exception 'INVALID_ASSIGNEE'; end if;
 if p_patch ? 'file' then
  if not (p_patch#>>'{file,path}' like p_task_id||'/%') or p_patch#>>'{file,mime}' not in ('image/png','image/jpeg','image/webp','application/pdf')
   or nullif(p_patch#>>'{file,name}','') is null then raise exception 'INVALID_FILE'; end if;
  insert into public.task_workspace_files(task_id,storage_path,name,mime,uploaded_by)
  values(p_task_id,p_patch#>>'{file,path}',left(p_patch#>>'{file,name}',200),p_patch#>>'{file,mime}',p_actor);
 end if;
 insert into public.task_workspace_state(task_id,version,stage,assignee,note,source_revision,updated_by)
 values(p_task_id,coalesce(v.version,0)+1,
 case when p_patch ? 'stage' then nullif(p_patch->>'stage','') when v.source_revision=s.source_updated_at then v.stage else null end,
 case when p_patch ? 'assignee' then coalesce(p_patch->>'assignee','') else coalesce(v.assignee,'') end,
 case when p_patch ? 'note' then coalesce(p_patch->>'note','') else coalesce(v.note,'') end,s.source_updated_at,p_actor)
 on conflict(task_id) do update set version=excluded.version,stage=excluded.stage,assignee=excluded.assignee,note=excluded.note,source_revision=excluded.source_revision,updated_by=excluded.updated_by,updated_at=now()
 returning * into v;
 result:=jsonb_build_object('ok',true,'version',v.version);
 insert into public.task_workspace_events(request_id,task_id,actor,payload,result) values(p_request,p_task_id,p_actor,p_patch,result);
 return result;
end;
$fn$;
revoke all on function public.icetak_task_workspace_read(text),public.icetak_task_workspace_save(text,uuid,text,integer,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_task_workspace_read(text),public.icetak_task_workspace_save(text,uuid,text,integer,timestamptz,jsonb) to service_role;
