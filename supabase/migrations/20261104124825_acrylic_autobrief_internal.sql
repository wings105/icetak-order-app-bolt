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
 if not found or not exists(select 1 from public.ai_clickup_work_snapshots s where s.task_id=p_task_id and s.order_id=o.id and s.marketplace_order_id is null and s.list_id='18375902' and lower(btrim(s.clickup_status))='acrylic') then return jsonb_build_object('eligible',false,'reason','EXACT_ORDER_TASK_REQUIRED');end if;
 if lower(coalesce(o.status,'')) ~ 'cancel|shipped|complete|delivered|collected' or lower(coalesce(o.shipment_status_group,'')) ~ 'shipped|delivered|collected' or o.production_completed_at is not null or o.pickup_collected_at is not null or o.delivered_at is not null then return jsonb_build_object('eligible',false,'reason','ORDER_CLOSED');end if;
 select count(*),min(pc.order_item_id::text)::uuid into n,selected from public.production_components pc where pc.order_id=o.id and pc.clickup_task_id=p_task_id;
 if n<>1 or selected is null then return jsonb_build_object('eligible',false,'reason','EXACT_COMPONENT_REQUIRED');end if;
 select * into i from public.order_items where id=selected and order_id=o.id and product_type='acrylic';
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
end $function$;

revoke all on function public.icetak_acrylic_direct_scope(uuid,text) from public,anon,authenticated;
grant execute on function public.icetak_acrylic_direct_scope(uuid,text) to service_role;
alter table public.clickup_order_brief_settings add column if not exists acrylic_enabled boolean not null default false;
alter table public.clickup_order_brief_settings add column if not exists acrylic_ai_fallback boolean not null default true;
alter table public.clickup_order_brief_settings add column if not exists acrylic_rollout_after timestamptz not null default '2026-10-29T00:00:00Z';

create or replace function public.icetak_acrylic_brief_scope(p_task_id text)
returns jsonb language plpgsql stable set search_path='' as $$
declare s public.ai_clickup_work_snapshots; o public.orders; m public.marketplace_orders;
 scope jsonb; target jsonb; items jsonb; n int;
begin
 select * into s from public.ai_clickup_work_snapshots where task_id=p_task_id and list_id='18375902' and lower(btrim(clickup_status))='acrylic';
 if not found then return jsonb_build_object('eligible',false,'reason','ACRYLIC_TASK_REQUIRED');end if;
 if s.order_reference ilike '%TEST%' then return jsonb_build_object('eligible',false,'reason','TEST_ORDER_EXCLUDED');end if;
 if s.order_id is not null then
  scope:=public.icetak_acrylic_direct_scope(s.order_id,p_task_id);
  if not coalesce((scope->>'eligible')::boolean,false) then return scope;end if;
  select * into o from public.orders where id=s.order_id;
  if coalesce(o.payment_status,'') not in ('paid','cash_counter') then return jsonb_build_object('eligible',false,'reason','PAYMENT_NOT_ELIGIBLE');end if;
  select jsonb_build_object('id',i.id,'kind',i.product_type,'title',i.title,'quantity',i.qty,'size',i.size,'colour',i.style,
    'wording',coalesce(nullif(i.custom_text,''),i.wording),'sku',coalesce(i.product_snapshot->>'sku',i.catalog_slug,''),
    'review_required',i.review_required,'customization',i.customization) into target
  from public.order_items i where i.id=(scope->>'target_item_id')::uuid;
  select jsonb_agg(jsonb_build_object('id',i.id,'kind',i.product_type,'title',i.title,'quantity',i.qty,'size',i.size,'colour',i.style,'wording',i.wording))
    into items from public.order_items i where i.order_id=s.order_id;
  return scope||jsonb_build_object('provider','whatsapp','target',target,'items',items,'due_at',o.date_need,
    'production_started',o.production_completed_at is not null);
 end if;
 select * into m from public.marketplace_orders where id=s.marketplace_order_id;
 if not found or m.current_status not in ('READY_TO_SHIP','PROCESSED','RETRY_SHIP') then return jsonb_build_object('eligible',false,'reason','ORDER_NOT_FULFILLABLE');end if;
 select jsonb_agg(jsonb_build_object('id',i.id,'kind',case when concat_ws(' ',i.item_sku,i.title) ~* '\macrylic\M' then 'acrylic' else 'other' end,
   'title',i.title,'quantity',i.quantity,'size',substring(i.variation_name from '(?i)A[567]'),
   'colour',case when position(',' in i.variation_name)>0 then split_part(i.variation_name,',',1) else substring(i.variation_name from '(?i)(Gold|Silver|White|Black|Yellow|Clear)') end,
   'variation',i.variation_name,'sku',coalesce(nullif(i.variation_sku,''),i.item_sku),'product_id',i.provider_item_id))
 into items from public.marketplace_order_items i where i.order_id=m.id and i.is_current;
 select count(*),jsonb_agg(x)->0 into n,target from jsonb_array_elements(coalesce(items,'[]')) x
 where x->>'kind'='acrylic' and
  (lower(regexp_replace(s.task_name,'^\d+x\s*','','i'))=lower(x->>'variation')
   or (select count(*) from jsonb_array_elements(coalesce(items,'[]')) z where z->>'kind'='acrylic')=1);
 if n<>1 then return jsonb_build_object('eligible',false,'reason','EXACT_ACRYLIC_ITEM_REQUIRED');end if;
 if coalesce(target->>'colour','')='' or coalesce(target->>'size','')='' then
  return jsonb_build_object('eligible',false,'reason','VARIATION_SPEC_REQUIRED');end if;
 return jsonb_build_object('eligible',true,'provider','shopee','order_id',m.id,'marketplace_order_id',m.id,
   'order_no',m.order_sn,'buyer_user_id',m.buyer_user_id,'shop_id',m.shop_id,
   'placed_at',coalesce(m.placed_at,m.first_seen_at),'start_at',coalesce(m.placed_at,m.first_seen_at)-interval '2 days',
   'note',coalesce(m.buyer_message,''),'target_item_id',target->>'id','target',target,'items',items,
   'single_item_scope',jsonb_array_length(coalesce(items,'[]'))=1,'due_at',m.ship_by_at);
