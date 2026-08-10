-- Admin V2 ClickUp Queue control center + canonical Activepieces payload.
-- Safe/idempotent: no ClickUp task is created by this migration.

create table if not exists public.clickup_queue_events (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid null references public.integration_outbox(id) on delete set null,
  order_id uuid null references public.orders(id) on delete cascade,
  component_id uuid null references public.production_components(id) on delete set null,
  event_kind text not null,
  status_from text null,
  status_to text null,
  attempts integer null,
  actor text null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_clickup_queue_events_order_created on public.clickup_queue_events(order_id, created_at desc);
create index if not exists idx_clickup_queue_events_outbox_created on public.clickup_queue_events(outbox_id, created_at desc);
create index if not exists idx_integration_outbox_clickup_queue on public.integration_outbox(provider,event_type,status,next_attempt_at,created_at);
create index if not exists idx_production_components_order_task on public.production_components(order_id,clickup_task_id);
alter table public.clickup_queue_events enable row level security;
revoke all on public.clickup_queue_events from anon, authenticated;

create or replace function public.icetak_clickup_production_payload_data(p_order_id uuid)
returns jsonb language sql stable security definer set search_path to 'public','pg_temp'
as $function$
with base as (select coalesce(public.icetak_public_app_base_url(),'https://icetak.bolt.host') app_url)
select jsonb_build_object(
  'event_type','clickup.production.create','order_id',o.id,'order_no',coalesce(nullif(o.order_no,''),o.order_id,''),
  'order',jsonb_build_object(
    'id',o.id,'order_no',coalesce(nullif(o.order_no,''),o.order_id,''),'public_token',o.public_token,
    'source',o.source,'status',o.status,'admin_status',o.admin_status,'date_need',o.date_need,'created_at',o.created_at,
    'total',coalesce(o.total,0),'payment_status',o.payment_status,'production_approved',coalesce(o.production_approved,false),
    'delivery',coalesce(nullif(o.delivery,''),o.delivery_method,''),
    'customer_order_link',base.app_url||'/?order='||coalesce(o.public_token,''),
    'admin_order_link',base.app_url||'/?admin=v2&order='||coalesce(nullif(o.order_no,''),o.order_id,'')),
  'customer',jsonb_build_object('name',coalesce(c.name,o.delivery_name,''),'phone',coalesce(c.phone,o.delivery_phone,''),'delivery_name',coalesce(o.delivery_name,''),'delivery_phone',coalesce(o.delivery_phone,'')),
  'missing_components',coalesce((select count(*) from public.production_components pc where pc.order_id=o.id and pc.clickup_task_id is null),0),
  'components',coalesce((
    select jsonb_agg(jsonb_build_object(
      'component_id',pc.id,'order_item_id',pc.order_item_id,'label',coalesce(pc.label,''),'component_type',coalesce(pc.component_type,''),
      'workflow',coalesce(pc.workflow,''),'customer_stage',coalesce(pc.customer_stage,''),'customer_label',coalesce(pc.customer_label,''),
      'review_required',coalesce(pc.review_required,false),'review_status',coalesce(pc.review_status,''),'preview_url',pc.preview_url,
      'progress_percent',coalesce(pc.progress_percent,0),
      'task_name',concat_ws(' · ',coalesce(nullif(o.order_no,''),o.order_id,''),coalesce(pc.label,i.title,i.product_type,'Production')),
      'item',jsonb_build_object('id',i.id,'sort_index',i.sort_index,'k',i.k,'product_type',i.product_type,'title',coalesce(i.title,i.product_type,'Item'),'qty',coalesce(i.qty,1),'size',coalesce(i.size,''),'style',coalesce(i.style,''),'wording',coalesce(i.wording,i.custom_text,''),'custom_text',coalesce(i.custom_text,''),'price',coalesce(i.price,0),'review_required',coalesce(i.review_required,false),'design_preview_url',i.design_preview_url)
    ) order by coalesce(i.sort_index,999999),pc.created_at,pc.id)
    from public.production_components pc left join public.order_items i on i.id=pc.order_item_id
    where pc.order_id=o.id and pc.clickup_task_id is null),'[]'::jsonb),
  'existing_tasks',coalesce((
    select jsonb_agg(jsonb_build_object('component_id',pc.id,'label',coalesce(pc.label,''),'clickup_task_id',pc.clickup_task_id,'clickup_status',pc.clickup_status,'task_url',coalesce(ct.url,'https://app.clickup.com/t/3747262/'||pc.clickup_task_id),'link_source',pc.clickup_link_source) order by pc.created_at,pc.id)
    from public.production_components pc left join public.clickup_tasks ct on ct.component_id=pc.id
    where pc.order_id=o.id and pc.clickup_task_id is not null),'[]'::jsonb)
) from public.orders o left join public.customers c on c.id=o.customer_id cross join base where o.id=p_order_id;
$function$;
revoke all on function public.icetak_clickup_production_payload_data(uuid) from public, anon, authenticated;
grant execute on function public.icetak_clickup_production_payload_data(uuid) to service_role;

create or replace function public.icetak_clickup_production_payload(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp'
as $function$
begin
  if coalesce(auth.role(),'') <> 'service_role' and not public.icetak_admin_has_permission('view_orders') then raise exception 'Forbidden'; end if;
  return public.icetak_clickup_production_payload_data(p_order_id);
end;$function$;
revoke all on function public.icetak_clickup_production_payload(uuid) from public, anon;
grant execute on function public.icetak_clickup_production_payload(uuid) to authenticated, service_role;

create or replace function public.icetak_clickup_queue_outbox_event_trg()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_kind text; v_actor text;
begin
  if coalesce(new.provider,'') <> 'activepieces' or coalesce(new.event_type,'') <> 'clickup.production.create' then return new; end if;
  if tg_op='INSERT' then v_kind:='queued';
  elsif old.status is distinct from new.status then v_kind:='status_changed';
  elsif old.attempts is distinct from new.attempts then v_kind:='attempt_claimed';
  elsif old.last_error is distinct from new.last_error or old.error is distinct from new.error then v_kind:='error_updated';
  else return new; end if;
  v_actor:=coalesce(auth.uid()::text,current_user,'system');
  insert into public.clickup_queue_events(outbox_id,order_id,event_kind,status_from,status_to,attempts,actor,detail)
  values(new.id,new.order_id,v_kind,case when tg_op='UPDATE' then old.status else null end,new.status,new.attempts,v_actor,jsonb_build_object('last_error',new.last_error,'error',new.error,'locked_at',new.locked_at,'next_attempt_at',new.next_attempt_at,'processed_at',new.processed_at));
  return new;
end;$function$;
drop trigger if exists icetak_clickup_queue_outbox_event on public.integration_outbox;
create trigger icetak_clickup_queue_outbox_event after insert or update on public.integration_outbox for each row execute function public.icetak_clickup_queue_outbox_event_trg();

create or replace function public.icetak_clickup_queue_component_event_trg()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_outbox uuid; v_actor text;
begin
  if old.clickup_task_id is not distinct from new.clickup_task_id then return new; end if;
  select id into v_outbox from public.integration_outbox where order_id=new.order_id and provider='activepieces' and event_type='clickup.production.create' order by created_at desc limit 1;
  v_actor:=coalesce(auth.uid()::text,current_user,'system');
  insert into public.clickup_queue_events(outbox_id,order_id,component_id,event_kind,status_from,status_to,actor,detail)
  values(v_outbox,new.order_id,new.id,case when new.clickup_task_id is null then 'task_unlinked' else 'task_linked' end,null,new.clickup_status,v_actor,jsonb_build_object('clickup_task_id',new.clickup_task_id,'clickup_status',new.clickup_status,'link_source',new.clickup_link_source));
  return new;
end;$function$;
drop trigger if exists icetak_clickup_queue_component_event on public.production_components;
create trigger icetak_clickup_queue_component_event after update of clickup_task_id on public.production_components for each row execute function public.icetak_clickup_queue_component_event_trg();

create or replace function public.enqueue_clickup_production_order(p_order_id uuid)
returns uuid language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_id uuid; v_order public.orders; v_payload jsonb;
begin
  select * into v_order from public.orders where id=p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if not public.icetak_order_is_production_ready(v_order) then return null; end if;
  if not exists(select 1 from public.production_components where order_id=p_order_id and clickup_task_id is null) then return null; end if;
  v_payload:=public.icetak_clickup_production_payload_data(p_order_id);
  insert into public.integration_outbox(provider,event_type,order_id,order_token,payload,status,next_attempt_at,source,channel,idempotency_key)
  values('activepieces','clickup.production.create',p_order_id,v_order.public_token,v_payload,'pending',now(),'supabase','clickup','clickup:production:create:'||p_order_id::text)
  on conflict(idempotency_key) where idempotency_key is not null do update set
    payload=excluded.payload,
    status=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then 'processing' else 'pending' end,
    next_attempt_at=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then public.integration_outbox.next_attempt_at else now() end,
    locked_at=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then public.integration_outbox.locked_at else null end,
    processed_at=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then public.integration_outbox.processed_at else null end,
    sent_at=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then public.integration_outbox.sent_at else null end,
    last_error=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then public.integration_outbox.last_error else null end,
    error=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then public.integration_outbox.error else null end
  returning id into v_id;
  return v_id;
end;$function$;

create or replace function public.claim_clickup_production_outbox(p_limit integer default 10)
returns setof public.integration_outbox language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
begin
  update public.integration_outbox o set status='processed',processed_at=coalesce(o.processed_at,now()),sent_at=coalesce(o.sent_at,now()),locked_at=null,last_error=null,error=null
  where o.provider='activepieces' and o.event_type='clickup.production.create' and o.status in ('pending','retry','processing') and not exists(select 1 from public.production_components pc where pc.order_id=o.order_id and pc.clickup_task_id is null);
  update public.integration_outbox set status='retry',locked_at=null,next_attempt_at=now(),last_error=coalesce(last_error,'stale_processing_lease_recovered')
  where provider='activepieces' and event_type='clickup.production.create' and status='processing' and locked_at<now()-interval '10 minutes';
  return query with picked as (
    select id from public.integration_outbox where provider='activepieces' and event_type='clickup.production.create' and status in ('pending','retry') and coalesce(next_attempt_at,now())<=now()
    order by created_at limit greatest(1,least(coalesce(p_limit,10),50)) for update skip locked
  ) update public.integration_outbox o set status='processing',locked_at=now(),attempts=coalesce(o.attempts,0)+1,payload=public.icetak_clickup_production_payload_data(o.order_id) from picked where o.id=picked.id returning o.*;
end;$function$;
revoke all on function public.claim_clickup_production_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_clickup_production_outbox(integer) to service_role;

update public.integration_outbox o set payload=public.icetak_clickup_production_payload_data(o.order_id)
where o.provider='activepieces' and o.event_type='clickup.production.create' and o.status in ('pending','retry','processing') and o.order_id is not null;

create or replace function public.icetak_admin_clickup_queue(p_status text default 'attention',p_query text default '',p_page integer default 1,p_page_size integer default 50)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp'
as $function$
declare v_result jsonb; v_page int:=greatest(1,coalesce(p_page,1)); v_size int:=least(100,greatest(10,coalesce(p_page_size,50))); v_status text:=lower(coalesce(p_status,'attention')); v_query text:=lower(trim(coalesce(p_query,'')));
begin
  if not public.icetak_admin_has_permission('view_orders') then raise exception 'Forbidden'; end if;
  with latest_outbox as (select distinct on(order_id) id,order_id,status,attempts,last_error,error,next_attempt_at,locked_at,processed_at,created_at,payload from public.integration_outbox where provider='activepieces' and event_type='clickup.production.create' and order_id is not null order by order_id,created_at desc,id desc),
  comp as (select pc.order_id,count(*)::int total,count(*) filter(where pc.clickup_task_id is not null)::int linked,count(*) filter(where pc.clickup_task_id is null)::int missing,max(pc.last_synced_at) last_task_at,string_agg(distinct coalesce(pc.label,pc.component_type,'Component'),', ' order by coalesce(pc.label,pc.component_type,'Component')) component_summary,jsonb_agg(jsonb_build_object('componentId',pc.id,'label',coalesce(pc.label,''),'type',coalesce(pc.component_type,''),'clickupTaskId',pc.clickup_task_id,'clickupStatus',pc.clickup_status,'linkSource',pc.clickup_link_source,'taskUrl',case when pc.clickup_task_id is null then null else coalesce(ct.url,'https://app.clickup.com/t/3747262/'||pc.clickup_task_id) end) order by pc.created_at,pc.id) components from public.production_components pc left join public.clickup_tasks ct on ct.component_id=pc.id group by pc.order_id),
  raw as (select o.id order_id,coalesce(nullif(o.order_no,''),o.order_id,'') order_no,coalesce(c.name,o.delivery_name,'') customer_name,coalesce(c.phone,o.delivery_phone,'') customer_phone,o.date_need,o.source,o.created_at order_created_at,o.public_token,o.status order_status,o.fulfillment_stage,lo.id outbox_id,coalesce(lo.status,'') outbox_status,coalesce(lo.attempts,0) attempts,coalesce(lo.last_error,lo.error,'') last_error,lo.next_attempt_at,lo.locked_at,lo.processed_at,case when lo.created_at is null then null else to_timestamp(lo.created_at/1000.0) end queued_at,lo.payload,coalesce(comp.total,0) components_total,coalesce(comp.linked,0) components_linked,coalesce(comp.missing,0) components_missing,comp.component_summary,coalesce(comp.components,'[]'::jsonb) components,comp.last_task_at,(lower(coalesce(o.status,'')) in ('completed','delivered','cancelled') or lower(coalesce(o.fulfillment_stage,'')) in ('completed','delivered','collected','cancelled')) is_terminal from public.orders o left join public.customers c on c.id=o.customer_id left join latest_outbox lo on lo.order_id=o.id left join comp on comp.order_id=o.id where coalesce(comp.total,0)>0 or lo.id is not null),
  base as (select r.*,case when r.components_total>0 and r.components_linked=r.components_total then 'success' when r.is_terminal then 'archived' when r.components_linked>0 and r.components_missing>0 then 'partial' when r.outbox_id is null and r.components_missing>0 then 'missing_queue' when lower(r.outbox_status)='skipped' then 'held' when lower(r.outbox_status)='processing' and r.locked_at<now()-interval '10 minutes' then 'stale' when lower(r.outbox_status)='processing' then 'processing' when lower(r.outbox_status)='retry' then 'retrying' when lower(r.outbox_status)='pending' then 'waiting' when lower(r.outbox_status) in ('error','failed') then 'failed' when lower(r.outbox_status)='processed' and r.components_missing>0 then 'data_problem' when r.components_total=0 then 'no_components' else coalesce(nullif(lower(r.outbox_status),''),'unknown') end derived_status from raw r),
  filtered as (select * from base b where (v_query='' or lower(concat_ws(' ',b.order_no,b.customer_name,b.customer_phone,b.component_summary,b.last_error,b.outbox_status)) like '%'||v_query||'%') and (v_status in ('','all') or (v_status='attention' and b.derived_status not in ('success','no_components','archived')) or (v_status='failed' and b.derived_status in ('failed','stale','data_problem','missing_queue')) or b.derived_status=v_status)),
  ordered as (select * from filtered order by case derived_status when 'failed' then 0 when 'stale' then 1 when 'data_problem' then 2 when 'partial' then 3 when 'retrying' then 4 when 'processing' then 5 when 'waiting' then 6 when 'missing_queue' then 7 when 'held' then 8 when 'success' then 20 when 'archived' then 30 else 15 end,coalesce(queued_at,order_created_at) desc,order_id),
  page_rows as (select * from ordered offset ((v_page-1)*v_size) limit v_size),
  summary as (select jsonb_build_object('all',count(*),'attention',count(*) filter(where derived_status not in ('success','no_components','archived')),'waiting',count(*) filter(where derived_status='waiting'),'processing',count(*) filter(where derived_status='processing'),'retrying',count(*) filter(where derived_status='retrying'),'partial',count(*) filter(where derived_status='partial'),'failed',count(*) filter(where derived_status in ('failed','stale','data_problem','missing_queue')),'held',count(*) filter(where derived_status='held'),'success',count(*) filter(where derived_status='success'),'archived',count(*) filter(where derived_status='archived'),'successToday',count(*) filter(where derived_status='success' and coalesce(processed_at,last_task_at)::date=current_date)) value from base)
  select jsonb_build_object('summary',(select value from summary),'rows',coalesce((select jsonb_agg(jsonb_build_object('orderDbId',r.order_id,'orderNo',r.order_no,'customerName',r.customer_name,'customerPhone',r.customer_phone,'dateNeed',r.date_need,'source',r.source,'orderCreatedAt',r.order_created_at,'publicToken',r.public_token,'outboxId',r.outbox_id,'outboxStatus',r.outbox_status,'status',r.derived_status,'attempts',r.attempts,'lastError',r.last_error,'queuedAt',r.queued_at,'lockedAt',r.locked_at,'nextAttemptAt',r.next_attempt_at,'processedAt',r.processed_at,'componentsTotal',r.components_total,'componentsLinked',r.components_linked,'componentsMissing',r.components_missing,'componentSummary',r.component_summary,'components',r.components)) from page_rows r),'[]'::jsonb),'pagination',jsonb_build_object('page',v_page,'pageSize',v_size,'total',(select count(*) from filtered),'totalPages',greatest(1,ceil((select count(*) from filtered)::numeric/v_size)::int)),'serverTime',now()) into v_result;
  return v_result;
end;$function$;
revoke all on function public.icetak_admin_clickup_queue(text,text,integer,integer) from public, anon;
grant execute on function public.icetak_admin_clickup_queue(text,text,integer,integer) to authenticated, service_role;

create or replace function public.icetak_admin_clickup_queue_summary()
returns jsonb language sql stable security definer set search_path to 'public','pg_temp'
as $function$ select public.icetak_admin_clickup_queue('all','',1,10)->'summary'; $function$;
revoke all on function public.icetak_admin_clickup_queue_summary() from public, anon;
grant execute on function public.icetak_admin_clickup_queue_summary() to authenticated, service_role;

create or replace function public.icetak_admin_clickup_queue_detail(p_order_ref text)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp'
as $function$
declare v_order_id uuid; v_outbox jsonb; v_components jsonb; v_events jsonb; v_order jsonb; v_base text:=coalesce(public.icetak_public_app_base_url(),'https://icetak.bolt.host');
begin
  if not public.icetak_admin_has_permission('view_orders') then raise exception 'Forbidden'; end if;
  v_order_id:=public.resolve_shipping_order_reference(p_order_ref);
  if v_order_id is null then select id into v_order_id from public.orders where order_no=p_order_ref or order_id=p_order_ref limit 1; end if;
  if v_order_id is null then raise exception 'Order not found'; end if;
  select jsonb_build_object('id',o.id,'orderNo',coalesce(nullif(o.order_no,''),o.order_id,''),'customerName',coalesce(c.name,o.delivery_name,''),'customerPhone',coalesce(c.phone,o.delivery_phone,''),'dateNeed',o.date_need,'source',o.source,'status',o.status,'adminStatus',o.admin_status,'productionApproved',coalesce(o.production_approved,false),'publicToken',o.public_token,'adminOrderLink',v_base||'/?admin=v2&order='||coalesce(nullif(o.order_no,''),o.order_id,'')) into v_order from public.orders o left join public.customers c on c.id=o.customer_id where o.id=v_order_id;
  select jsonb_build_object('id',x.id,'status',x.status,'attempts',x.attempts,'lastError',coalesce(x.last_error,x.error,''),'nextAttemptAt',x.next_attempt_at,'lockedAt',x.locked_at,'processedAt',x.processed_at,'queuedAt',case when x.created_at is null then null else to_timestamp(x.created_at/1000.0) end,'payload',x.payload) into v_outbox from public.integration_outbox x where x.order_id=v_order_id and x.provider='activepieces' and x.event_type='clickup.production.create' order by x.created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('componentId',pc.id,'orderItemId',pc.order_item_id,'label',coalesce(pc.label,''),'type',coalesce(pc.component_type,''),'workflow',coalesce(pc.workflow,''),'reviewRequired',coalesce(pc.review_required,false),'reviewStatus',coalesce(pc.review_status,''),'progressPercent',coalesce(pc.progress_percent,0),'previewUrl',pc.preview_url,'clickupTaskId',pc.clickup_task_id,'clickupStatus',pc.clickup_status,'linkSource',pc.clickup_link_source,'taskUrl',case when pc.clickup_task_id is null then null else coalesce(ct.url,'https://app.clickup.com/t/3747262/'||pc.clickup_task_id) end,'item',jsonb_build_object('title',coalesce(i.title,i.product_type,'Item'),'qty',coalesce(i.qty,1),'size',coalesce(i.size,''),'style',coalesce(i.style,''),'wording',coalesce(i.wording,i.custom_text,''),'price',coalesce(i.price,0))) order by coalesce(i.sort_index,999999),pc.created_at,pc.id),'[]'::jsonb) into v_components from public.production_components pc left join public.order_items i on i.id=pc.order_item_id left join public.clickup_tasks ct on ct.component_id=pc.id where pc.order_id=v_order_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.event_kind,'statusFrom',e.status_from,'statusTo',e.status_to,'attempts',e.attempts,'actor',e.actor,'detail',e.detail,'at',e.created_at) order by e.created_at desc),'[]'::jsonb) into v_events from (select * from public.clickup_queue_events where order_id=v_order_id order by created_at desc limit 100) e;
  return jsonb_build_object('order',v_order,'outbox',coalesce(v_outbox,'null'::jsonb),'components',v_components,'events',v_events,'canonicalPayload',public.icetak_clickup_production_payload_data(v_order_id));
