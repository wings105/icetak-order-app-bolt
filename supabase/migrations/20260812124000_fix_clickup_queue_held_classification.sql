-- Distinguish normal production holds from real AP/ClickUp queue failures.
-- HELD is not an error and is excluded from Attention/Failed.

create or replace function public.icetak_clickup_hold_reason(p_order public.orders)
returns text
language sql
stable security definer
set search_path to 'public','pg_temp'
as $function$
select case
  when lower(coalesce(p_order.status,'')) in ('cancelled','completed','delivered','customer collected')
    or lower(coalesce(p_order.fulfillment_stage,'')) in ('cancelled','collected','delivered','completed')
    then 'Order sudah terminal / selesai'
  when p_order.customer_confirm_token is not null and not coalesce(p_order.customer_confirmed,false)
    then 'Waiting customer confirmation'
  when lower(coalesce(p_order.source,'')) in ('qrpay_ai','pickup_ai') and not coalesce(p_order.production_approved,false)
    then 'AI production approval required'
  when lower(coalesce(p_order.delivery_method,p_order.delivery,'')) like '%pickup%'
    and (lower(coalesce(p_order.payment_status,''))='cash_counter' or lower(coalesce(p_order.payment_method,p_order.payment,'')) in ('cash at counter','cash counter','cash','counter','pay at pickup'))
    and not coalesce(p_order.production_approved,false)
    then 'Production approval required for Cash at Counter pickup'
  when not (
    lower(coalesce(p_order.payment_status,'')) in ('paid','matched','payment_received','success','completed')
    or lower(coalesce(p_order.payment,''))='paid'
    or (
      lower(coalesce(p_order.delivery_method,p_order.delivery,'')) like '%pickup%'
      and coalesce(p_order.customer_confirmed,false)
      and coalesce(p_order.production_approved,false)
      and (lower(coalesce(p_order.payment_status,''))='cash_counter' or lower(coalesce(p_order.payment_method,p_order.payment,'')) in ('cash at counter','cash counter','cash','counter','pay at pickup'))
    )
  ) then 'Payment / production gate not ready'
  else 'Order is not production-ready'
end;
$function$;

