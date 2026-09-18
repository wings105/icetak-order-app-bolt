-- Order System only. New review state does not mutate conversations/orders/payments.
create table if not exists public.ai_dashboard_reviews (
 conversation_id uuid primary key,
 inbound_revision text not null,
 status text not null default 'needs_review' check(status in ('needs_review','waiting_customer','snoozed','resolved')),
 snoozed_until timestamptz,
 response_text text not null default '',
 note text not null default '',
 intent_override text,
 updated_by text not null,
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
create table if not exists public.ai_dashboard_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 conversation_id uuid not null,
 actor text not null,
 action text not null,
 before_state jsonb,
 after_state jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists ai_dashboard_events_conversation on public.ai_dashboard_events(conversation_id,created_at desc);
alter table public.ai_dashboard_reviews enable row level security;
alter table public.ai_dashboard_events enable row level security;
revoke all on public.ai_dashboard_reviews,public.ai_dashboard_events from anon,authenticated;
grant all on public.ai_dashboard_reviews,public.ai_dashboard_events to service_role;

create or replace function public.icetak_ai_dashboard_review(
 p_conversation_id uuid,p_inbound_revision text,p_expected_version integer,p_actor text,
 p_request_id uuid,p_action text,p_response text default '',p_note text default '',
 p_intent text default null,p_snoozed_until timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.ai_dashboard_reviews%rowtype; v_new public.ai_dashboard_reviews%rowtype; v_saved jsonb; v_status text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));
 select after_state into v_saved from ai_dashboard_events where request_id=p_request_id and conversation_id=p_conversation_id;
 if found then return jsonb_build_object('review',v_saved,'duplicate',true); end if;
 select * into v_old from ai_dashboard_reviews where conversation_id=p_conversation_id for update;
 if coalesce(v_old.version,0)<>p_expected_version then raise exception 'REVIEW_CHANGED: Muat semula; admin lain telah mengemas kini kad ini.'; end if;
 if p_actor is null or length(p_actor)=0 or p_inbound_revision is null then raise exception 'Invalid review identity'; end if;
 if p_action not in ('save','manual_replied','resolve','reopen','snooze') then raise exception 'Invalid review action'; end if;
 if length(coalesce(p_response,''))>8000 or length(coalesce(p_note,''))>2000 then raise exception 'Text too long'; end if;
 if p_action='manual_replied' and length(trim(coalesce(p_response,'')))=0 then raise exception 'Balasan diperlukan untuk rekod manual.'; end if;
 if p_action='snooze' and (p_snoozed_until is null or p_snoozed_until<=now() or p_snoozed_until>now()+interval '30 days') then raise exception 'Invalid snooze time'; end if;
 v_status:=case p_action when 'manual_replied' then 'waiting_customer' when 'resolve' then 'resolved' when 'snooze' then 'snoozed' when 'reopen' then 'needs_review' else
   case when v_old.inbound_revision=p_inbound_revision then coalesce(v_old.status,'needs_review') else 'needs_review' end end;
 insert into ai_dashboard_reviews(conversation_id,inbound_revision,status,snoozed_until,response_text,note,intent_override,updated_by,version)
 values(p_conversation_id,p_inbound_revision,v_status,case when v_status='snoozed' then p_snoozed_until end,
 coalesce(p_response,''),coalesce(p_note,''),nullif(p_intent,''),p_actor,coalesce(v_old.version,0)+1)
 on conflict(conversation_id) do update set inbound_revision=excluded.inbound_revision,status=excluded.status,
 snoozed_until=excluded.snoozed_until,response_text=excluded.response_text,note=excluded.note,
 intent_override=excluded.intent_override,updated_by=excluded.updated_by,version=excluded.version,updated_at=now()
 returning * into v_new;
 insert into ai_dashboard_events(request_id,conversation_id,actor,action,before_state,after_state)
 values(p_request_id,p_conversation_id,p_actor,p_action,case when v_old.conversation_id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
 return jsonb_build_object('review',to_jsonb(v_new),'duplicate',false);
end; $$;
revoke all on function public.icetak_ai_dashboard_review(uuid,text,integer,text,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.icetak_ai_dashboard_review(uuid,text,integer,text,uuid,text,text,text,text,timestamptz) to service_role;

create or replace function public.icetak_ai_dashboard_context(p_identities jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb; v_result jsonb:='{}'; v_ids uuid[]; v_master public.customer_master%rowtype;
 v_phone text; v_uid text; v_conv uuid; v_orders jsonb; v_market jsonb; v_drafts jsonb; v_review jsonb;
 v_session jsonb; v_addresses jsonb;
begin
 if jsonb_typeof(p_identities)<>'array' or jsonb_array_length(p_identities)>60 then raise exception 'Expected at most 60 identities'; end if;
 for v in select value from jsonb_array_elements(p_identities) loop
  v_master:=null; v_conv:=(v->>'id')::uuid;
  v_phone:=regexp_replace(coalesce(v->>'phone',''),'[^0-9]','','g');
  if left(v_phone,1)='0' then v_phone:='6'||v_phone; end if;
  v_uid:=nullif(v->>'shopee_user_id','');
  select array_agg(distinct id) into v_ids from (
   select cm.id from customer_master cm where cm.status='active' and (
     cm.id=nullif(v->>'master_id','')::uuid or (v_phone<>'' and cm.primary_phone_normalized=v_phone))
   union
   select cm.id from marketplace_customers mc join customer_master cm on cm.id=mc.customer_master_id
     where mc.provider='shopee' and mc.provider_user_id=v_uid and cm.status='active'
  ) matched;
  if cardinality(v_ids)=1 then select * into v_master from customer_master where id=v_ids[1]; end if;
  -- Canonical phone is accepted only after unambiguous identity matching.
  v_phone:=coalesce(nullif(v_master.primary_phone_normalized,''),nullif(v_phone,''));
  v_session:=icetak_order_session_context(v_conv,case when coalesce(cardinality(v_ids),0)<=1 then v_phone else null end);
  select to_jsonb(r) into v_review from ai_dashboard_reviews r where conversation_id=v_conv;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into v_orders from (
   select o.id,o.order_no,o.status,o.admin_status,o.payment_status,o.payment_method,o.total,
    o.date_need,o.created_at,o.updated_at,o.payment_verified_at,o.fulfillment_stage,
    o.shipment_status,o.shipment_updated_at,o.tracking,o.courier,o.delivery_method,
    (select coalesce(jsonb_agg(jsonb_build_object('title',i.title,'quantity',i.qty,'size',i.size,
      'style',i.style,'wording',i.wording,'price',i.price)),'[]') from order_items i where i.order_id=o.id) items
   from orders o join customers c on c.id=o.customer_id
   where v_master.id is not null and c.customer_master_id=v_master.id
   order by o.created_at desc limit 8
  )x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.placed_at desc nulls last),'[]') into v_market from (
   select mo.id,mo.order_sn,mo.buyer_username,mo.buyer_user_id,mo.current_status,mo.payment_status,
    mo.fulfillment_status,mo.placed_at,mo.latest_provider_update_at,mo.detail_complete,mo.currency,
    case when mo.ship_by_at>'2020-01-01' then mo.ship_by_at end ship_by_at,
    (select coalesce(jsonb_agg(jsonb_build_object('title',i.title,'variation',i.variation_name,'sku',coalesce(nullif(i.variation_sku,''),i.item_sku),
      'quantity',i.quantity,'unit_price',i.unit_discounted_price)),'[]') from marketplace_order_items i where i.order_id=mo.id and i.is_current) items,
    (select coalesce(jsonb_agg(jsonb_build_object('buyer_paid',f.buyer_paid,'payment_method',f.payment_method,
      'settlement_status',f.settlement_status,'currency',f.currency)),'[]') from marketplace_order_financials f where f.order_id=mo.id) financials,
    (select coalesce(jsonb_agg(jsonb_build_object('tracking_number',s.tracking_number,'courier_name',s.courier_name,
      'shipment_status',s.shipment_status,'fulfillment_status',s.fulfillment_status)),'[]') from marketplace_shipments s where s.order_id=mo.id) shipments
   from marketplace_orders mo
   where coalesce(cardinality(v_ids),0)<=1 and (
     (v_master.id is not null and exists(select 1 from marketplace_customers mc where mc.id=mo.buyer_customer_id and mc.customer_master_id=v_master.id))
     or (v_uid is not null and mo.provider='shopee' and mo.buyer_user_id=v_uid))
   order by mo.placed_at desc nulls last limit 8
  )x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into v_drafts from (
   select d.id,d.status,d.customer_status,d.payment_status,d.draft_total,d.order_no,d.order_session_id,d.created_at
   from qrpay_order_drafts d where d.order_session_id=nullif(v_session->>'session_id','')::uuid
   order by d.created_at desc limit 5
  )x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_addresses from (
   select recipient_name,address_line1,address_line2,city,postcode,state,source_provider,is_verified
   from customer_addresses where customer_master_id=v_master.id order by is_default desc,updated_at desc limit 3
  )x;
  v_result:=v_result||jsonb_build_object(v_conv::text,jsonb_build_object(
   'customer',case when v_master.id is null then null else jsonb_build_object('id',v_master.id,
    'name',coalesce(v_master.admin_name_override,v_master.display_name),'phone',v_master.primary_phone_normalized) end,
   'identity_status',case when cardinality(v_ids)>1 then 'ambiguous' when v_master.id is not null then 'matched' else 'unmatched' end,
   'phone',case when coalesce(cardinality(v_ids),0)<=1 then v_phone end,
   'orders',v_orders,'marketplace_orders',v_market,'drafts',v_drafts,'addresses',v_addresses,
   'session',v_session,'review',v_review));
 end loop;
 return v_result;
end; $$;
revoke all on function public.icetak_ai_dashboard_context(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_ai_dashboard_context(jsonb) to service_role;
