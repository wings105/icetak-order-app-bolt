-- Null keeps the scheduled Edible/Wafer pilot paused. Exact staff canaries remain available.
alter table public.clickup_order_brief_settings
 add column if not exists print_brief_rollout_after timestamptz;

CREATE OR REPLACE FUNCTION clickup_gate.claim_brief_profile(p_profile text, p_task_id text DEFAULT NULL::text, p_limit integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare enabled boolean; jobs jsonb;
begin
 select s.enabled and case p_profile when 'acrylic' then s.acrylic_enabled when 'print' then s.print_brief_rollout_after is not null or p_task_id is not null else true end into enabled from public.clickup_order_brief_settings s where singleton;
 if not coalesce(enabled,false) then return jsonb_build_object('enabled',false,'jobs','[]'::jsonb);end if;
 if p_profile not in('glossy','acrylic','print') then return jsonb_build_object('enabled',false,'reason','RULE_NOT_CONFIGURED','jobs','[]'::jsonb);end if;
 insert into public.clickup_order_brief_jobs(task_id,order_reference,source_fingerprint,content_hash,state,next_poll_at)
 select s.task_id,s.order_reference,coalesce(nullif(a.data->>'fingerprint',''),md5(s.task_id||r.task_created_at::text)),
  md5(concat_ws('|',s.task_name,a.data->>'fingerprint')),'pending',now()
 from public.ai_clickup_work_snapshots s join public.clickup_autobrief_routes r using(task_id)
 left join public.task_detail_automation a using(task_id)
 left join public.orders o on o.id=s.order_id left join public.marketplace_orders m on m.id=s.marketplace_order_id
 where (r.profile=p_profile or p_profile='print' and r.profile in ('edible','wafer')) and s.list_id='18375902' and lower(btrim(s.clickup_status))=r.initial_status
 and s.order_reference not ilike '%TEST%' and r.task_created_at<=now()-interval '15 minutes'
 and (p_task_id is null or s.task_id=p_task_id)
 and (p_task_id is not null or coalesce(o.created_at,case when p_profile='print' then m.placed_at end,m.first_seen_at)>=
  (select case when p_profile='acrylic' then acrylic_rollout_after when p_profile='print' then print_brief_rollout_after else rollout_after end from public.clickup_order_brief_settings where singleton))
 and (p_profile in ('acrylic','print') or (coalesce(a.data->>'fingerprint','')<>'' and a.data->>'info_status' in('ready','missing','review')))
 on conflict(task_id) do update set source_fingerprint=excluded.source_fingerprint,content_hash=excluded.content_hash,
  next_poll_at=now(),state='pending',attempts=0,next_attempt_at=now(),last_error=null,updated_at=now()
 where public.clickup_order_brief_jobs.content_hash is distinct from excluded.content_hash
  and not exists(select 1 from public.clickup_autobrief_routes locked where locked.task_id=excluded.task_id and locked.confirmed_at is not null)
  and (public.clickup_order_brief_jobs.lease_until is null or public.clickup_order_brief_jobs.lease_until<now());
 with candidates as(
 select j.task_id from public.clickup_order_brief_jobs j join public.clickup_autobrief_routes r using(task_id)
 join public.ai_clickup_work_snapshots s using(task_id)
 where (r.profile=p_profile or p_profile='print' and r.profile in ('edible','wafer')) and s.list_id='18375902' and (p_task_id is null or j.task_id=p_task_id)
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
end;$function$;

CREATE OR REPLACE FUNCTION public.icetak_print_brief_direct_scope(p_order_id uuid, p_task_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare o public.orders; i public.order_items; se public.order_sessions; d public.qrpay_order_drafts;
 v_phone text; start_at timestamptz; end_at timestamptz; n integer; selected uuid; convo uuid;
begin
 select * into o from public.orders where id=p_order_id;
 if not found or not exists(select 1 from public.ai_clickup_work_snapshots s where s.task_id=p_task_id and s.order_id=o.id and s.marketplace_order_id is null and s.list_id='18375902' and exists(select 1 from public.clickup_autobrief_routes r where r.task_id=s.task_id and r.profile in ('edible','wafer') and (lower(btrim(s.clickup_status))=r.initial_status or r.confirmed_at is not null))) then return jsonb_build_object('eligible',false,'reason','EXACT_ORDER_TASK_REQUIRED');end if;
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
end $function$;
revoke all on function public.icetak_print_brief_direct_scope(uuid,text) from public,anon,authenticated;
grant execute on function public.icetak_print_brief_direct_scope(uuid,text) to service_role;

create or replace function public.icetak_claim_print_briefs(p_task_id text default null)
returns jsonb language sql security definer set search_path = '' as $fn$
 select clickup_gate.claim_brief_profile('print',p_task_id,1);
$fn$;
revoke all on function public.icetak_claim_print_briefs(text) from public,anon,authenticated;
grant execute on function public.icetak_claim_print_briefs(text) to service_role;

CREATE OR REPLACE FUNCTION clickup_gate.dispatch_order_brief()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'clickup_gate'
AS $function$
declare t text;
begin
 if not (select enabled from public.clickup_order_brief_settings where singleton=true) then return; end if;
 select setting_value into t from public.private_runtime_settings where setting_key='order_brief_worker_token';
 if t is null then return; end if;
 perform net.http_post(
   url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-order-brief',
   body:='{"action":"run"}'::jsonb,
   headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',t),
   timeout_milliseconds:=60000
 );
 if (select acrylic_enabled from public.clickup_order_brief_settings where singleton) then
  for acrylic_slot in 1..3 loop
  perform net.http_post(
   url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-order-brief',
   body:='{"action":"acrylic_run"}'::jsonb,
   headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',t),
   timeout_milliseconds:=120000);
  end loop;
 end if;
 if (select print_brief_rollout_after is not null from public.clickup_order_brief_settings where singleton) then
  perform net.http_post(
   url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-order-brief',
   body:='{"action":"print_run"}'::jsonb,
   headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',t),
   timeout_milliseconds:=120000);
 end if;
end $function$
;
