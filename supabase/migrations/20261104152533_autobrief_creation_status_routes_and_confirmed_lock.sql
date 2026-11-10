
create table public.clickup_autobrief_routes (
 task_id text primary key, initial_status text not null, profile text not null,
 task_created_at timestamptz not null, captured_from text not null,
 confirmed_at timestamptz, captured_at timestamptz not null default now()
);
alter table public.clickup_autobrief_routes enable row level security;
revoke all on public.clickup_autobrief_routes from public,anon,authenticated;
grant select,insert,update on public.clickup_autobrief_routes to service_role;
create function clickup_gate.autobrief_profile(p_status text) returns text
language sql immutable set search_path='' as $$
 select case lower(btrim(coalesce(p_status,'')))
 when 'design editing -topper' then 'glossy' when 'acrylic' then 'acrylic'
 when 'design edible image' then 'edible' when 'edible editing' then 'edible'
 when 'wafer' then 'wafer' when 'wafer paper' then 'wafer' when 'design wafer' then 'wafer'
 else 'unsupported' end;
$$;
create function clickup_gate.capture_autobrief_route() returns trigger
language plpgsql security definer set search_path='' as $$
declare st text; tid text; at_time timestamptz; source text; ms text;
begin
 if tg_table_name='clickup_webhook_events' then
  if new.list_id is distinct from '18375902' then return new;end if;
  if new.changed_field='task_creation' or new.event_type='taskCreated'
   or (new.changed_field='status' and new.before_value->>'status' is null and new.after_value->>'status' is not null) then
   tid:=new.task_id;st:=coalesce(new.after_value->>'status',new.current_status);
   ms:=new.raw_payload->'task'->>'date_created';
   at_time:=case when ms ~ '^[0-9]{13}$' then to_timestamp(ms::numeric/1000) else new.received_at end;
   source:='creation_webhook';
  else return new;end if;
 else
  if new.clickup_task_id is null or (tg_op='UPDATE' and old.clickup_task_id is not null) then return new;end if;
  tid:=new.clickup_task_id;st:=new.clickup_status;at_time:=now();source:='creation_component_link';
 end if;
 if tid is not null and nullif(btrim(st),'') is not null then
  insert into public.clickup_autobrief_routes(task_id,initial_status,profile,task_created_at,captured_from)
  values(tid,lower(btrim(st)),clickup_gate.autobrief_profile(st),at_time,source) on conflict(task_id) do nothing;
 end if;
 return new;
end;$$;
create trigger capture_autobrief_creation after insert on public.clickup_webhook_events
for each row execute function clickup_gate.capture_autobrief_route();
create trigger capture_autobrief_component after insert or update of clickup_task_id on public.production_components
for each row execute function clickup_gate.capture_autobrief_route();
-- Actual creation evidence takes priority; a later status is never used as a substitute.
insert into public.clickup_autobrief_routes(task_id,initial_status,profile,task_created_at,captured_from)
select distinct on(e.task_id) e.task_id,lower(btrim(coalesce(e.after_value->>'status',e.current_status))),
 clickup_gate.autobrief_profile(coalesce(e.after_value->>'status',e.current_status)),
 case when e.raw_payload->'task'->>'date_created' ~ '^[0-9]{13}$' then to_timestamp((e.raw_payload->'task'->>'date_created')::numeric/1000) else e.received_at end,
 'creation_webhook_backfill'
from public.clickup_webhook_events e
where e.list_id='18375902' and e.task_id is not null
 and (e.changed_field='task_creation' or e.event_type='taskCreated'
  or(e.changed_field='status' and e.before_value->>'status' is null and e.after_value->>'status' is not null))
 and nullif(btrim(coalesce(e.after_value->>'status',e.current_status)),'') is not null
order by e.task_id,e.received_at on conflict(task_id) do nothing;
-- Existing briefs retain their original rule; never restart a historical confirmed brief.
insert into public.clickup_autobrief_routes(task_id,initial_status,profile,task_created_at,captured_from)
select j.task_id,case when j.brief->>'profile'='acrylic-internal-v1' then 'acrylic' else 'design editing -topper' end,
 case when j.brief->>'profile'='acrylic-internal-v1' then 'acrylic' else 'glossy' end,j.created_at,'existing_brief'