end;$function$;
revoke all on function public.icetak_admin_clickup_queue_detail(text) from public, anon;
grant execute on function public.icetak_admin_clickup_queue_detail(text) to authenticated, service_role;

create or replace function public.icetak_admin_clickup_queue_retry(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_order public.orders%rowtype; v_outbox public.integration_outbox%rowtype; v_missing int; v_total int; v_actor text; v_id uuid;
begin
  if not (public.icetak_admin_has_permission('edit_order') or public.icetak_admin_has_permission('quick_arrange')) then raise exception 'Forbidden'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  select count(*)::int,count(*) filter(where clickup_task_id is null)::int into v_total,v_missing from public.production_components where order_id=p_order_id;
  if v_total=0 then raise exception 'No production components'; end if;
  if v_missing=0 then raise exception 'All components already have ClickUp task IDs. Retry blocked.'; end if;
  if not public.icetak_order_is_production_ready(v_order) then raise exception 'Order is not production-ready. Fix/approve the order first.'; end if;
  select * into v_outbox from public.integration_outbox where order_id=p_order_id and provider='activepieces' and event_type='clickup.production.create' order by created_at desc limit 1 for update;
  if v_outbox.id is not null and v_outbox.status='processing' and v_outbox.locked_at is not null and v_outbox.locked_at>now()-interval '10 minutes' then raise exception 'Activepieces is processing this order now. Retry is locked until the processing lease becomes stale.'; end if;
  if v_outbox.id is null then v_id:=public.enqueue_clickup_production_order(p_order_id);
  else update public.integration_outbox set status='retry',locked_at=null,processed_at=null,sent_at=null,next_attempt_at=now(),last_error=null,error=null,payload=public.icetak_clickup_production_payload_data(p_order_id) where id=v_outbox.id returning id into v_id; end if;
  v_actor:=coalesce(auth.uid()::text,'admin');
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload,created_at,meta) values(p_order_id::text,coalesce(nullif(v_order.order_no,''),v_order.order_id,''),'clickup_queue_retry',v_actor,jsonb_build_object('outbox_id',v_id,'missing_components',v_missing,'attempts_before',coalesce(v_outbox.attempts,0)),extract(epoch from now())*1000,jsonb_build_object('source','admin_v2_clickup_queue'));
  return public.icetak_admin_clickup_queue_detail(p_order_id::text);
end;$function$;
revoke all on function public.icetak_admin_clickup_queue_retry(uuid) from public, anon;
grant execute on function public.icetak_admin_clickup_queue_retry(uuid) to authenticated, service_role;
