-- Additive command-center contract. No historic order/payment/chat mutations.
create table if not exists public.sales_opportunities (
 id uuid primary key default gen_random_uuid(),
 customer_name text not null check(length(customer_name) between 1 and 160),
 phone text, source text not null check(source in ('whatsapp','shopee','walkin','other')),
 identity_key text not null, conversation_id uuid, customer_master_id uuid references public.customer_master(id),
 stage text not null default 'new' check(stage in ('new','qualified','quoted','waiting_customer','waiting_payment','won','lost')),
 owner text not null, estimated_value numeric not null default 0 check(estimated_value>=0),
 order_kind text check(order_kind in ('icetak','shopee')), order_id uuid,
 loss_reason text, note text not null default '', version integer not null default 1,
 opened_at timestamptz not null default now(), closed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists sales_opportunities_active_identity on public.sales_opportunities(source,identity_key) where stage not in ('won','lost');
create index if not exists sales_opportunities_opened_idx on public.sales_opportunities(opened_at);
create table if not exists public.sales_opportunity_events (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 opportunity_id uuid not null references public.sales_opportunities(id), actor text not null,
 action text not null, request_data jsonb not null, before_state jsonb, after_state jsonb not null,
 created_at timestamptz not null default now()
);
create table if not exists public.quotation_events (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 opportunity_id uuid not null references public.sales_opportunities(id),
 amount numeric not null check(amount>=0), channel text not null,
 actor text not null, note text not null default '', sent_at timestamptz not null default now()
);
alter table public.sales_opportunities enable row level security;
alter table public.sales_opportunity_events enable row level security;
alter table public.quotation_events enable row level security;
revoke all on public.sales_opportunities,public.sales_opportunity_events,public.quotation_events from public,anon,authenticated;
grant all on public.sales_opportunities,public.sales_opportunity_events,public.quotation_events to service_role;

create or replace function public.icetak_command_center_sales(p_actor text,p_request_id uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v public.sales_opportunities; old_value jsonb; prior public.sales_opportunity_events; a text:=p_data->>'action'; key_value text;
begin
 if p_actor is null or p_request_id is null then raise exception 'Actor and request ID required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into prior from public.sales_opportunity_events where request_id=p_request_id;
 if found then
  if prior.actor<>p_actor or prior.request_data<>p_data then raise exception 'Request ID conflict'; end if;
  return jsonb_build_object('ok',true,'duplicate',true,'row',prior.after_state);
 end if;
 if a='create' then
  if nullif(trim(p_data->>'customer_name'),'') is null or p_data->>'source' not in ('whatsapp','shopee','walkin','other') then raise exception 'Customer and source required'; end if;
  key_value:=lower(trim(coalesce(nullif(p_data->>'identity_key',''),nullif(p_data->>'phone',''),p_data->>'customer_name')));
  insert into public.sales_opportunities(customer_name,phone,source,identity_key,owner,estimated_value,note,conversation_id)
  values(trim(p_data->>'customer_name'),nullif(p_data->>'phone',''),p_data->>'source',key_value,p_actor,coalesce((p_data->>'amount')::numeric,0),left(coalesce(p_data->>'note',''),2000),nullif(p_data->>'conversation_id','')::uuid)
  returning * into v;
 else
  select * into v from public.sales_opportunities where id=(p_data->>'id')::uuid for update;
  if not found then raise exception 'Opportunity not found'; end if;
  if v.version<>coalesce((p_data->>'version')::integer,0) then raise exception 'SALES_CHANGED: Muat semula dahulu'; end if;
  old_value:=to_jsonb(v);
  if a='quote' then
   if v.stage in ('won','lost') or p_data->>'confirmed_sent'<>'true' then raise exception 'Confirm quotation was actually sent'; end if;
   insert into public.quotation_events(request_id,opportunity_id,amount,channel,actor,note)
   values(p_request_id,v.id,(p_data->>'amount')::numeric,v.source,p_actor,left(coalesce(p_data->>'note',''),2000));
   update public.sales_opportunities set stage='quoted',estimated_value=(p_data->>'amount')::numeric,updated_at=now(),version=version+1 where id=v.id returning * into v;
  elsif a='stage' then
   if v.stage in ('won','lost') then raise exception 'Closed lead is immutable; create a new session'; end if;
   if p_data->>'stage' not in ('qualified','waiting_customer','waiting_payment','won','lost') then raise exception 'Invalid stage'; end if;
   if p_data->>'stage'='lost' and length(trim(coalesce(p_data->>'loss_reason','')))<3 then raise exception 'Lost reason required'; end if;
   if p_data->>'stage'='won' then
    if p_data->>'order_kind'='icetak' then
     if not exists(select 1 from public.orders where id=(p_data->>'order_id')::uuid and lower(coalesce(status,'')) not like '%cancel%') then raise exception 'Valid canonical order required'; end if;
    elsif p_data->>'order_kind'='shopee' then
     if not exists(select 1 from public.marketplace_orders where id=(p_data->>'order_id')::uuid and current_status not in ('CANCELLED','IN_CANCEL')) then raise exception 'Valid marketplace order required'; end if;
    else raise exception 'Order kind required'; end if;
   end if;
   update public.sales_opportunities set stage=p_data->>'stage',
    closed_at=case when p_data->>'stage' in ('won','lost') then now() else null end,
    loss_reason=case when p_data->>'stage'='lost' then left(p_data->>'loss_reason',500) else null end,
    order_kind=case when p_data->>'stage'='won' then p_data->>'order_kind' else null end,
    order_id=case when p_data->>'stage'='won' then (p_data->>'order_id')::uuid else null end,
    note=left(coalesce(p_data->>'note',note),2000),updated_at=now(),version=version+1 where id=v.id returning * into v;
  else raise exception 'Invalid sales action'; end if;
 end if;
 insert into public.sales_opportunity_events(request_id,opportunity_id,actor,action,request_data,before_state,after_state)
 values(p_request_id,v.id,p_actor,a,p_data,old_value,to_jsonb(v));
 return jsonb_build_object('ok',true,'row',to_jsonb(v));
end $$;
revoke all on function public.icetak_command_center_sales(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_command_center_sales(text,uuid,jsonb) to service_role;

create or replace function public.icetak_command_center_snapshot(p_from date,p_to date,p_source text default 'all')
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare r jsonb; start_at timestamptz:=p_from::timestamp at time zone 'Asia/Kuala_Lumpur'; end_at timestamptz:=(p_to+1)::timestamp at time zone 'Asia/Kuala_Lumpur'; today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 or p_source not in ('all','icetak','shopee') then raise exception 'Invalid range/source (max 93 days)'; end if;
 with
 o as materialized (
  select x.*, coalesce(nullif(x.order_no,''),x.order_id) reference,
  lower(coalesce(x.status,'')) like '%cancel%' cancelled,
  (x.pickup_collected_at is not null or x.delivered_at is not null or lower(coalesce(x.fulfillment_stage,'')) in ('collected','delivered','completed') or lower(coalesce(x.status,'')) in ('completed','delivered','customer collected')) done,
  (lower(coalesce(x.payment_status,'')) in ('paid','matched','payment_received') or lower(coalesce(x.payment,''))='paid') paid,
  (lower(coalesce(x.shipment_status_group,'')) in ('picked_up','shipped','in_transit','out_for_delivery') or lower(coalesce(x.status,'')) in ('shipped','in transit','out for delivery')) transit
  from public.orders x where p_source in ('all','icetak')
 ), m as materialized (select * from public.marketplace_orders where p_source in ('all','shopee')),
 activity as (
  select id,'icetak' source,created_at occurred_at,total amount,'MYR' currency,cancelled from o
  where p_source<>'all' or not exists(select 1 from public.marketplace_orders mx where mx.internal_order_id=o.id)
  union all select m.id,'shopee',coalesce(m.placed_at,m.created_at),f.buyer_paid,m.currency,m.current_status in ('CANCELLED','IN_CANCEL')
  from m left join public.marketplace_order_financials f on f.order_id=m.id
 ), period as materialized (select * from activity where occurred_at>=start_at and occurred_at<end_at),
 active_pc as materialized (select pc.* from public.production_components pc join o on o.id=pc.order_id where not o.done and not o.cancelled and not o.transit),
 ship as materialized (
  select s.id,s.order_id,'icetak' source,coalesce(nullif(s.courier,''),'Unknown') courier,
   s.status_group status,s.shipped_at,s.delivered_at,s.created_at,s.updated_at,
   s.cancelled_at is not null cancelled from public.shipments s join o on o.id=s.order_id where s.archived_at is null
  union all
  select s.id,s.order_id,'shopee',coalesce(nullif(s.courier_name,''),nullif(m.courier_name,''),'Unknown'),
   case when m.current_status in ('COMPLETED','CANCELLED','IN_CANCEL','SHIPPED','TO_CONFIRM_RECEIVE') then m.current_status else coalesce(s.shipment_status,'UNKNOWN') end,
   null::timestamptz,null::timestamptz,s.created_at,s.updated_at,m.current_status in ('CANCELLED','IN_CANCEL')
  from public.marketplace_shipments s join m on m.id=s.order_id
 ), sales as materialized (select * from public.sales_opportunities where p_source='all' or (p_source='shopee' and source='shopee') or (p_source='icetak' and source<>'shopee')),
 focus as (
  select o.id::text key,'orders' module,o.reference reference,coalesce(o.delivery_name,'Customer') name,
   case when o.date_need<today then 'Tarikh perlu telah lewat' else 'Perlu siap hari ini' end reason,
   o.date_need::text deadline,'urgent' severity,o.created_by owner from o where not done and not cancelled and not transit and o.date_need<=today
  union all select id::text,'marketplace-orders',order_sn,buyer_username,'Ship-by deadline',ship_by_at::text,'urgent',null from m
   where current_status in ('READY_TO_SHIP','PROCESSED') and ship_by_at>'2000-01-01'::timestamptz and ship_by_at<((today+1)::timestamp at time zone 'Asia/Kuala_Lumpur')
  union all select d.id::text,'draft-orders',coalesce(d.order_no,'Draft'),d.customer_name,'Draft menunggu admin',d.created_at::text,'warning',d.admin_approved_by
   from public.qrpay_order_drafts d where status='pending_admin' and p_source<>'shopee'
 ), days as (select generate_series(p_from::timestamp,p_to::timestamp,'1 day')::date d),
 products as (
  select coalesce(i.product_type,i.title,'Item') label,sum(coalesce(i.qty,1)) value from public.order_items i join o on o.id=i.order_id
   where o.created_at>=start_at and o.created_at<end_at and not o.cancelled group by 1
  union all select coalesce(i.title,'Shopee item'),sum(i.quantity) from public.marketplace_order_items i join m on m.id=i.order_id
   where coalesce(m.placed_at,m.created_at)>=start_at and coalesce(m.placed_at,m.created_at)<end_at and i.is_current and m.current_status not in ('CANCELLED','IN_CANCEL') group by 1
 )
 select jsonb_build_object(
 'fetched_at',now(),'range',jsonb_build_object('from',p_from,'to',p_to,'timezone','Asia/Kuala_Lumpur','source',p_source),
 'period',jsonb_build_object('orders',(select count(*) from period),'cancelled',(select count(*) from period where cancelled),
  'icetak_orders',(select count(*) from period where source='icetak'),'shopee_orders',(select count(*) from period where source='shopee'),
  'gmv',(select coalesce(sum(amount),0) from period where not cancelled and currency='MYR'),
  'gmv_missing',(select count(*) from period where amount is null and not cancelled),'foreign_currency_orders',(select count(*) from period where currency<>'MYR'),
  'payments_received',(select coalesce(sum(pt.amount),0) from public.payment_transactions pt join o on o.id=pt.order_id where pt.paid_at>=start_at and pt.paid_at<end_at),
  'previous_orders',(select count(*) from activity where occurred_at>=start_at-(p_to-p_from+1)*interval '1 day' and occurred_at<start_at),
  'new_leads',(select count(*) from sales where opened_at>=start_at and opened_at<end_at),
  'quotes',(select count(*) from public.quotation_events q join sales on sales.id=q.opportunity_id where sent_at>=start_at and sent_at<end_at),
  'won',(select count(*) from sales where stage='won' and closed_at>=start_at and closed_at<end_at),
  'lost',(select count(*) from sales where stage='lost' and closed_at>=start_at and closed_at<end_at),
  'completed',(select count(*) from o where coalesce(delivered_at,pickup_collected_at,production_completed_at)>=start_at and coalesce(delivered_at,pickup_collected_at,production_completed_at)<end_at and done)),
 'trend',coalesce((select jsonb_agg(jsonb_build_object('date',d,'icetak',(select count(*) from period where source='icetak' and (occurred_at at time zone 'Asia/Kuala_Lumpur')::date=d),
  'shopee',(select count(*) from period where source='shopee' and (occurred_at at time zone 'Asia/Kuala_Lumpur')::date=d),
  'gmv',(select coalesce(sum(amount),0) from period where not cancelled and currency='MYR' and (occurred_at at time zone 'Asia/Kuala_Lumpur')::date=d)) order by d) from days),'[]'::jsonb),
 'backlog',jsonb_build_object('active',(select count(*) from o where not done and not cancelled and not transit),
  'unpaid',(select count(*) from o where not done and not cancelled and not paid),
  'unpaid_value',(select coalesce(sum(total),0) from o where not done and not cancelled and not paid),
  'due_today',(select count(*) from o where not done and not cancelled and not transit and date_need=today),
  'overdue',(select count(*) from o where not done and not cancelled and not transit and date_need<today),
  'design_review',(select count(distinct order_id) from active_pc where review_required and lower(coalesce(review_status,'')) in ('waiting_customer_review','waiting_review','pending_review')),
  'production_components',(select count(*) from active_pc),
  'ready_pickup',(select count(*) from o where not cancelled and pickup_collected_at is null and (pickup_ready_at is not null or fulfillment_stage='ready_for_pickup')),
  'to_ship',(select count(*) from m where current_status in ('READY_TO_SHIP','PROCESSED')),
  'ship_by_today',(select count(*) from m where current_status in ('READY_TO_SHIP','PROCESSED') and (ship_by_at at time zone 'Asia/Kuala_Lumpur')::date=today),
  'ship_overdue',(select count(*) from m where current_status in ('READY_TO_SHIP','PROCESSED') and ship_by_at>'2000-01-01'::timestamptz and ship_by_at<(today::timestamp at time zone 'Asia/Kuala_Lumpur')),
  'ship_deadline_unknown',(select count(*) from m where current_status in ('READY_TO_SHIP','PROCESSED') and (ship_by_at is null or ship_by_at<='2000-01-01'::timestamptz)),
  'shipping',(select count(*) from m where current_status in ('SHIPPED','TO_CONFIRM_RECEIVE'))+(select count(*) from o where transit and not done and not cancelled),
  'drafts',(select count(*) from public.qrpay_order_drafts where status in ('pending_admin','ready_customer','awaiting_payment') and p_source<>'shopee'),
  'payment_attention',(select count(*) from public.payment_order_attention_alerts where resolved_at is null and status<>'resolved' and p_source<>'shopee'),
  'shipment_attention',(select count(*) from public.shipment_attention_alerts where resolved_at is null and status<>'resolved' and p_source<>'shopee')),
 'pipeline',jsonb_build_array(
  jsonb_build_object('label','Belum bayar','value',(select count(*) from o where not done and not cancelled and not paid),'module','orders','filter','to_pay'),
  jsonb_build_object('label','Semakan design','value',(select count(distinct order_id) from active_pc where review_required and review_status='waiting_customer_review'),'module','orders','filter','design'),
  jsonb_build_object('label','Komponen aktif','value',(select count(*) from active_pc),'module','orders','filter','active'),
  jsonb_build_object('label','Ready pickup','value',(select count(*) from o where not cancelled and pickup_collected_at is null and pickup_ready_at is not null),'module','pickup-counter'),
  jsonb_build_object('label','Shopee To Ship','value',(select count(*) from m where current_status in ('READY_TO_SHIP','PROCESSED')),'module','marketplace-orders','filter','TO_SHIP'),
  jsonb_build_object('label','Shipping / receipt','value',(select count(*) from m where current_status in ('SHIPPED','TO_CONFIRM_RECEIVE'))+(select count(*) from o where transit and not done and not cancelled),'module','shipping')),
 'production',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select coalesce(nullif(customer_stage,''),nullif(clickup_status,''),nullif(workflow,''),'Unknown') label,count(*) value from active_pc group by 1 order by 2 desc) x),'[]'::jsonb),
 'products',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select label,sum(value) value from products group by 1 order by 2 desc limit 10)x),'[]'::jsonb),
 'couriers',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select courier label,count(distinct (source,order_id)) value from ship where not cancelled and created_at>=start_at and created_at<end_at group by 1 order by 2 desc)x),'[]'::jsonb),
 'shipping_status',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select coalesce(status,'Unknown') label,count(*) value from ship where not cancelled group by 1 order by 2 desc)x),'[]'::jsonb),
 'shipping_aging',jsonb_build_array(
  jsonb_build_object('label','1 hari','value',(select count(*) from ship where source='icetak' and shipped_at is not null and delivered_at is null and not cancelled and now()-shipped_at<interval '2 days')),
  jsonb_build_object('label','2–3 hari','value',(select count(*) from ship where source='icetak' and delivered_at is null and not cancelled and now()-shipped_at>=interval '2 days' and now()-shipped_at<interval '4 days')),
  jsonb_build_object('label','4–5 hari','value',(select count(*) from ship where source='icetak' and delivered_at is null and not cancelled and now()-shipped_at>=interval '4 days' and now()-shipped_at<interval '6 days')),
  jsonb_build_object('label','6+ hari','value',(select count(*) from ship where source='icetak' and delivered_at is null and not cancelled and now()-shipped_at>=interval '6 days'))),
 'payment_methods',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select coalesce(nullif(payment_method,''),'Unknown') label,count(*) value from o where created_at>=start_at and created_at<end_at and not cancelled group by 1)x),'[]'::jsonb),
 'settlement',jsonb_build_object('coverage',(select count(*) from m join public.marketplace_order_financials f on f.order_id=m.id where f.settlement_status is not null or f.released_at is not null),
  'released',(select sum(f.released_amount) from m join public.marketplace_order_financials f on f.order_id=m.id where f.released_at>=start_at and f.released_at<end_at),
  'fees',(select sum(coalesce(f.commission_fee,0)+coalesce(f.service_fee,0)+coalesce(f.transaction_fee,0)+coalesce(f.other_fees,0)) from m join public.marketplace_order_financials f on f.order_id=m.id where coalesce(m.placed_at,m.created_at)>=start_at and coalesce(m.placed_at,m.created_at)<end_at and f.last_enriched_at is not null)),
 'returns',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from (select coalesce(return_status,'Unknown') label,count(*) value from public.marketplace_returns mr join m on m.id=mr.order_id group by 1)x),'[]'::jsonb),
 'focus',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from focus order by case when left(deadline,10)=today::text then 0 else 1 end,deadline desc nulls last limit 30)x),'[]'::jsonb),
 'sales_funnel',coalesce((select jsonb_agg(jsonb_build_object('label',stage,'value',n)) from (select stage,count(*) n from sales group by 1)x),'[]'::jsonb),
 'opportunities',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from sales order by case when stage in ('won','lost') then 1 else 0 end,updated_at desc limit 60)x),'[]'::jsonb),
 'staff_activity',coalesce((select jsonb_agg(to_jsonb(x)) from (select actor,count(*) actions from public.ai_dashboard_events where created_at>=start_at and created_at<end_at group by actor order by 2 desc)x),'[]'::jsonb),
 'ai_training',coalesce((select jsonb_agg(jsonb_build_object('label',verdict,'value',n)) from (select verdict,count(*) n from public.ai_dashboard_training where created_at>=start_at and created_at<end_at group by 1)x),'[]'::jsonb),
 'health',jsonb_build_object('notification_failed',(select count(*) from public.notification_queue where status in ('failed','error')),
  'clickup_failed',(select count(*) from public.clickup_task_sync_queue where status in ('failed','error','retry')),
  'clickup_pending',(select count(*) from public.clickup_task_sync_queue where status in ('pending','queued','processing')),
  'outbox_failed',(select count(*) from public.integration_outbox where status in ('failed','error','retry')),
  'last_shopee_webhook',(select max(received_at) from public.marketplace_webhook_events),
  'last_clickup_webhook',(select max(received_at) from public.clickup_webhook_events),
  'last_order_update',(select max(updated_at) from public.orders),
  'last_marketplace_update',(select max(updated_at) from public.marketplace_orders)),
 'limitations',jsonb_build_array('Lead dan quotation dikira daripada rekod sales rasmi, bukan needs_reply.','Pipeline ialah backlog semasa, bukan hanya order dalam tempoh dipilih.','GMV MYR tidak termasuk cancellation; cash diterima dan Shopee payout ialah metrik berasingan.','Shopee Completed bukan pengesahan courier delivered. Aging hanya shipment iCetak yang mempunyai shipped_at.','Expenses, kos stok dan net profit belum tersedia; settlement kosong bukan RM0.')) into r;
 return r;
end $$;
revoke all on function public.icetak_command_center_snapshot(date,date,text) from public,anon,authenticated;
grant execute on function public.icetak_command_center_snapshot(date,date,text) to service_role;