end $$;
revoke all on function public.icetak_acrylic_brief_scope(text) from public,anon,authenticated;
grant execute on function public.icetak_acrylic_brief_scope(text) to service_role;

create or replace function public.icetak_claim_acrylic_briefs(p_task_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare jobs jsonb; enabled boolean;
begin
 select acrylic_enabled into enabled from public.clickup_order_brief_settings where singleton;
 if not coalesce(enabled,false) and p_task_id is null then return jsonb_build_object('enabled',false,'jobs','[]'::jsonb);end if;
 insert into public.clickup_order_brief_jobs(task_id,order_reference,source_fingerprint,content_hash,state,next_poll_at)
 select s.task_id,s.order_reference,coalesce(nullif(a.data->>'fingerprint',''),md5(s.task_id||s.source_updated_at::text)),
  md5(concat_ws('|',s.task_name,a.data->>'fingerprint',s.source_updated_at::text)),'pending',now()
 from public.ai_clickup_work_snapshots s left join public.task_detail_automation a using(task_id)
 left join public.orders o on o.id=s.order_id left join public.marketplace_orders m on m.id=s.marketplace_order_id
 where s.list_id='18375902' and lower(btrim(s.clickup_status))='acrylic'
 and s.order_reference not ilike '%TEST%' and coalesce(o.created_at,m.placed_at,m.first_seen_at)<=now()-interval '15 minutes'
 and (s.task_id=p_task_id or (p_task_id is null and coalesce(o.created_at,m.first_seen_at)>=(select acrylic_rollout_after from public.clickup_order_brief_settings where singleton)))
 on conflict(task_id) do update set source_fingerprint=excluded.source_fingerprint,content_hash=excluded.content_hash,
  next_poll_at=now(),state='pending',attempts=0,next_attempt_at=now(),last_error=null,updated_at=now()
 where public.clickup_order_brief_jobs.content_hash is distinct from excluded.content_hash
 and (public.clickup_order_brief_jobs.lease_until is null or public.clickup_order_brief_jobs.lease_until<now());
 with candidates as (
  select j.task_id from public.clickup_order_brief_jobs j join public.ai_clickup_work_snapshots s using(task_id)
  where s.list_id='18375902' and lower(btrim(s.clickup_status))='acrylic'
  and (p_task_id is null or j.task_id=p_task_id) and (j.lease_until is null or j.lease_until<now())
  and (p_task_id is not null or ((j.state in ('pending','failed') and j.next_attempt_at<=now() and j.attempts<5)
   or (j.state='processing' and j.attempts<5) or (j.state in ('completed','review') and j.next_poll_at<=now())))
  order by j.next_poll_at,j.created_at limit 1 for update of j skip locked
 ), changed as (
 update public.clickup_order_brief_jobs j set state='processing',lease_until=now()+interval '4 minutes',
 attempts=case when j.state in ('completed','review') then 1 else j.attempts+1 end,last_polled_at=now(),updated_at=now()
 from candidates c where c.task_id=j.task_id returning j.*
 ) select coalesce(jsonb_agg(to_jsonb(changed)),'[]') into jobs from changed;
 return jsonb_build_object('enabled',coalesce(enabled,false),'jobs',jobs);
end $$;
revoke all on function public.icetak_claim_acrylic_briefs(text) from public,anon,authenticated;
grant execute on function public.icetak_claim_acrylic_briefs(text) to service_role;


create or replace function public.icetak_acrylic_brief_projection(p_task_ids text[])
returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_object_agg(j.task_id,jsonb_build_object('brief',j.brief,'updated_at',j.updated_at)),'{}'::jsonb)
 from public.clickup_order_brief_jobs j where j.task_id=any(p_task_ids[1:1001])
 and j.brief->>'profile'='acrylic-internal-v1';
$$;
revoke all on function public.icetak_acrylic_brief_projection(text[]) from public,anon,authenticated;
grant execute on function public.icetak_acrylic_brief_projection(text[]) to service_role;

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
  perform net.http_post(
   url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-order-brief',
   body:='{"action":"acrylic_run"}'::jsonb,
   headers:=jsonb_build_object('Content-Type','application/json','x-order-brief-token',t),
   timeout_milliseconds:=120000);
 end if;
end $function$;

