-- Per-task production briefs. These observations never mutate canonical order/provider facts.
create table public.task_workspace_briefs (
 task_id text primary key, version integer not null default 1,
 data jsonb not null, source_fingerprint text not null,
 confirmed boolean not null default false, updated_by text not null,
 updated_at timestamptz not null default now()
);
create table public.task_workspace_brief_events (
 request_id uuid primary key, task_id text not null, actor text not null,
 input jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
create index task_workspace_brief_events_task_idx on public.task_workspace_brief_events(task_id,created_at desc);
alter table public.task_workspace_briefs enable row level security;
alter table public.task_workspace_brief_events enable row level security;
revoke all on public.task_workspace_briefs,public.task_workspace_brief_events from public,anon,authenticated;
grant select,insert,update on public.task_workspace_briefs to service_role;
grant select,insert on public.task_workspace_brief_events to service_role;

create function public.icetak_task_readiness_sources(p_task_ids jsonb)
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
 'briefs',coalesce((select jsonb_object_agg(b.task_id,to_jsonb(b)) from public.task_workspace_briefs b join selected s using(task_id)),'{}'));
$$;

create function public.icetak_task_brief_save(p_actor text,p_request uuid,p_task_id text,p_version integer,
 p_source_token text,p_source_fingerprint text,p_data jsonb,p_confirmed boolean,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.task_workspace_brief_events; current public.task_workspace_briefs; source jsonb; result jsonb;
begin
 if not exists(select 1 from public.admin_users a left join public.admin_permissions ap using(username)
  where a.username=p_actor and a.is_active and (a.role='owner' or ap.permissions && array['edit_order','manage_customers','manage_admins'])) then raise exception 'BRIEF_PERMISSION_REQUIRED'; end if;
 if p_request is null or p_version is null or p_version<0 or jsonb_typeof(p_data)<>'object' or length(p_data::text)>20000
  or length(coalesce(p_source_fingerprint,''))<>64 or p_confirmed is null then raise exception 'INVALID_BRIEF'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,2));
 select * into old from public.task_workspace_brief_events where request_id=p_request;
 if found then
  if old.actor<>p_actor or old.task_id<>p_task_id or old.input<>p_input then raise exception 'REQUEST_CONFLICT'; end if;
  return old.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_task_id,3));
 perform 1 from public.ai_clickup_work_snapshots where task_id=p_task_id and list_id='18375902'
  and lower(trim(clickup_status)) not in ('complete','closed','cancelled','canceled','lain2','prospect') for share;
 if not found then raise exception 'TASK_NOT_ACTIVE'; end if;
 source:=public.icetak_task_readiness_sources(jsonb_build_array(p_task_id))#>array['sources',p_task_id];
 if source->>'source_token' is distinct from p_source_token then raise exception 'SOURCE_CHANGED_REFRESH'; end if;
 select * into current from public.task_workspace_briefs where task_id=p_task_id for update;
 if coalesce(current.version,0)<>p_version then raise exception 'VERSION_CONFLICT_REFRESH'; end if;
 insert into public.task_workspace_briefs(task_id,version,data,source_fingerprint,confirmed,updated_by)
 values(p_task_id,coalesce(current.version,0)+1,p_data,p_source_fingerprint,p_confirmed,p_actor)
 on conflict(task_id) do update set version=excluded.version,data=excluded.data,source_fingerprint=excluded.source_fingerprint,
 confirmed=excluded.confirmed,updated_by=excluded.updated_by,updated_at=now()
 returning jsonb_build_object('ok',true,'version',version,'confirmed',confirmed) into result;
 insert into public.task_workspace_brief_events(request_id,task_id,actor,input,result) values(p_request,p_task_id,p_actor,p_input,result);
 return result;
end;
$$;
revoke all on function public.icetak_task_readiness_sources(jsonb),public.icetak_task_brief_save(text,uuid,text,integer,text,text,jsonb,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_task_readiness_sources(jsonb),public.icetak_task_brief_save(text,uuid,text,integer,text,text,jsonb,boolean,jsonb) to service_role;
notify pgrst,'reload schema';