from public.clickup_order_brief_jobs j where j.comment_id is not null on conflict(task_id) do nothing;
update public.clickup_autobrief_routes r set confirmed_at=coalesce(nullif(j.brief->>'confirmed_at','')::timestamptz,j.completed_at,j.updated_at)
from public.clickup_order_brief_jobs j where j.task_id=r.task_id and j.brief->>'confirmed'='true' and j.comment_id is not null;
create function clickup_gate.protect_autobrief_route() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.task_id,new.initial_status,new.profile,new.task_created_at,new.captured_from) is distinct from
    (old.task_id,old.initial_status,old.profile,old.task_created_at,old.captured_from)
 or(old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at) then
 raise exception 'AUTOBRIEF_ROUTE_IMMUTABLE';end if;return new;
end;$$;
create trigger protect_autobrief_route before update on public.clickup_autobrief_routes
for each row execute function clickup_gate.protect_autobrief_route();

create function clickup_gate.claim_brief_profile(p_profile text,p_task_id text default null,p_limit integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare enabled boolean; jobs jsonb;
begin
 select s.enabled and (p_profile<>'acrylic' or s.acrylic_enabled) into enabled from public.clickup_order_brief_settings s where singleton;
 if not coalesce(enabled,false) then return jsonb_build_object('enabled',false,'jobs','[]'::jsonb);end if;
 if p_profile not in('glossy','acrylic') then return jsonb_build_object('enabled',false,'reason','RULE_NOT_CONFIGURED','jobs','[]'::jsonb);end if;
 insert into public.clickup_order_brief_jobs(task_id,order_reference,source_fingerprint,content_hash,state,next_poll_at)
 select s.task_id,s.order_reference,coalesce(nullif(a.data->>'fingerprint',''),md5(s.task_id||r.task_created_at::text)),
  md5(concat_ws('|',s.task_name,a.data->>'fingerprint')),'pending',now()
 from public.ai_clickup_work_snapshots s join public.clickup_autobrief_routes r using(task_id)
 left join public.task_detail_automation a using(task_id)
 left join public.orders o on o.id=s.order_id left join public.marketplace_orders m on m.id=s.marketplace_order_id
 where r.profile=p_profile and s.list_id='18375902' and lower(btrim(s.clickup_status))=r.initial_status
 and s.order_reference not ilike '%TEST%' and r.task_created_at<=now()-interval '15 minutes'
 and (p_task_id is null or s.task_id=p_task_id)
 and (p_task_id is not null or coalesce(o.created_at,m.first_seen_at)>=
  (select case when p_profile='acrylic' then acrylic_rollout_after else rollout_after end from public.clickup_order_brief_settings where singleton))
 and (p_profile='acrylic' or (coalesce(a.data->>'fingerprint','')<>'' and a.data->>'info_status' in('ready','missing','review')))
 on conflict(task_id) do update set source_fingerprint=excluded.source_fingerprint,content_hash=excluded.content_hash,
  next_poll_at=now(),state='pending',attempts=0,next_attempt_at=now(),last_error=null,updated_at=now()
 where public.clickup_order_brief_jobs.content_hash is distinct from excluded.content_hash
  and not exists(select 1 from public.clickup_autobrief_routes locked where locked.task_id=excluded.task_id and locked.confirmed_at is not null)
  and (public.clickup_order_brief_jobs.lease_until is null or public.clickup_order_brief_jobs.lease_until<now());
 with candidates as(
 select j.task_id from public.clickup_order_brief_jobs j join public.clickup_autobrief_routes r using(task_id)
 join public.ai_clickup_work_snapshots s using(task_id)
 where r.profile=p_profile and s.list_id='18375902' and (p_task_id is null or j.task_id=p_task_id)
 and (r.confirmed_at is not null or lower(btrim(s.clickup_status))=r.initial_status)
 and (r.confirmed_at is null or r.confirmed_at>=now()-interval '30 days')
 and r.task_created_at<=now()-interval '15 minutes'
 and (j.lease_until is null or j.lease_until<now())
 and (p_task_id is not null or (j.state in('pending','failed') and j.next_attempt_at<=now() and j.attempts<5)
  or(j.state='processing' and j.attempts<5) or(j.state in('completed','review') and j.next_poll_at<=now()))
 order by case when j.state in('pending','failed') then 0 else 1 end,j.next_poll_at,j.created_at
 limit greatest(1,least(p_limit,5)) for update of j skip locked
 ), changed as(
 update public.clickup_order_brief_jobs j set state='processing',lease_until=now()+interval '4 minutes',
  attempts=case when j.state in('completed','review') then 1 else j.attempts+1 end,last_polled_at=now(),updated_at=now()
 from candidates c where c.task_id=j.task_id returning j.*
 )select coalesce(jsonb_agg(to_jsonb(changed)),'[]'::jsonb) into jobs from changed;
 return jsonb_build_object('enabled',true,'jobs',jobs);
end;$$;
create or replace function clickup_gate.claim_order_briefs() returns jsonb language sql security definer set search_path='' as $$
 select clickup_gate.claim_brief_profile('glossy',null,(select batch_size from public.clickup_order_brief_settings where singleton));$$;
create or replace function public.icetak_claim_acrylic_briefs(p_task_id text default null) returns jsonb language sql security definer set search_path='' as $$
 select clickup_gate.claim_brief_profile('acrylic',p_task_id,1);$$;

CREATE OR REPLACE FUNCTION public.icetak_acrylic_direct_scope(p_order_id uuid, p_task_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare o public.orders; i public.order_items; se public.order_sessions; d public.qrpay_order_drafts;
 v_phone text; start_at timestamptz; end_at timestamptz; n integer; selected uuid; convo uuid;
begin
 select * into o from public.orders where id=p_order_id;
 if not found or not exists(select 1 from public.ai_clickup_work_snapshots s where s.task_id=p_task_id and s.order_id=o.id and s.marketplace_order_id is null and s.list_id='18375902' and lower(btrim(s.clickup_status))='acrylic' and exists(select 1 from public.clickup_autobrief_routes r where r.task_id=s.task_id and r.profile='acrylic')) then return jsonb_build_object('eligible',false,'reason','EXACT_ORDER_TASK_REQUIRED');end if;
 if lower(coalesce(o.status,'')) ~ 'cancel|shipped|complete|delivered|collected' or lower(coalesce(o.shipment_status_group,'')) ~ 'shipped|delivered|collected' or o.production_completed_at is not null or o.pickup_collected_at is not null or o.delivered_at is not null then return jsonb_build_object('eligible',false,'reason','ORDER_CLOSED');end if;
 select count(*),min(pc.order_item_id::text)::uuid into n,selected from public.production_components pc where pc.order_id=o.id and pc.clickup_task_id=p_task_id;
 if n<>1 or selected is null then return jsonb_build_object('eligible',false,'reason','EXACT_COMPONENT_REQUIRED');end if;
 select * into i from public.order_items where id=selected and order_id=o.id ;
 if not found then return jsonb_build_object('eligible',false,'reason','ACRYLIC_ONLY');end if;
 select count(*) into n from public.qrpay_order_drafts where order_id=o.id and status='confirmed';
 if n>1 then return jsonb_build_object('eligible',false,'reason','MULTIPLE_DRAFT_SESSIONS');end if;
 select * into d from public.qrpay_order_drafts where order_id=o.id and status='confirmed';
 if d.id is not null then
  select * into se from public.order_sessions where id=d.order_session_id and order_id=o.id;
  if not found or (d.conversation_id is not null and se.conversation_id is distinct from d.conversation_id) then return jsonb_build_object('eligible',false,'reason','DRAFT_SESSION_MISMATCH');end if;
 else
  select count(*) into n from public.order_sessions where order_id=o.id;
  if n>1 then return jsonb_build_object('eligible',false,'reason','MULTIPLE_ORDER_SESSIONS');end if;
  select * into se from public.order_sessions where order_id=o.id;
 end if;
 convo:=coalesce(se.conversation_id,d.conversation_id);
 select regexp_replace(coalesce(nullif(se.customer_phone,''),nullif(d.customer_phone,''),nullif(o.delivery_phone,''),c.phone,''),'[^0-9]','','g') into v_phone from public.customers c where c.id=o.customer_id;
 if left(v_phone,1)='0' then v_phone:='6'||v_phone;elsif left(v_phone,1)='1' then v_phone:='60'||v_phone;end if;
 start_at:=coalesce(se.opened_at,o.created_at);
 if se.id is null and o.source in ('customer','customer_portal') then
  if coalesce(length(v_phone),0) not between 9 and 15 then return jsonb_build_object('eligible',false,'reason','CHECKOUT_PHONE_REQUIRED');end if;
  if exists(select 1 from public.order_sessions pending where pending.customer_phone=v_phone and pending.created_at<=o.created_at and pending.order_id is null and pending.status in ('open','draft_created','ready_customer','customer_confirmed','awaiting_payment','paid')) then return jsonb_build_object('eligible',false,'reason','UNBOUND_CHECKOUT_SESSION');end if;
  -- Same lifecycle boundary as a draft phone session, excluding this checkout
  -- and all future orders. Reading a session never creates or converts a draft.
  select greatest(o.created_at-interval '45 days',coalesce(max(b.at),o.created_at-interval '45 days')) into start_at
  from (
   select coalesce(previous.closed_at,previous.cutoff_at,previous.updated_at) at
   from public.order_sessions previous
   where previous.order_id is distinct from o.id and previous.customer_phone=v_phone
    and previous.status in ('converted','closed')
    and coalesce(previous.closed_at,previous.cutoff_at,previous.updated_at)<=o.created_at
   union all
   select previous.created_at from public.orders previous join public.customers pc on pc.id=previous.customer_id
   where previous.id<>o.id and previous.created_at<=o.created_at and
    (previous.customer_id=o.customer_id or
     case when left(regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g'),1)='0' then '6'||regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g')
      when left(regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g'),1)='1' then '60'||regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g')
      else regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g') end=v_phone)
   union all
   select greatest(coalesce(previous.converted_at,previous.confirmed_at,po.created_at),po.created_at)
   from public.qrpay_order_drafts previous join public.orders po on po.id=previous.order_id
   where previous.order_id<>o.id and previous.status='confirmed' and po.created_at<=o.created_at
    and greatest(coalesce(previous.converted_at,previous.confirmed_at,po.created_at),po.created_at)<=o.created_at
    and (po.customer_id=o.customer_id or regexp_replace(coalesce(previous.customer_phone,''),'[^0-9]','','g')=v_phone)
  ) b;
 end if;
 -- The next session starts at its previous closed-order boundary, not its later trigger.
 select min(s.opened_at) into end_at from public.order_sessions s where s.id is distinct from se.id and s.created_at>coalesce(se.created_at,o.created_at) and ((convo is not null and s.conversation_id=convo) or (v_phone<>'' and s.customer_phone=v_phone));
 select least(end_at,min(other.created_at)) into end_at from public.orders other join public.customers c on c.id=other.customer_id where other.id<>o.id and other.created_at>o.created_at and (other.customer_id=o.customer_id or regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=v_phone);
 if end_at is not null and end_at<=start_at then return jsonb_build_object('eligible',false,'reason','SESSION_BOUNDARY_CONFLICT');end if;
 return jsonb_build_object('eligible',true,'order_id',o.id,'order_no',o.order_no,'placed_at',o.created_at,'source',o.source,'delivery',o.delivery_method,'payment_status',o.payment_status,
 'session_source',case when se.id is not null then 'canonical_session' when o.source in ('customer','customer_portal') then 'website_phone_session' else 'checkout_window' end,'session_id',se.id,'draft_id',d.id,'conversation_id',convo,'phone',v_phone,'start_at',start_at,'end_at',end_at,
 'single_item_scope',(select count(*)=1 and coalesce(max(qty),0)=1 from public.order_items where order_id=o.id),
 'target_item_id',i.id,'note',case when coalesce(nullif(i.custom_text,''),i.wording,'') ~* '^(CN|YS)[0-9]{3,6}( SG)?$' then '' else coalesce(nullif(i.custom_text,''),i.wording,'') end,
 'items',(select jsonb_agg(jsonb_build_object('item_sku',coalesce(x.product_snapshot->>'sku',x.catalog_slug,x.title),'title',x.title,'quantity',x.qty,'provider_item_id',x.product_id,'local_item_id',x.id)) from public.order_items x where x.order_id=o.id));
end $function$
;
CREATE OR REPLACE FUNCTION public.icetak_autobrief_direct_scope(p_order_id uuid, p_task_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare o public.orders; i public.order_items; se public.order_sessions; d public.qrpay_order_drafts;
 v_phone text; start_at timestamptz; end_at timestamptz; n integer; selected uuid; convo uuid;
begin
 select * into o from public.orders where id=p_order_id;
 if not found or not exists(select 1 from public.ai_clickup_work_snapshots s where s.task_id=p_task_id and s.order_id=o.id and s.marketplace_order_id is null and s.list_id='18375902' and lower(btrim(s.clickup_status))='design editing -topper' and exists(select 1 from public.clickup_autobrief_routes r where r.task_id=s.task_id and r.profile='glossy')) then return jsonb_build_object('eligible',false,'reason','EXACT_ORDER_TASK_REQUIRED');end if;
 if lower(coalesce(o.status,'')) ~ 'cancel|shipped|complete|delivered|collected' or lower(coalesce(o.shipment_status_group,'')) ~ 'shipped|delivered|collected' or o.production_completed_at is not null or o.pickup_collected_at is not null or o.delivered_at is not null then return jsonb_build_object('eligible',false,'reason','ORDER_CLOSED');end if;
 select count(*),min(pc.order_item_id::text)::uuid into n,selected from public.production_components pc where pc.order_id=o.id and pc.clickup_task_id=p_task_id;
 if n<>1 or selected is null then return jsonb_build_object('eligible',false,'reason','EXACT_COMPONENT_REQUIRED');end if;
 select * into i from public.order_items where id=selected and order_id=o.id ;
 if not found then return jsonb_build_object('eligible',false,'reason','PRINTED_TOPPER_ONLY');end if;
 select count(*) into n from public.qrpay_order_drafts where order_id=o.id and status='confirmed';
 if n>1 then return jsonb_build_object('eligible',false,'reason','MULTIPLE_DRAFT_SESSIONS');end if;
 select * into d from public.qrpay_order_drafts where order_id=o.id and status='confirmed';
 if d.id is not null then
  select * into se from public.order_sessions where id=d.order_session_id and order_id=o.id;
  if not found or (d.conversation_id is not null and se.conversation_id is distinct from d.conversation_id) then return jsonb_build_object('eligible',false,'reason','DRAFT_SESSION_MISMATCH');end if;
 else
  select count(*) into n from public.order_sessions where order_id=o.id;
  if n>1 then return jsonb_build_object('eligible',false,'reason','MULTIPLE_ORDER_SESSIONS');end if;
  select * into se from public.order_sessions where order_id=o.id;
 end if;
 convo:=coalesce(se.conversation_id,d.conversation_id);
 select regexp_replace(coalesce(nullif(se.customer_phone,''),nullif(d.customer_phone,''),nullif(o.delivery_phone,''),c.phone,''),'[^0-9]','','g') into v_phone from public.customers c where c.id=o.customer_id;
 if left(v_phone,1)='0' then v_phone:='6'||v_phone;elsif left(v_phone,1)='1' then v_phone:='60'||v_phone;end if;
 start_at:=coalesce(se.opened_at,o.created_at);
 if se.id is null and o.source in ('customer','customer_portal') then
  if coalesce(length(v_phone),0) not between 9 and 15 then return jsonb_build_object('eligible',false,'reason','CHECKOUT_PHONE_REQUIRED');end if;
  if exists(select 1 from public.order_sessions pending where pending.customer_phone=v_phone and pending.created_at<=o.created_at and pending.order_id is null and pending.status in ('open','draft_created','ready_customer','customer_confirmed','awaiting_payment','paid')) then return jsonb_build_object('eligible',false,'reason','UNBOUND_CHECKOUT_SESSION');end if;
  -- Same lifecycle boundary as a draft phone session, excluding this checkout
  -- and all future orders. Reading a session never creates or converts a draft.
  select greatest(o.created_at-interval '45 days',coalesce(max(b.at),o.created_at-interval '45 days')) into start_at
  from (
   select coalesce(previous.closed_at,previous.cutoff_at,previous.updated_at) at
   from public.order_sessions previous
   where previous.order_id is distinct from o.id and previous.customer_phone=v_phone
    and previous.status in ('converted','closed')
    and coalesce(previous.closed_at,previous.cutoff_at,previous.updated_at)<=o.created_at
   union all
   select previous.created_at from public.orders previous join public.customers pc on pc.id=previous.customer_id
   where previous.id<>o.id and previous.created_at<=o.created_at and
    (previous.customer_id=o.customer_id or
     case when left(regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g'),1)='0' then '6'||regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g')
      when left(regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g'),1)='1' then '60'||regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g')
      else regexp_replace(coalesce(previous.delivery_phone,pc.phone,''),'[^0-9]','','g') end=v_phone)
   union all
   select greatest(coalesce(previous.converted_at,previous.confirmed_at,po.created_at),po.created_at)
   from public.qrpay_order_drafts previous join public.orders po on po.id=previous.order_id
   where previous.order_id<>o.id and previous.status='confirmed' and po.created_at<=o.created_at
    and greatest(coalesce(previous.converted_at,previous.confirmed_at,po.created_at),po.created_at)<=o.created_at
    and (po.customer_id=o.customer_id or regexp_replace(coalesce(previous.customer_phone,''),'[^0-9]','','g')=v_phone)
  ) b;
 end if;
 -- The next session starts at its previous closed-order boundary, not its later trigger.
 select min(s.opened_at) into end_at from public.order_sessions s where s.id is distinct from se.id and s.created_at>coalesce(se.created_at,o.created_at) and ((convo is not null and s.conversation_id=convo) or (v_phone<>'' and s.customer_phone=v_phone));
 select least(end_at,min(other.created_at)) into end_at from public.orders other join public.customers c on c.id=other.customer_id where other.id<>o.id and other.created_at>o.created_at and (other.customer_id=o.customer_id or regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=v_phone);
 if end_at is not null and end_at<=start_at then return jsonb_build_object('eligible',false,'reason','SESSION_BOUNDARY_CONFLICT');end if;
 return jsonb_build_object('eligible',true,'order_id',o.id,'order_no',o.order_no,'placed_at',o.created_at,'source',o.source,'delivery',o.delivery_method,'payment_status',o.payment_status,
 'session_source',case when se.id is not null then 'canonical_session' when o.source in ('customer','customer_portal') then 'website_phone_session' else 'checkout_window' end,'session_id',se.id,'draft_id',d.id,'conversation_id',convo,'phone',v_phone,'start_at',start_at,'end_at',end_at,
 'single_item_scope',(select count(*)=1 and coalesce(max(qty),0)=1 from public.order_items where order_id=o.id),
 'target_item_id',i.id,'note',case when coalesce(nullif(i.custom_text,''),i.wording,'') ~* '^(CN|YS)[0-9]{3,6}( SG)?$' then '' else coalesce(nullif(i.custom_text,''),i.wording,'') end,
 'items',(select jsonb_agg(jsonb_build_object('item_sku',coalesce(x.product_snapshot->>'sku',x.catalog_slug,x.title),'title',x.title,'quantity',x.qty,'provider_item_id',x.product_id,'local_item_id',x.id)) from public.order_items x where x.order_id=o.id));
end $function$
;
CREATE OR REPLACE FUNCTION public.icetak_acrylic_brief_scope(p_task_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare s public.ai_clickup_work_snapshots; o public.orders; m public.marketplace_orders;
 scope jsonb; target jsonb; items jsonb; n int;
begin
 select * into s from public.ai_clickup_work_snapshots where task_id=p_task_id and list_id='18375902' and lower(btrim(clickup_status))='acrylic' and exists(select 1 from public.clickup_autobrief_routes r where r.task_id=p_task_id and r.profile='acrylic');
 if not found then return jsonb_build_object('eligible',false,'reason','ACRYLIC_TASK_REQUIRED');end if;
 if s.order_reference ilike '%TEST%' then return jsonb_build_object('eligible',false,'reason','TEST_ORDER_EXCLUDED');end if;
 if s.order_id is not null then
  scope:=public.icetak_acrylic_direct_scope(s.order_id,p_task_id);
  if not coalesce((scope->>'eligible')::boolean,false) then return scope;end if;
  select * into o from public.orders where id=s.order_id;
  if coalesce(o.payment_status,'') not in ('paid','cash_counter') then return jsonb_build_object('eligible',false,'reason','PAYMENT_NOT_ELIGIBLE');end if;
  select jsonb_build_object('id',i.id,'kind','acrylic','material',case when i.product_type='mirror' then 'artpaper_gold' else i.product_type end,'title',i.title,'quantity',i.qty,'size',i.size,'colour',i.style,
    'wording',coalesce(nullif(i.custom_text,''),i.wording),'sku',coalesce(i.product_snapshot->>'sku',i.catalog_slug,''),
    'review_required',i.review_required,'customization',i.customization) into target
  from public.order_items i where i.id=(scope->>'target_item_id')::uuid;
  select jsonb_agg(jsonb_build_object('id',i.id,'kind',case when i.id=(scope->>'target_item_id')::uuid then 'acrylic' else i.product_type end,'title',i.title,'quantity',i.qty,'size',i.size,'colour',i.style,'wording',i.wording))
    into items from public.order_items i where i.order_id=s.order_id;
  return scope||jsonb_build_object('provider','whatsapp','target',target,'items',items,'due_at',o.date_need,
    'production_started',o.production_completed_at is not null);
 end if;
 select * into m from public.marketplace_orders where id=s.marketplace_order_id;
 if not found or m.current_status not in ('READY_TO_SHIP','PROCESSED','RETRY_SHIP') then return jsonb_build_object('eligible',false,'reason','ORDER_NOT_FULFILLABLE');end if;
 select jsonb_agg(jsonb_build_object('id',i.id,'kind',case when concat_ws(' ',i.item_sku,i.title) ~* '\macrylic\M' then 'acrylic' else 'other' end,
   'material',case when concat_ws(' ',i.item_sku,i.title) ~* 'artpaper|art paper|mirror-gold-artpaper' then 'artpaper_gold' when concat_ws(' ',i.item_sku,i.title) ~* 'acrylic|akrilik' then 'acrylic' else 'unknown' end,'title',i.title,'quantity',i.quantity,'size',substring(i.variation_name from '(?i)A[567]'),
   'colour',case when position(',' in i.variation_name)>0 then split_part(i.variation_name,',',1) else substring(i.variation_name from '(?i)(Gold|Silver|White|Black|Yellow|Clear)') end,
   'variation',i.variation_name,'sku',coalesce(nullif(i.variation_sku,''),i.item_sku),'product_id',i.provider_item_id))
 into items from public.marketplace_order_items i where i.order_id=m.id and i.is_current;
 select count(*),jsonb_agg(x)->0 into n,target from jsonb_array_elements(coalesce(items,'[]')) x
 where
  (lower(regexp_replace(s.task_name,'^\d+x\s*','','i'))=lower(x->>'variation')
   or jsonb_array_length(coalesce(items,'[]'))=1);
 if n<>1 then return jsonb_build_object('eligible',false,'reason','EXACT_ACRYLIC_ITEM_REQUIRED');end if;
 target:=target||jsonb_build_object('kind','acrylic');
 select jsonb_agg(x||case when x->>'id'=target->>'id' then jsonb_build_object('kind','acrylic') else '{}'::jsonb end) into items from jsonb_array_elements(items) x;
 if coalesce(target->>'colour','')='' or coalesce(target->>'size','')='' then
  return jsonb_build_object('eligible',false,'reason','VARIATION_SPEC_REQUIRED');end if;
 return jsonb_build_object('eligible',true,'provider','shopee','order_id',m.id,'marketplace_order_id',m.id,
   'order_no',m.order_sn,'buyer_user_id',m.buyer_user_id,'shop_id',m.shop_id,
   'placed_at',coalesce(m.placed_at,m.first_seen_at),'start_at',coalesce(m.placed_at,m.first_seen_at)-interval '2 days',
   'note',coalesce(m.buyer_message,''),'target_item_id',target->>'id','target',target,'items',items,
   'single_item_scope',jsonb_array_length(coalesce(items,'[]'))=1,'due_at',m.ship_by_at);
end $function$
;
CREATE OR REPLACE FUNCTION clickup_gate.record_order_brief(p_task_id text, p_fingerprint text, p_state text, p_brief jsonb, p_media jsonb, p_comment_id text, p_error text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'clickup_gate'
AS $function$
declare done int; locked boolean;
begin
 if p_state not in ('completed','review','failed','uncertain') then return false;end if;

 select confirmed_at is not null into locked from public.clickup_autobrief_routes where task_id=p_task_id;
 if locked then
  select j.brief||jsonb_build_object('checked_message_ids',coalesce(p_brief->'checked_message_ids',j.checked_message_ids),
    'message_updates',coalesce(p_brief->'message_updates',j.brief->'message_updates','[]'::jsonb),
    'pending_change_ids',coalesce(p_brief->'pending_change_ids',j.brief->'pending_change_ids','[]'::jsonb))
  into p_brief from public.clickup_order_brief_jobs j where j.task_id=p_task_id;
 end if;
 update public.clickup_order_brief_jobs j
 set state=p_state,brief=coalesce(p_brief,j.brief),media_receipts=coalesce(p_media,j.media_receipts),
 comment_id=coalesce(p_comment_id,j.comment_id),
 checked_message_ids=coalesce(p_brief->'checked_message_ids',j.checked_message_ids),
 field_receipts=coalesce(p_brief->'field_receipts',j.field_receipts),
 last_error=left(coalesce(p_error,''),300),
 lease_until=null,updated_at=now(),
 attempts=case when p_state in ('completed','review') then 0 else j.attempts end,
 next_poll_at=now()+interval '5 minutes',
 delivered_fingerprint=case when p_state='completed' then p_fingerprint else j.delivered_fingerprint end,
 completed_at=case when p_state='completed' then coalesce(j.completed_at,now()) else j.completed_at end,
 next_attempt_at=case when p_state='failed' then now()+make_interval(mins=>least(power(2,j.attempts)::int,60)) else j.next_attempt_at end
 where j.task_id=p_task_id and j.source_fingerprint=p_fingerprint and j.state='processing';
 
get diagnostics done=row_count;
 if done=1 and p_brief->>'confirmed'='true' and p_comment_id is not null then
 update public.clickup_autobrief_routes set confirmed_at=coalesce(nullif(p_brief->>'confirmed_at','')::timestamptz,now())
 where task_id=p_task_id and confirmed_at is null;
 end if;
 return done=1;
end $function$
;
revoke all on function clickup_gate.autobrief_profile(text),clickup_gate.capture_autobrief_route(),clickup_gate.protect_autobrief_route(),clickup_gate.claim_brief_profile(text,text,integer) from public,anon,authenticated;
grant execute on function clickup_gate.autobrief_profile(text),clickup_gate.claim_brief_profile(text,text,integer) to service_role;