create or replace function public.icetak_admin_clickup_queue(
  p_status text default 'attention',
  p_query text default '',
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_result jsonb;
  v_page int:=greatest(1,coalesce(p_page,1));
  v_size int:=least(100,greatest(10,coalesce(p_page_size,50)));
  v_status text:=lower(coalesce(p_status,'attention'));
  v_query text:=lower(trim(coalesce(p_query,'')));
begin
  if not public.icetak_admin_has_permission('view_orders') then raise exception 'Forbidden'; end if;
  with latest_outbox as (
    select distinct on(order_id) id,order_id,status,attempts,last_error,error,next_attempt_at,locked_at,processed_at,created_at,payload
    from public.integration_outbox
    where provider='activepieces' and event_type='clickup.production.create' and order_id is not null
    order by order_id,created_at desc,id desc
  ),
  comp as (
    select pc.order_id,
      count(*)::int total,
      count(*) filter(where pc.clickup_task_id is not null)::int linked,
      count(*) filter(where pc.clickup_task_id is null)::int missing,
      max(pc.last_synced_at) last_task_at,
      string_agg(distinct coalesce(pc.label,pc.component_type,'Component'),', ' order by coalesce(pc.label,pc.component_type,'Component')) component_summary,
      jsonb_agg(jsonb_build_object(
        'componentId',pc.id,'label',coalesce(pc.label,''),'type',coalesce(pc.component_type,''),
        'clickupTaskId',pc.clickup_task_id,'clickupStatus',pc.clickup_status,'linkSource',pc.clickup_link_source,
        'taskUrl',case when pc.clickup_task_id is null then null else coalesce(ct.url,'https://app.clickup.com/t/3747262/'||pc.clickup_task_id) end
      ) order by pc.created_at,pc.id) components
    from public.production_components pc
    left join public.clickup_tasks ct on ct.component_id=pc.id
    group by pc.order_id
  ),
  raw as (
    select o.id order_id,
      coalesce(nullif(o.order_no,''),o.order_id,'') order_no,
      coalesce(c.name,o.delivery_name,'') customer_name,
      coalesce(c.phone,o.delivery_phone,'') customer_phone,
      o.date_need,o.source,o.created_at order_created_at,o.public_token,o.status order_status,o.fulfillment_stage,
      lo.id outbox_id,coalesce(lo.status,'') outbox_status,coalesce(lo.attempts,0) attempts,
      coalesce(lo.last_error,lo.error,'') last_error,lo.next_attempt_at,lo.locked_at,lo.processed_at,
      case when lo.created_at is null then null else to_timestamp(lo.created_at/1000.0) end queued_at,
      lo.payload,
      coalesce(comp.total,0) components_total,coalesce(comp.linked,0) components_linked,coalesce(comp.missing,0) components_missing,
      comp.component_summary,coalesce(comp.components,'[]'::jsonb) components,comp.last_task_at,
      (lower(coalesce(o.status,'')) in ('completed','delivered','cancelled') or lower(coalesce(o.fulfillment_stage,'')) in ('completed','delivered','collected','cancelled')) is_terminal,
      public.icetak_order_is_production_ready(o) production_ready,
      case when public.icetak_order_is_production_ready(o) then null else public.icetak_clickup_hold_reason(o) end hold_reason
    from public.orders o
    left join public.customers c on c.id=o.customer_id
    left join latest_outbox lo on lo.order_id=o.id
    left join comp on comp.order_id=o.id
    where coalesce(comp.total,0)>0 or lo.id is not null
  ),
  base as (
    select r.*,case
      when r.components_total>0 and r.components_linked=r.components_total then 'success'
      when r.is_terminal then 'archived'
      when not r.production_ready and r.components_missing>0 then 'held'
      when r.components_linked>0 and r.components_missing>0 then 'partial'
      when r.outbox_id is null and r.components_missing>0 then 'missing_queue'
      when lower(r.outbox_status)='skipped' then 'held'
      when lower(r.outbox_status)='processing' and r.locked_at<now()-interval '10 minutes' then 'stale'
      when lower(r.outbox_status)='processing' then 'processing'
      when lower(r.outbox_status)='retry' then 'retrying'
      when lower(r.outbox_status)='pending' then 'waiting'
      when lower(r.outbox_status) in ('error','failed') then 'failed'
      when lower(r.outbox_status)='processed' and r.components_missing>0 then 'data_problem'
      when r.components_total=0 then 'no_components'
      else coalesce(nullif(lower(r.outbox_status),''),'unknown') end derived_status
    from raw r
  ),
  filtered as (
    select * from base b
    where (v_query='' or lower(concat_ws(' ',b.order_no,b.customer_name,b.customer_phone,b.component_summary,b.last_error,b.hold_reason,b.outbox_status)) like '%'||v_query||'%')
      and (v_status in ('','all')
        or (v_status='attention' and b.derived_status in ('failed','stale','data_problem','missing_queue','partial'))
        or (v_status='failed' and b.derived_status in ('failed','stale','data_problem','missing_queue'))
        or b.derived_status=v_status)
  ),
  ordered as (
    select * from filtered
    order by case derived_status
      when 'failed' then 0 when 'stale' then 1 when 'data_problem' then 2 when 'missing_queue' then 3
      when 'partial' then 4 when 'retrying' then 5 when 'processing' then 6 when 'waiting' then 7
      when 'held' then 10 when 'success' then 20 when 'archived' then 30 else 15 end,
      coalesce(queued_at,order_created_at) desc,order_id
  ),
  page_rows as (select * from ordered offset ((v_page-1)*v_size) limit v_size),
  summary as (
    select jsonb_build_object(
      'all',count(*),
      'attention',count(*) filter(where derived_status in ('failed','stale','data_problem','missing_queue','partial')),
      'waiting',count(*) filter(where derived_status='waiting'),
      'processing',count(*) filter(where derived_status='processing'),
      'retrying',count(*) filter(where derived_status='retrying'),
      'partial',count(*) filter(where derived_status='partial'),
      'failed',count(*) filter(where derived_status in ('failed','stale','data_problem','missing_queue')),
      'held',count(*) filter(where derived_status='held'),
      'success',count(*) filter(where derived_status='success'),
      'archived',count(*) filter(where derived_status='archived'),
      'successToday',count(*) filter(where derived_status='success' and coalesce(processed_at,last_task_at)::date=current_date)
    ) value from base
  )
  select jsonb_build_object(
    'summary',(select value from summary),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'orderDbId',r.order_id,'orderNo',r.order_no,'customerName',r.customer_name,'customerPhone',r.customer_phone,
      'dateNeed',r.date_need,'source',r.source,'orderCreatedAt',r.order_created_at,'publicToken',r.public_token,
      'outboxId',r.outbox_id,'outboxStatus',r.outbox_status,'status',r.derived_status,'attempts',r.attempts,
      'lastError',r.last_error,'holdReason',r.hold_reason,'productionReady',r.production_ready,
      'queuedAt',r.queued_at,'lockedAt',r.locked_at,'nextAttemptAt',r.next_attempt_at,'processedAt',r.processed_at,
      'componentsTotal',r.components_total,'componentsLinked',r.components_linked,'componentsMissing',r.components_missing,
      'componentSummary',r.component_summary,'components',r.components
    )) from page_rows r),'[]'::jsonb),
    'pagination',jsonb_build_object('page',v_page,'pageSize',v_size,'total',(select count(*) from filtered),'totalPages',greatest(1,ceil((select count(*) from filtered)::numeric/v_size)::int)),
    'serverTime',now()
  ) into v_result;
  return v_result;
