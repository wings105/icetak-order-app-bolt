-- Order System only: initial order observations before a ClickUp task exists.
create table public.order_detail_automation (
 row_key text primary key,version integer not null,data jsonb not null,last_checked_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.order_detail_automation_events (
 id bigint generated always as identity primary key,row_key text not null,version integer not null,data jsonb not null,created_at timestamptz not null default now(),unique(row_key,version)
);
alter table public.order_detail_automation enable row level security;
alter table public.order_detail_automation_events enable row level security;
revoke all on public.order_detail_automation,public.order_detail_automation_events from public,anon,authenticated;
grant all on public.order_detail_automation,public.order_detail_automation_events to service_role;
grant usage,select on sequence public.order_detail_automation_events_id_seq to service_role;
grant select on task_detail_private.order_signals to service_role;
create function public.icetak_task_detail_order_revision(p_kind text,p_id uuid)
returns text language sql stable security invoker set search_path='' as $$
select case when p_kind='shopee' then (select md5(jsonb_build_object('order',to_jsonb(o)-'raw_detail','items',(select jsonb_agg(to_jsonb(i)-'raw_item' order by i.line_no) from public.marketplace_order_items i where i.order_id=o.id and i.is_current))::text) from public.marketplace_orders o where o.id=p_id)
 when p_kind='icetak' then (select md5(jsonb_build_object('order',to_jsonb(o),'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id=o.id))::text) from public.orders o where o.id=p_id) end;
$$;
create function public.icetak_task_detail_intake_pending()
returns jsonb language sql stable security invoker set search_path='' as $$
select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (
 select q.kind||':'||q.order_id row_key,q.reference,coalesce(a.version,0) version,a.data,
 public.icetak_task_detail_order_revision(q.kind,q.order_id) revision
 from task_detail_private.order_signals q left join public.order_detail_automation a on a.row_key=q.kind||':'||q.order_id
 left join public.orders o on q.kind='icetak' and o.id=q.order_id
 left join public.marketplace_orders m on q.kind='shopee' and m.id=q.order_id
 where coalesce(m.id,o.id) is not null and lower(coalesce(m.current_status,o.status,'')) not in ('shipped','completed','cancelled','canceled','customer_collected','returned','refunded')
 and not exists(select 1 from public.ai_clickup_work_snapshots s where s.list_id='18375902' and (s.order_id=o.id or s.marketplace_order_id=m.id))
 order by a.last_checked_at nulls first,q.signalled_at desc limit 10
)t;
$$;
create function public.icetak_task_detail_intake_record(p_run uuid,p_key text,p_version integer,p_revision text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.order_detail_automation;changed boolean;
begin
 if not exists(select 1 from task_detail_private.runtime where id and lease_id=p_run and lease_until>now()) then raise exception 'LEASE_EXPIRED';end if;
 if p_key !~ '^(icetak|shopee):[a-f0-9-]{36}$' or jsonb_typeof(p_data)<>'object' or length(p_data::text)>600000 then raise exception 'INVALID_INTAKE';end if;
 if public.icetak_task_detail_order_revision(split_part(p_key,':',1),split_part(p_key,':',2)::uuid) is distinct from p_revision then raise exception 'SOURCE_CHANGED_REFRESH';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key,27));
 select * into old from public.order_detail_automation where row_key=p_key for update;
 if coalesce(old.version,0)<>p_version then raise exception 'VERSION_CONFLICT_REFRESH';end if;
 changed:=old.row_key is null or (old.data-'checked_at') is distinct from (p_data-'checked_at');
 -- Per-item check timestamps are observational and cannot grow duplicate history every minute.
 if old.row_key is not null and jsonb_array_length(coalesce(old.data->'items','[]'))=jsonb_array_length(coalesce(p_data->'items','[]')) then
  changed:=(old.data-'items'-'checked_at') is distinct from (p_data-'items'-'checked_at') or
   (select jsonb_agg((i-'observation')||jsonb_build_object('observation',i->'observation'-'checked_at')) from jsonb_array_elements(old.data->'items') i) is distinct from
   (select jsonb_agg((i-'observation')||jsonb_build_object('observation',i->'observation'-'checked_at')) from jsonb_array_elements(p_data->'items') i);
 end if;
 if changed then
  insert into public.order_detail_automation(row_key,version,data) values(p_key,coalesce(old.version,0)+1,p_data)
  on conflict(row_key) do update set version=excluded.version,data=excluded.data,last_checked_at=now(),updated_at=now();
  insert into public.order_detail_automation_events(row_key,version,data) values(p_key,coalesce(old.version,0)+1,p_data);
 else update public.order_detail_automation set last_checked_at=now() where row_key=p_key;end if;
 return jsonb_build_object('ok',true,'changed',changed);
end;$$;
revoke all on function public.icetak_task_detail_order_revision(text,uuid),public.icetak_task_detail_intake_pending(),public.icetak_task_detail_intake_record(uuid,text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_task_detail_order_revision(text,uuid),public.icetak_task_detail_intake_pending(),public.icetak_task_detail_intake_record(uuid,text,integer,text,jsonb) to service_role;

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
 'intakes',coalesce((select jsonb_object_agg(a.row_key,to_jsonb(a)) from public.order_detail_automation a where a.row_key in (select case when s.marketplace_order_id is not null then 'shopee:'||s.marketplace_order_id else 'icetak:'||s.order_id end from selected s)),'{}'),
 'automations',coalesce((select jsonb_object_agg(a.task_id,to_jsonb(a)) from public.task_detail_automation a join selected s using(task_id)),'{}'),
 'briefs',coalesce((select jsonb_object_agg(b.task_id,to_jsonb(b)) from public.task_workspace_briefs b join selected s using(task_id)),'{}'));
$$;


notify pgrst,'reload schema';
