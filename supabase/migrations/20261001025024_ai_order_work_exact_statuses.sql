-- Exact legacy status fallbacks, limited to the operational read model.
create or replace function public.icetak_project_clickup_work(p_task jsonb, p_observed_at timestamptz default now())
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_id text:=nullif(p_task->>'id',''); v_field jsonb; v_opt jsonb; v_value text;
 v_ref text; v_order uuid; v_market uuid; v_component uuid; v_explicit text;
 v_map text:='unlinked'; v_status text; v_review text; v_scope text:='print';
 v_labels jsonb:='[]'; v_updated timestamptz; v_resolution record; v_count int;
begin
 -- Only full task snapshots from the production lists; minimal webhook patches cannot erase state.
 if v_id is null or jsonb_typeof(p_task->'custom_fields') is distinct from 'array'
    or coalesce(p_task#>>'{list,id}','') not in ('18375902','901612769752') then return false; end if;
 if coalesce(p_task->>'date_updated','') !~ '^\d{10,16}$' then return false; end if;
 if (p_task->>'date_updated')::numeric not between 946684800000 and 4102444800000 then return false; end if;
 v_updated:=to_timestamp((p_task->>'date_updated')::numeric/1000);
 if v_updated > p_observed_at + interval '10 minutes' then return false; end if;
 v_status:=coalesce(p_task#>>'{status,status}',case when jsonb_typeof(p_task->'status')='string' then p_task->>'status' end);
 for v_field in select value from jsonb_array_elements(p_task->'custom_fields') loop
  v_value:=nullif(trim(v_field->>'value'),'');
  case lower(trim(v_field->>'name'))
   when 'order id / customer name' then v_ref:=v_value;
   when 'webapp order id' then v_explicit:=v_value;
   when 'webapp component id' then
    if v_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_component:=v_value::uuid; end if;
   when 'review customer' then
    select coalesce(o->>'name',o->>'label') into v_review
    from jsonb_array_elements(coalesce(v_field#>'{type_config,options}','[]')) o
    where o->>'id'=v_value or o->>'orderindex'=v_value limit 1;
   when 'set' then
    if jsonb_typeof(v_field->'value')='array' then
     select coalesce(jsonb_agg(coalesce(o->>'label',o->>'name')),'[]') into v_labels
     from jsonb_array_elements(coalesce(v_field#>'{type_config,options}','[]')) o
     where (v_field->'value') ? (o->>'id');
    end if;
   when 'job' then
    if jsonb_typeof(v_field->'value')='array' then
     for v_opt in select o from jsonb_array_elements(coalesce(v_field#>'{type_config,options}','[]')) o where (v_field->'value') ? (o->>'id') loop
      v_value:=lower(coalesce(v_opt->>'label',v_opt->>'name',''));
      if v_value like '%acrylic%' then v_scope:='acrylic'; exit;
      elsif v_value like '%edible%' then v_scope:='edible';
      elsif v_value like '%wafer%' then v_scope:='wafer'; end if;
     end loop;
    end if;
   else null;
  end case;
 end loop;
 if v_explicit ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  select id into v_order from orders where id=v_explicit::uuid;
  if v_order is not null then v_map:='webapp_id'; end if;
 end if;
 if v_order is null then
  select count(distinct order_id) into v_count from (
   select order_id from production_components where clickup_task_id=v_id
   union select order_id from clickup_tasks where clickup_task_id=v_id
   union select id from orders where clickup_order_task_id=v_id
  ) links;
  if v_count=1 then
   select order_id into v_order from (
    select order_id from production_components where clickup_task_id=v_id
    union select order_id from clickup_tasks where clickup_task_id=v_id
    union select id from orders where clickup_order_task_id=v_id
   ) links limit 1;
   v_map:='task_link';
  elsif v_count>1 then v_map:='conflict'; end if;
 end if;
 if v_order is null and v_map<>'conflict' and v_ref is not null then
  select count(*) into v_count from orders where upper(order_no)=upper(v_ref);
  if v_count=1 then select id into v_order from orders where upper(order_no)=upper(v_ref); v_map:='exact_reference';
  elsif v_count>1 then v_map:='conflict'; end if;
 end if;
 if v_ref is not null then
  select count(*) into v_count from marketplace_orders where upper(order_sn)=upper(v_ref);
  if v_count=1 then select id into v_market from marketplace_orders where upper(order_sn)=upper(v_ref);
  elsif v_count>1 then v_map:='conflict'; v_market:=null; end if;
  if v_order is null and v_market is not null then v_map:='exact_reference'; end if;
 end if;
 -- Conflicting explicit/reference mapping fails closed. A real marketplace internal link is valid.
 if v_order is not null and v_market is not null and not exists(select 1 from marketplace_orders where id=v_market and internal_order_id=v_order) then
  v_map:='conflict'; v_order:=null; v_market:=null;
 end if;
 if v_order is not null and v_ref is not null and exists(select 1 from orders where upper(order_no)=upper(v_ref) and id<>v_order) then v_map:='conflict'; v_order:=null; v_market:=null; end if;
 if v_component is not null and not exists(select 1 from production_components where id=v_component and order_id=v_order) then v_component:=null; end if;
 if v_component is null and v_order is not null then
  select id into v_component from production_components where order_id=v_order and clickup_task_id=v_id limit 1;
 end if;
 -- Literal production status identifies scope even when the legacy job field is absent.
 v_scope:=case lower(trim(v_status)) when 'design edible image' then 'edible' when 'edible image -printing' then 'edible' when 'acrylic' then 'acrylic' when 'wafer paper' then 'wafer' when 'design editing -topper' then 'print' else v_scope end;
 select * into v_resolution from clickup_resolve_progress(v_scope,v_status,v_review,null);
 if not v_resolution.matched and lower(trim(v_status)) in ('edible image -printing','ready stock') then
  v_resolution.matched:=true;
  v_resolution.progress_stage:=case when lower(trim(v_status))='ready stock' then 7 else 5 end;
  v_resolution.progress_percent:=case when lower(trim(v_status))='ready stock' then 100 else 67 end;
  v_resolution.customer_stage:=case when lower(trim(v_status))='ready stock' then 'Ready stock' else 'Production' end;
  v_resolution.review_status:='none';
 end if;
 insert into ai_clickup_work_snapshots(task_id,task_name,list_id,order_reference,order_id,marketplace_order_id,component_id,mapping_status,set_labels,clickup_status,review_status,customer_stage,progress_stage,progress_percent,rule_matched,normalized_review_state,source_updated_at,observed_at)
 values(v_id,p_task->>'name',p_task#>>'{list,id}',v_ref,v_order,v_market,v_component,v_map,v_labels,v_status,v_resolution.review_status,v_resolution.customer_stage,v_resolution.progress_stage,v_resolution.progress_percent,v_resolution.matched,v_resolution.normalized_review_state,v_updated,p_observed_at)
 on conflict(task_id) do update set task_name=excluded.task_name,list_id=excluded.list_id,order_reference=excluded.order_reference,
 order_id=excluded.order_id,marketplace_order_id=excluded.marketplace_order_id,component_id=excluded.component_id,mapping_status=excluded.mapping_status,set_labels=excluded.set_labels,
 clickup_status=excluded.clickup_status,review_status=excluded.review_status,customer_stage=excluded.customer_stage,progress_stage=excluded.progress_stage,progress_percent=excluded.progress_percent,rule_matched=excluded.rule_matched,
 normalized_review_state=excluded.normalized_review_state,
 change_requested_at=case
  when excluded.normalized_review_state='edit_requested' and coalesce(ai_clickup_work_snapshots.normalized_review_state,'none')<>'edit_requested'
   and ai_clickup_work_snapshots.progress_stage>=5 and excluded.source_updated_at>ai_clickup_work_snapshots.source_updated_at then excluded.source_updated_at
  when excluded.normalized_review_state='approved' or (excluded.clickup_status is distinct from ai_clickup_work_snapshots.clickup_status and excluded.progress_stage>=5) then null
  else ai_clickup_work_snapshots.change_requested_at end,
 source_updated_at=excluded.source_updated_at,observed_at=excluded.observed_at,projected_at=now()
 where (excluded.source_updated_at,excluded.observed_at)>=(ai_clickup_work_snapshots.source_updated_at,ai_clickup_work_snapshots.observed_at);
 return found;
end $$;

-- Repair only the private derived cache; canonical progress rules/components remain untouched.
update ai_clickup_work_snapshots s set rule_matched=true,progress_stage=r.progress_stage,progress_percent=r.progress_percent,customer_stage=r.customer_stage,review_status=r.review_status
from clickup_progress_rules r
where not s.rule_matched and r.active and r.status_name=s.clickup_status and r.review_state=s.normalized_review_state
and r.component_scope=case s.clickup_status when 'design edible image' then 'edible' when 'acrylic' then 'acrylic' when 'wafer paper' then 'wafer' when 'design editing -topper' then 'print' end;
update ai_clickup_work_snapshots set rule_matched=true,progress_stage=case when clickup_status='ready stock' then 7 else 5 end,
progress_percent=case when clickup_status='ready stock' then 100 else 67 end,customer_stage=case when clickup_status='ready stock' then 'Ready stock' else 'Production' end,review_status='none'
where not rule_matched and clickup_status in ('edible image -printing','ready stock');
create or replace function public.icetak_ai_order_work_queue() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with eligible as (
  select * from ai_order_work_source where lower(replace(status,' ','_')) not in ('completed','customer_collected','cancelled','canceled','returned','refunded','shipped','to_confirm_receive','out_for_delivery')
 or exists(select 1 from jsonb_array_elements(production_tasks) t where t->>'change_requested_at' is not null)
 or exists(select 1 from jsonb_array_elements(logistics) t where lower(coalesce(t->>'status','')) in ('logistics_delivery_failed','delivery_failed','exception','return_to_sender'))
 ), page as (select * from eligible order by deadline nulls last,id limit 2000)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),
 'total',(select count(*) from eligible),'has_more',(select count(*)>2000 from eligible),'checked_at',now(),
 'sync',jsonb_build_object('latest_event_at',(select max(received_at) from clickup_webhook_events),
 'latest_projection_at',(select max(projected_at) from ai_clickup_work_snapshots),
 'unlinked',(select count(*) from ai_clickup_work_snapshots where mapping_status in ('unlinked','conflict') and lower(coalesce(clickup_status,'')) not in ('prospect','lain2')),
 'refresh_mode','webhook + hourly stored-snapshot reconciliation'));
$$;