end;
$function$;

create or replace function public.icetak_admin_clickup_queue_detail(p_order_ref text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_order_id uuid;
  v_outbox jsonb;
  v_components jsonb;
  v_events jsonb;
  v_order jsonb;
  v_base text:=coalesce(public.icetak_public_app_base_url(),'https://icetak.bolt.host');
begin
  if not public.icetak_admin_has_permission('view_orders') then raise exception 'Forbidden'; end if;
  v_order_id:=public.resolve_shipping_order_reference(p_order_ref);
  if v_order_id is null then select id into v_order_id from public.orders where order_no=p_order_ref or order_id=p_order_ref limit 1; end if;
  if v_order_id is null then raise exception 'Order not found'; end if;
  select jsonb_build_object(
    'id',o.id,'orderNo',coalesce(nullif(o.order_no,''),o.order_id,''),
    'customerName',coalesce(c.name,o.delivery_name,''),'customerPhone',coalesce(c.phone,o.delivery_phone,''),
    'dateNeed',o.date_need,'source',o.source,'status',o.status,'adminStatus',o.admin_status,
    'productionApproved',coalesce(o.production_approved,false),'productionReady',public.icetak_order_is_production_ready(o),
    'holdReason',case when public.icetak_order_is_production_ready(o) then null else public.icetak_clickup_hold_reason(o) end,
    'publicToken',o.public_token,'adminOrderLink',v_base||'/?admin=v2&order='||coalesce(nullif(o.order_no,''),o.order_id,'')
  ) into v_order
  from public.orders o left join public.customers c on c.id=o.customer_id where o.id=v_order_id;
  select jsonb_build_object('id',x.id,'status',x.status,'attempts',x.attempts,'lastError',coalesce(x.last_error,x.error,''),'nextAttemptAt',x.next_attempt_at,'lockedAt',x.locked_at,'processedAt',x.processed_at,'queuedAt',case when x.created_at is null then null else to_timestamp(x.created_at/1000.0) end,'payload',x.payload)
  into v_outbox from public.integration_outbox x where x.order_id=v_order_id and x.provider='activepieces' and x.event_type='clickup.production.create' order by x.created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'componentId',pc.id,'orderItemId',pc.order_item_id,'label',coalesce(pc.label,''),'type',coalesce(pc.component_type,''),
    'workflow',coalesce(pc.workflow,''),'reviewRequired',coalesce(pc.review_required,false),'reviewStatus',coalesce(pc.review_status,''),
    'progressPercent',coalesce(pc.progress_percent,0),'previewUrl',pc.preview_url,'clickupTaskId',pc.clickup_task_id,
    'clickupStatus',pc.clickup_status,'linkSource',pc.clickup_link_source,
    'taskUrl',case when pc.clickup_task_id is null then null else coalesce(ct.url,'https://app.clickup.com/t/3747262/'||pc.clickup_task_id) end,
    'item',jsonb_build_object('title',coalesce(i.title,i.product_type,'Item'),'qty',coalesce(i.qty,1),'size',coalesce(i.size,''),'style',coalesce(i.style,''),'wording',coalesce(i.wording,i.custom_text,''),'price',coalesce(i.price,0))
  ) order by coalesce(i.sort_index,999999),pc.created_at,pc.id),'[]'::jsonb)
  into v_components
  from public.production_components pc
  left join public.order_items i on i.id=pc.order_item_id
  left join public.clickup_tasks ct on ct.component_id=pc.id
  where pc.order_id=v_order_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.event_kind,'statusFrom',e.status_from,'statusTo',e.status_to,'attempts',e.attempts,'actor',e.actor,'detail',e.detail,'at',e.created_at) order by e.created_at desc),'[]'::jsonb)
  into v_events from (select * from public.clickup_queue_events where order_id=v_order_id order by created_at desc limit 100) e;
  return jsonb_build_object('order',v_order,'outbox',coalesce(v_outbox,'null'::jsonb),'components',v_components,'events',v_events,'canonicalPayload',public.icetak_clickup_production_payload_data(v_order_id));
end;
$function$;

create or replace function public.icetak_admin_clickup_queue_retry(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_order public.orders%rowtype;
  v_outbox public.integration_outbox%rowtype;
  v_missing int;
  v_total int;
  v_actor text;
  v_id uuid;
  v_hold_reason text;
begin
  if not (public.icetak_admin_has_permission('edit_order') or public.icetak_admin_has_permission('quick_arrange')) then raise exception 'Forbidden'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  select count(*)::int,count(*) filter(where clickup_task_id is null)::int into v_total,v_missing from public.production_components where order_id=p_order_id;
  if v_total=0 then raise exception 'No production components'; end if;
  if v_missing=0 then raise exception 'All components already have ClickUp task IDs. Retry blocked.'; end if;
  if not public.icetak_order_is_production_ready(v_order) then
    v_hold_reason:=public.icetak_clickup_hold_reason(v_order);
    raise exception 'Held: %. Open/Fix the order first; AP has not received this job.',coalesce(v_hold_reason,'Order is not production-ready');
  end if;
  select * into v_outbox from public.integration_outbox where order_id=p_order_id and provider='activepieces' and event_type='clickup.production.create' order by created_at desc limit 1 for update;
  if v_outbox.id is not null and v_outbox.status='processing' and v_outbox.locked_at is not null and v_outbox.locked_at>now()-interval '10 minutes' then
    raise exception 'Activepieces is processing this order now. Retry is locked until the processing lease becomes stale.';
  end if;
  if v_outbox.id is null then
    v_id:=public.enqueue_clickup_production_order(p_order_id);
  else
    update public.integration_outbox set status='retry',locked_at=null,processed_at=null,sent_at=null,next_attempt_at=now(),last_error=null,error=null,payload=public.icetak_clickup_production_payload_data(p_order_id) where id=v_outbox.id returning id into v_id;
  end if;
  v_actor:=coalesce(auth.uid()::text,'admin');
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload,created_at,meta)
  values(p_order_id::text,coalesce(nullif(v_order.order_no,''),v_order.order_id,''),'clickup_queue_retry',v_actor,jsonb_build_object('outbox_id',v_id,'missing_components',v_missing,'attempts_before',coalesce(v_outbox.attempts,0)),extract(epoch from now())*1000,jsonb_build_object('source','admin_v2_clickup_queue'));
  return public.icetak_admin_clickup_queue_detail(p_order_id::text);
end;
$function$;
