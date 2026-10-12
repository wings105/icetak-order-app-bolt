-- Order System: private durable recovery, operational alerts and scoped admin reads.
create schema if not exists marketplace_ops;
revoke all on schema marketplace_ops from public, anon, authenticated;
grant usage on schema marketplace_ops to service_role;
insert into finance.accounts(code,name,account_type,account_subtype,currency) values('1031-SHOPEE-WALLET-SGD','Shopee Wallet SGD','asset','wallet','SGD') on conflict(code) do nothing;
create table if not exists marketplace_ops.shops(shop_id text primary key,region text not null,currency text not null,label text not null);
alter table marketplace_ops.shops enable row level security;
insert into marketplace_ops.shops values('188218638','MY','MYR','Shopee MY'),('1635364464','SG','SGD','Shopee SG') on conflict(shop_id) do nothing;
create table if not exists marketplace_ops.jobs (
 event_id uuid primary key references public.marketplace_webhook_events(id),
 status text not null default 'pending' check(status in ('pending','in_flight','completed','dead_letter')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 leased_at timestamptz, lease_id uuid, last_error text, completed_at timestamptz, updated_at timestamptz not null default now()
);
create index if not exists marketplace_ops_due on marketplace_ops.jobs(available_at) where status='pending';
create table if not exists marketplace_ops.attempts (
 id bigint generated always as identity primary key,event_id uuid not null references public.marketplace_webhook_events(id),
 attempt integer not null,status text not null,error text,created_at timestamptz not null default now()
);
create table if not exists marketplace_ops.alerts (
 id uuid primary key default gen_random_uuid(), source_event_id uuid not null references public.marketplace_webhook_events(id),
 ordinal integer not null default 0,kind text not null,shop_id text,item_id text,order_sn text,
 title text not null,body text,url text,severity text not null default 'info',
 status text not null default 'open' check(status in ('open','resolved')),deadline timestamptz,
 details jsonb not null default '{}'::jsonb,occurred_at timestamptz not null,created_at timestamptz not null default now(),
 resolved_at timestamptz,resolved_by text,unique(source_event_id,kind,ordinal)
);
create index if not exists marketplace_ops_alerts_open on marketplace_ops.alerts(shop_id,occurred_at desc) where status='open';
create table if not exists marketplace_ops.release_cursor (
 shop_id text primary key,from_at timestamptz not null,to_at timestamptz not null,page integer not null default 1,
 updated_at timestamptz not null default now(),last_error text, next_at timestamptz not null default now()
);
create table if not exists marketplace_ops.worker_state (
 key text primary key,last_started_at timestamptz,last_finished_at timestamptz,last_error text
);
alter table marketplace_ops.jobs enable row level security;
alter table marketplace_ops.attempts enable row level security;
alter table marketplace_ops.alerts enable row level security;
alter table marketplace_ops.release_cursor enable row level security;
alter table marketplace_ops.worker_state enable row level security;
grant all on all tables in schema marketplace_ops to service_role;
grant usage,select on all sequences in schema marketplace_ops to service_role;

create or replace function marketplace_ops.process_aux_event(p_event_id uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare e public.marketplace_webhook_events%rowtype; d jsonb;x jsonb;k text;v_title text;v_body text;v_deadline timestamptz;v_severity text;v_n integer:=0;
begin
 select * into e from public.marketplace_webhook_events where id=p_event_id for update;
 if e.event_code not in (5,9,16,22,28) then return 'unsupported';end if;
 if e.parse_error is not null or e.parsed_payload is null then return 'failed';end if;
 d:=e.parsed_payload->'data';
 k:=case e.event_code when 5 then 'notification' when 9 then 'promotion' when 16 then 'listing' when 22 then 'price_change' else 'penalty' end;
 if e.event_code=5 then
  for x in select value from jsonb_array_elements(case when jsonb_typeof(d)='array' then d else jsonb_build_array(d) end) loop
   v_n:=v_n+1;
   insert into marketplace_ops.alerts(source_event_id,ordinal,kind,shop_id,title,body,url,severity,details,occurred_at)
   values(e.id,v_n,case when coalesce(x->>'title','') ilike '%buyer%waiting%reply%' then 'reply_reminder' else k end,e.shop_id,
    coalesce(nullif(x->>'title',''),'Shopee notification'),left(x->>'content',4000),case when x->>'url' ~ '^https://' then x->>'url' end,
    case when coalesce(x->>'title','') ilike '%buyer%waiting%reply%' then 'warning' else 'info' end,x,coalesce(e.occurred_at,e.received_at))
   on conflict(source_event_id,kind,ordinal) do nothing;
  end loop;
 else
  v_title:=case e.event_code when 16 then coalesce(d->>'item_name','Listing Shopee')||' · '||coalesce(d->>'item_status','') when 28 then 'Mata penalti Shopee' when 22 then 'Harga produk berubah' else 'Produk masuk promosi' end;
  v_severity:=case when e.event_code=28 or d->>'item_status'='SHOPEE_DELETE' then 'critical' when e.event_code=16 then 'warning' else 'info' end;
  select string_agg(coalesce(j->>'violation_reason',j->>'violation_type'),' · '),min(case when coalesce(j->>'fix_deadline_time','') ~ '^[0-9]+$' and (j->>'fix_deadline_time')::numeric>0 then to_timestamp((j->>'fix_deadline_time')::double precision) end)
  into v_body,v_deadline from jsonb_array_elements(coalesce(d->'item_status_details',d->'deboosted_details','[]'::jsonb)) j;
  insert into marketplace_ops.alerts(source_event_id,kind,shop_id,item_id,title,body,severity,deadline,details,occurred_at)
  values(e.id,k,e.shop_id,d->>'item_id',v_title,v_body,v_severity,v_deadline,d,coalesce(e.occurred_at,e.received_at)) on conflict(source_event_id,kind,ordinal) do nothing;
 end if;
 update public.marketplace_webhook_events set processing_status='processed',processed_at=now(),last_error=null where id=e.id;
 return 'processed';
end $$;

create or replace function marketplace_ops.queue_event()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' and new.event_code=10 or new.processing_status='failed' then
  insert into marketplace_ops.jobs(event_id) values(new.id) on conflict(event_id) do nothing;
 elsif tg_op='UPDATE' and new.processing_status='processed' then
  update marketplace_ops.jobs set status='completed',completed_at=now(),last_error=null,updated_at=now() where event_id=new.id and status<>'completed';
 end if;
 return new;
end $$;
create trigger marketplace_ops_queue_insert after insert on public.marketplace_webhook_events for each row execute function marketplace_ops.queue_event();
create trigger marketplace_ops_queue_update after update of processing_status on public.marketplace_webhook_events for each row execute function marketplace_ops.queue_event();

create or replace function public.claim_marketplace_recovery(p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;begin
 update marketplace_ops.jobs set status=case when attempts>=8 then 'dead_letter' else 'pending' end,available_at=now(),last_error='worker_lease_expired',lease_id=null,updated_at=now() where status='in_flight' and leased_at<now()-interval '5 minutes';
 with due as (select j.event_id from marketplace_ops.jobs j where j.status='pending' and j.available_at<=now() order by j.available_at limit greatest(1,least(p_limit,50)) for update skip locked),
 claimed as (update marketplace_ops.jobs j set status='in_flight',attempts=attempts+1,leased_at=now(),lease_id=gen_random_uuid(),updated_at=now() from due where j.event_id=due.event_id returning j.*)
 select coalesce(jsonb_agg(jsonb_build_object('event_id',c.event_id,'lease_id',c.lease_id,'attempt',c.attempts,'event_code',e.event_code,'received_at',e.received_at,'payload',e.parsed_payload,'processing_status',e.processing_status)),'[]'::jsonb) into result from claimed c join public.marketplace_webhook_events e on e.id=c.event_id;
 return result;
end $$;
create or replace function public.finish_marketplace_recovery(p_event_id uuid,p_lease_id uuid,p_ok boolean,p_error text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare j marketplace_ops.jobs%rowtype;begin
 select * into j from marketplace_ops.jobs where event_id=p_event_id for update;
 if j.lease_id is distinct from p_lease_id then return;end if;
 insert into marketplace_ops.attempts(event_id,attempt,status,error) values(p_event_id,j.attempts,case when p_ok then 'processed' else 'failed' end,left(p_error,500));
 update marketplace_ops.jobs set status=case when p_ok then 'completed' when attempts>=8 then 'dead_letter' else 'pending' end,
 available_at=now()+make_interval(mins=>least(120,power(2,least(attempts,7))::integer)),completed_at=case when p_ok then now() end,
 last_error=case when p_ok then null else left(p_error,500) end,lease_id=null,updated_at=now() where event_id=p_event_id;
 if p_ok then update public.marketplace_webhook_events set processing_status='processed',processed_at=now(),last_error=null where id=p_event_id;end if;
end $$;

create or replace function marketplace_ops.kick_worker()
returns bigint language plpgsql security invoker set search_path='' as $$
declare token text;begin
 if not pg_try_advisory_xact_lock(hashtext('shopee_recovery_dispatch')) then return null;end if;
 select setting_value into token from public.private_runtime_settings where setting_key='admin_window_bridge_token';
 if nullif(token,'') is null then return null;end if;
 return net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/shopee-webhook-worker',headers:=jsonb_build_object('Content-Type','application/json','x-admin-window-token',token),body:=jsonb_build_object('limit',20),timeout_milliseconds:=60000);
end $$;

alter table public.marketplace_order_financials add column if not exists fee_breakdown jsonb not null default '{}'::jsonb;
alter table public.marketplace_returns add column if not exists return_solution text;
alter table public.marketplace_returns add column if not exists refund_amount numeric;
alter table public.marketplace_returns add column if not exists return_reason text;

create or replace function public.marketplace_operations(p_action text default 'snapshot',p_filter jsonb default '{}'::jsonb,p_actor text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_shop text:=nullif(p_filter->>'shop_id','');v_id uuid;v_rows jsonb;v_events jsonb;v_alerts jsonb;v_returns jsonb;v_finance jsonb;v_jobs jsonb;v_shops jsonb;v_n integer;
begin
 if p_action='retry' then
  if nullif(p_actor,'') is null then raise exception 'actor_required';end if;
  v_id:=(p_filter->>'event_id')::uuid;
  if not exists(select 1 from public.marketplace_webhook_events where id=v_id and processing_status='failed') then raise exception 'failed_event_required';end if;
  insert into marketplace_ops.jobs(event_id) values(v_id) on conflict(event_id) do update set status='pending',attempts=0,available_at=now(),lease_id=null,last_error=null,updated_at=now() where marketplace_ops.jobs.status<>'in_flight';
  return jsonb_build_object('queued',true);
 elsif p_action='resolve_alert' then
  if nullif(p_actor,'') is null then raise exception 'actor_required';end if;
  update marketplace_ops.alerts set status=case when coalesce(p_filter->>'status','resolved')='open' then 'open' else 'resolved' end,resolved_at=case when p_filter->>'status'='open' then null else now() end,resolved_by=p_actor where id=(p_filter->>'alert_id')::uuid;
  get diagnostics v_n=row_count;return jsonb_build_object('updated',v_n);
 elsif p_action<>'snapshot' then raise exception 'invalid_action';end if;
 select coalesce(jsonb_agg(x order by total desc),'[]') into v_events from (select e.event_code,count(*) total,count(*) filter(where e.received_at>=now()-interval '24 hours') last_24h,count(*) filter(where e.processing_status='failed') failed,count(*) filter(where e.processing_status='captured') captured,sum(e.duplicate_count) duplicates,max(e.received_at) last_received_at from public.marketplace_webhook_events e where e.provider='shopee' and (v_shop is null or e.shop_id=v_shop) group by e.event_code) x;
 select coalesce(jsonb_agg(x),'[]') into v_rows from (select e.id,e.event_code,e.shop_id,e.order_sn,e.received_at,e.processing_status,e.last_error,coalesce(j.attempts,0) attempts,j.status recovery_status,j.available_at from public.marketplace_webhook_events e left join marketplace_ops.jobs j on j.event_id=e.id where e.provider='shopee' and (v_shop is null or e.shop_id=v_shop) and (nullif(p_filter->>'status','') is null or e.processing_status=p_filter->>'status') order by case when e.processing_status='failed' then 0 else 1 end,e.received_at desc limit 100) x;
 select coalesce(jsonb_agg(x),'[]') into v_alerts from (select id,kind,shop_id,item_id,order_sn,title,body,url,severity,status,deadline,details,occurred_at,resolved_at,resolved_by from marketplace_ops.alerts where (v_shop is null or shop_id=v_shop) and (coalesce(p_filter->>'alert_status','open')='all' or status=coalesce(p_filter->>'alert_status','open')) order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end,occurred_at desc limit 100) x;
 select coalesce(jsonb_agg(x),'[]') into v_returns from (select r.id,o.order_sn,o.shop_id,o.currency,r.return_sn,r.return_status,r.logistics_status,r.reverse_logistics_status,r.return_solution,r.refund_amount,r.return_reason,r.last_event_at from public.marketplace_returns r join public.marketplace_orders o on o.id=r.order_id where v_shop is null or o.shop_id=v_shop order by r.last_event_at desc nulls last limit 100) x;
 select coalesce(jsonb_agg(x),'[]') into v_finance from (select o.shop_id,f.currency,count(*) orders,count(*) filter(where f.escrow_amount is not null) escrow_known,count(*) filter(where f.released_amount is not null and f.settlement_status='released') released_known,sum(f.released_amount) filter(where f.settlement_status='released') released_total,count(*) filter(where f.released_amount is null) release_unknown from public.marketplace_order_financials f join public.marketplace_orders o on o.id=f.order_id where v_shop is null or o.shop_id=v_shop group by o.shop_id,f.currency) x;
 select coalesce(jsonb_agg(x),'[]') into v_jobs from (select j.status,count(*) total,max(j.updated_at) updated_at from marketplace_ops.jobs j join public.marketplace_webhook_events e on e.id=j.event_id where v_shop is null or e.shop_id=v_shop group by j.status) x;
 select coalesce(jsonb_agg(x),'[]') into v_shops from (select shop_id,count(*) events from public.marketplace_webhook_events where provider='shopee' and shop_id is not null group by shop_id) x;
 return jsonb_build_object('checked_at',now(),'events',v_events,'rows',v_rows,'alerts',v_alerts,'returns',v_returns,'finance',v_finance,'recovery',v_jobs,'shops',v_shops,
 'finance_jobs',(select coalesce(jsonb_agg(x),'[]') from (select j.status,count(*) total,max(j.last_error) last_error from public.marketplace_enrichment_jobs j join public.marketplace_orders o on o.id=j.order_id where v_shop is null or o.shop_id=v_shop group by j.status) x),
 'finance_worker',(select coalesce(jsonb_agg(x),'[]') from (select * from marketplace_ops.worker_state) x));
end $$;
revoke all on all functions in schema marketplace_ops from public,anon,authenticated;
grant execute on all functions in schema marketplace_ops to service_role;
revoke all on function public.claim_marketplace_recovery(integer),public.finish_marketplace_recovery(uuid,uuid,boolean,text),public.marketplace_operations(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_marketplace_recovery(integer),public.finish_marketplace_recovery(uuid,uuid,boolean,text),public.marketplace_operations(text,jsonb,text) to service_role;

CREATE OR REPLACE FUNCTION public.process_marketplace_webhook_event(p_event_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event public.marketplace_webhook_events%rowtype;
  v_payload jsonb;
  v_data jsonb;
  v_item jsonb;
  v_update jsonb;
  v_order_id uuid;
  v_order_sn text;
  v_package_number text;
  v_return_sn text;
  v_region text;
  v_status text;
  v_previous_status text;
  v_effective_status text;
  v_event_time timestamptz;
  v_line_no integer;
  v_sequence integer;
  v_quantity integer;
  v_subtotal numeric;
  v_product_subtotal numeric;
begin
  select * into v_event
  from public.marketplace_webhook_events
  where id = p_event_id
  for update;

  if not found then raise exception 'marketplace webhook event % not found', p_event_id; end if;
  if v_event.parse_error is not null or v_event.parsed_payload is null then
    update public.marketplace_webhook_events
       set processing_status='failed', last_error=coalesce(v_event.parse_error,'missing parsed payload')
     where id=p_event_id;
    return 'failed';
  end if;

  if v_event.event_code = 10 then return 'chat_routed'; end if;
  if v_event.event_code in (5,9,16,22,28) then return marketplace_ops.process_aux_event(p_event_id); end if;

  v_payload := v_event.parsed_payload;
  v_data := case when jsonb_typeof(v_payload->'data')='object' then v_payload->'data' else v_payload end;
  v_order_sn := coalesce(v_event.order_sn, nullif(v_data->>'order_sn',''), nullif(v_data->>'ordersn',''), nullif(v_payload->>'orderno',''));

  if v_order_sn is null then return 'captured'; end if;

  v_region := upper(coalesce(v_event.region, nullif(v_payload->>'region',''),
    (select region from marketplace_ops.shops where shop_id=v_event.shop_id),
    (select region from public.marketplace_orders where provider=v_event.provider and order_sn=v_order_sn),'MY'));
  v_event_time := coalesce(v_event.occurred_at, v_event.received_at);
  v_status := nullif(v_data->>'status','');

  select o.current_status into v_previous_status
  from public.marketplace_orders o
  where o.provider=v_event.provider and o.order_sn=v_order_sn;

  insert into public.marketplace_orders (
    provider, order_sn, shop_id, region, currency,
    current_status, first_seen_at, last_seen_at,
    latest_provider_update_at, created_at, updated_at
  ) values (
    v_event.provider, v_order_sn, v_event.shop_id, v_region,
    case when v_region='SG' then 'SGD' else 'MYR' end,
    coalesce(v_status,'UNKNOWN'), v_event.received_at, v_event.last_received_at,
    v_event_time, now(), now()
  )
  on conflict (provider,order_sn) do update set
    shop_id=coalesce(excluded.shop_id,public.marketplace_orders.shop_id),
    region=coalesce(excluded.region,public.marketplace_orders.region),
    currency=case when excluded.shop_id in (select shop_id from marketplace_ops.shops) then excluded.currency else coalesce(public.marketplace_orders.currency,excluded.currency) end,
    first_seen_at=least(public.marketplace_orders.first_seen_at,excluded.first_seen_at),
    last_seen_at=greatest(public.marketplace_orders.last_seen_at,excluded.last_seen_at),
    latest_provider_update_at=greatest(coalesce(public.marketplace_orders.latest_provider_update_at,'-infinity'::timestamptz),excluded.latest_provider_update_at),
    updated_at=now()
  returning id into v_order_id;

  if v_event.event_code is null and nullif(v_payload->>'orderno','') is not null then
    update public.marketplace_orders
       set buyer_username=nullif(v_payload->>'buyer',''),
           payment_status='paid',
           courier_name=nullif(v_payload->>'courier',''),
           delivery_address=nullif(v_payload->>'address',''),
           buyer_message=nullif(v_payload->>'message',''),
           placed_at=coalesce(public.marketplace_parse_local_time(v_payload->>'place_order',v_region),placed_at),
           ship_by_at=case when coalesce(public.marketplace_parse_local_time(v_payload->>'latest_update',v_region),v_event_time)>=coalesce((metadata->>'ship_by_event_time')::timestamptz,'-infinity'::timestamptz) then coalesce(public.marketplace_parse_local_time(v_payload->>'Ship Before',v_region),ship_by_at) else ship_by_at end,
           latest_provider_update_at=coalesce(public.marketplace_parse_local_time(v_payload->>'latest_update',v_region),latest_provider_update_at),
           detail_complete=true,
           detail_received_at=v_event.received_at,
           detail_source_event_id=v_event.id,
           raw_detail=v_payload,
           updated_at=now()
     where id=v_order_id;

    if jsonb_typeof(v_payload->'product')='array' then
      update public.marketplace_order_items set is_current=false,updated_at=now() where order_id=v_order_id;
      v_line_no := 0;
      v_product_subtotal := 0;
      for v_item in select value from jsonb_array_elements(v_payload->'product') loop
        v_line_no := v_line_no + 1;
        v_quantity := greatest(coalesce((v_item->>'quantity')::integer,1),1);
        v_subtotal := coalesce(public.marketplace_safe_numeric(v_item->>'discounted_price'),0) * v_quantity;
        v_product_subtotal := v_product_subtotal + v_subtotal;
        insert into public.marketplace_order_items (
          order_id,line_no,provider_item_id,provider_variation_id,item_sku,variation_sku,
          title,variation_name,quantity,unit_original_price,unit_discounted_price,
          line_subtotal,image_url,is_current,source_event_id,raw_item
        ) values (
          v_order_id,v_line_no,nullif(v_item->>'prodId',''),nullif(v_item->>'variationsku',''),
          nullif(v_item->>'prodsku',''),nullif(v_item->>'variationsku',''),
          nullif(v_item->>'prodtitle',''),nullif(v_item->>'variationname',''),v_quantity,
          public.marketplace_safe_numeric(v_item->>'original_price'),
          public.marketplace_safe_numeric(v_item->>'discounted_price'),v_subtotal,
          nullif(v_item->>'image_url',''),true,v_event.id,v_item
        )
        on conflict (order_id,line_no) do update set
          provider_item_id=excluded.provider_item_id,
          provider_variation_id=excluded.provider_variation_id,
          item_sku=excluded.item_sku,
          variation_sku=excluded.variation_sku,
          title=excluded.title,
          variation_name=excluded.variation_name,
          quantity=excluded.quantity,
          unit_original_price=excluded.unit_original_price,
          unit_discounted_price=excluded.unit_discounted_price,
          line_subtotal=excluded.line_subtotal,
          image_url=excluded.image_url,
          is_current=true,
          source_event_id=excluded.source_event_id,
          raw_item=excluded.raw_item,
          updated_at=now();
      end loop;

      insert into public.marketplace_order_financials (
        order_id,currency,product_subtotal,buyer_paid,shipping_fee,payment_method,
        settlement_status,detail_source_event_id,provider_payload,updated_at
      ) values (
        v_order_id,case when v_region='SG' then 'SGD' else 'MYR' end,
        v_product_subtotal,public.marketplace_safe_numeric(v_payload->>'buyer_paid'),
        public.marketplace_safe_numeric(v_payload->>'shipping_fee'),
        nullif(v_payload->>'payment_method',''),'pending_release',v_event.id,v_payload,now()
      )
      on conflict (order_id) do update set
        currency=excluded.currency,
        product_subtotal=excluded.product_subtotal,
        buyer_paid=excluded.buyer_paid,
        shipping_fee=excluded.shipping_fee,
        payment_method=excluded.payment_method,
        detail_source_event_id=excluded.detail_source_event_id,
        provider_payload=public.marketplace_order_financials.provider_payload || excluded.provider_payload,
        updated_at=now();
    end if;

    update public.marketplace_shipments
       set courier_name=coalesce(courier_name,nullif(v_payload->>'courier','')),updated_at=now()
     where order_id=v_order_id;

    insert into public.marketplace_order_status_history (
      order_id,source_event_id,sequence_no,event_code,event_kind,status,occurred_at,payload
    ) values (v_order_id,v_event.id,0,null,'order_detail','DETAIL_RECEIVED',v_event_time,v_payload)
    on conflict (source_event_id,sequence_no) do nothing;

  elsif v_event.event_code = 3 then
    update public.marketplace_orders
       set current_status=coalesce(v_status,current_status),
           payment_status=case
             when v_status='UNPAID' then 'unpaid'
             when v_status in ('READY_TO_SHIP','PROCESSED','SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED') then 'paid'
             else payment_status end,
           completed_scenario=nullif(v_data->>'completed_scenario',''),
           updated_at=now()
     where id=v_order_id;

    insert into public.marketplace_order_status_history (
      order_id,source_event_id,sequence_no,event_code,event_kind,status,previous_status,occurred_at,payload
    ) values (v_order_id,v_event.id,0,3,'order_status',v_status,v_previous_status,v_event_time,v_data)
    on conflict (source_event_id,sequence_no) do nothing;

    -- Reconcile by Shopee event time so late/out-of-order webhooks cannot regress status.
    v_effective_status := public.reconcile_marketplace_order_status(v_order_id);

    if v_effective_status='COMPLETED' then
      insert into public.marketplace_order_financials(order_id,currency,settlement_status,updated_at)
      values (v_order_id,case when v_region='SG' then 'SGD' else 'MYR' end,'awaiting_enrichment',now())
      on conflict (order_id) do update set
        settlement_status=case when public.marketplace_order_financials.released_at is null then 'awaiting_enrichment' else public.marketplace_order_financials.settlement_status end,
        updated_at=now();

      insert into public.marketplace_enrichment_jobs(order_id,job_type,status,available_at,request_payload,updated_at)
      values (v_order_id,'financial_release','pending',now(),jsonb_build_object('source_event_id',v_event.id),now())
      on conflict (order_id,job_type) do update set
        status=case when public.marketplace_enrichment_jobs.status='completed' then 'completed' else 'pending' end,
        available_at=case when public.marketplace_enrichment_jobs.status='completed' then public.marketplace_enrichment_jobs.available_at else now() end,
        last_error=case when public.marketplace_enrichment_jobs.status='completed' then public.marketplace_enrichment_jobs.last_error else null end,
        request_payload=public.marketplace_enrichment_jobs.request_payload || excluded.request_payload,
        updated_at=now();
    end if;

  elsif v_event.event_code in (4,15,30,47) then
    v_package_number := coalesce(v_event.package_number,nullif(v_data->>'package_number',''));
    if v_package_number is not null then
      insert into public.marketplace_shipments (
        order_id,provider,package_number,provider_forder_id,tracking_number,courier_name,
        shipment_status,fulfillment_status,logistics_channel_id,ship_by_at,return_code,
        last_event_at,raw_snapshot,updated_at
      ) values (
        v_order_id,v_event.provider,v_package_number,nullif(v_data->>'forder_id',''),
        nullif(v_data->>'tracking_no',''),
        (select courier_name from public.marketplace_orders where id=v_order_id),
        case when v_event.event_code=15 then nullif(v_data->>'status','') end,
        case when v_event.event_code=30 then nullif(v_data->>'fulfillment_status','') end,
        case when v_event.event_code=47 then nullif(v_data#>>'{new,logistics_channel_id}','') end,
        case when v_event.event_code=47 and coalesce(v_data#>>'{new,ship_by_date}','') ~ '^[0-9]+$' and (v_data#>>'{new,ship_by_date}')::bigint>0
             then to_timestamp((v_data#>>'{new,ship_by_date}')::double precision) end,
        case when v_event.event_code=47 then nullif(v_data#>>'{new,return_code}','') end,
        v_event_time,v_data,now()
      )
      on conflict (provider,package_number) do update set
        order_id=excluded.order_id,
        provider_forder_id=coalesce(excluded.provider_forder_id,public.marketplace_shipments.provider_forder_id),
        tracking_number=coalesce(excluded.tracking_number,public.marketplace_shipments.tracking_number),
        courier_name=coalesce(excluded.courier_name,public.marketplace_shipments.courier_name),
        shipment_status=coalesce(excluded.shipment_status,public.marketplace_shipments.shipment_status),
        fulfillment_status=coalesce(excluded.fulfillment_status,public.marketplace_shipments.fulfillment_status),
        logistics_channel_id=coalesce(excluded.logistics_channel_id,public.marketplace_shipments.logistics_channel_id),
        ship_by_at=coalesce(excluded.ship_by_at,public.marketplace_shipments.ship_by_at),
        return_code=coalesce(excluded.return_code,public.marketplace_shipments.return_code),
        last_event_at=greatest(coalesce(public.marketplace_shipments.last_event_at,'-infinity'::timestamptz),excluded.last_event_at),
        raw_snapshot=public.marketplace_shipments.raw_snapshot || excluded.raw_snapshot,
        updated_at=now();
    end if;

    if v_event.event_code=47 and coalesce(v_data#>>'{new,ship_by_date}','') ~ '^[0-9]+$'
       and (v_data#>>'{new,ship_by_date}')::bigint>0 then
      update public.marketplace_orders set ship_by_at=to_timestamp((v_data#>>'{new,ship_by_date}')::double precision),
       metadata=metadata||jsonb_build_object('ship_by_event_time',v_event_time,'ship_by_source','code47'),updated_at=now()
      where id=v_order_id and v_event_time>=coalesce((metadata->>'ship_by_event_time')::timestamptz,'-infinity'::timestamptz);
    end if;
    if v_event.event_code=30 then
      update public.marketplace_orders set fulfillment_status=nullif(v_data->>'fulfillment_status',''),updated_at=now() where id=v_order_id;
      v_status := nullif(v_data->>'fulfillment_status','');
    elsif v_event.event_code=4 then v_status := nullif(v_data->>'tracking_no','');
    elsif v_event.event_code=47 then v_status := array_to_string(array(select jsonb_array_elements_text(coalesce(v_data->'changed_fields','[]'::jsonb))),',');
    end if;

    insert into public.marketplace_order_status_history (
      order_id,source_event_id,sequence_no,event_code,event_kind,status,occurred_at,payload
    ) values (
      v_order_id,v_event.id,0,v_event.event_code,
      case v_event.event_code when 4 then 'tracking_assigned' when 15 then 'shipment_status' when 30 then 'fulfillment_status' else 'order_change' end,
      v_status,v_event_time,v_data
    ) on conflict (source_event_id,sequence_no) do nothing;

  elsif v_event.event_code = 29 then
    v_return_sn := nullif(v_data->>'return_sn','');
    if v_return_sn is not null then
      insert into public.marketplace_returns(order_id,provider,return_sn,last_event_at,raw_snapshot,updated_at)
      values (v_order_id,v_event.provider,v_return_sn,v_event_time,v_data,now())
      on conflict (provider,return_sn) do update set
        order_id=excluded.order_id,last_event_at=greatest(public.marketplace_returns.last_event_at,excluded.last_event_at),
        raw_snapshot=public.marketplace_returns.raw_snapshot || excluded.raw_snapshot,updated_at=now();

      v_sequence := 0;
      if jsonb_typeof(v_data->'updated_values')='array' then
        for v_update in select value from jsonb_array_elements(v_data->'updated_values') loop
          v_sequence := v_sequence + 1;
          update public.marketplace_returns set
            return_status=case when v_update->>'update_field'='return_status' then v_update->>'new_value' else return_status end,
            logistics_status=case when v_update->>'update_field'='logistics_status' then v_update->>'new_value' else logistics_status end,
            reverse_logistics_status=case when v_update->>'update_field'='reverse_logistics_status' then v_update->>'new_value' else reverse_logistics_status end,
            return_solution=case when v_update->>'update_field'='return_solution' then v_update->>'new_value' else return_solution end,
            updated_at=now()
          where provider=v_event.provider and return_sn=v_return_sn
            and not exists(select 1 from public.marketplace_order_status_history h where h.order_id=v_order_id and h.event_code=29 and h.event_kind=v_update->>'update_field' and h.payload->>'return_sn'=v_return_sn and h.occurred_at>coalesce(case when coalesce(v_update->>'update_time','') ~ '^[0-9]+$' then to_timestamp((v_update->>'update_time')::double precision) end,v_event_time));

          insert into public.marketplace_order_status_history(
            order_id,source_event_id,sequence_no,event_code,event_kind,status,previous_status,occurred_at,payload
          ) values (
            v_order_id,v_event.id,v_sequence,29,coalesce(v_update->>'update_field','return_update'),
            v_update->>'new_value',v_update->>'old_value',
            case when coalesce(v_update->>'update_time','') ~ '^[0-9]+$' then to_timestamp((v_update->>'update_time')::double precision) else v_event_time end,
            v_update||jsonb_build_object('return_sn',v_return_sn)
          ) on conflict (source_event_id,sequence_no) do nothing;
        end loop;
      end if;
    end if;
  else
    return 'captured';
  end if;

  update public.marketplace_webhook_events
     set processing_status='processed',processed_at=now(),last_error=null
   where id=p_event_id;
  return 'processed';
exception when others then
  update public.marketplace_webhook_events
     set processing_status='failed',processed_at=null,last_error=left(sqlerrm,1000)
   where id=p_event_id;
  return 'failed';
end;
$function$;
CREATE OR REPLACE FUNCTION public.normalize_marketplace_webhook_event_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.parse_error is null and (
    new.event_code in (3,4,5,9,15,16,22,28,29,30,47) or
    (new.event_code is null and nullif(new.parsed_payload->>'orderno','') is not null)
  ) then
    perform public.process_marketplace_webhook_event(new.id);
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION finance.apply_shopee_finance_event(p_event_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  e finance.shopee_finance_events%rowtype;
  o public.marketplace_orders%rowtype;
  f public.marketplace_order_financials%rowtype;
  d jsonb;
begin
  select * into e from finance.shopee_finance_events where id=p_event_id for update;
  if not found then raise exception 'finance event not found'; end if;
  if e.status in ('applied','superseded','needs_mapping') then return e.status; end if;
  if jsonb_array_length(e.mapping_errors)>0 or e.order_sn is null then
    update finance.shopee_finance_events set status='needs_mapping' where id=e.id;
    return 'needs_mapping';
  end if;
  select * into o from public.marketplace_orders where provider='shopee' and order_sn=e.order_sn;
  if not found then
    update finance.shopee_finance_events set status='pending_order' where id=e.id;
    return 'pending_order';
  end if;
  if e.shop_id is not null and o.shop_id is not null and e.shop_id<>o.shop_id then
    update finance.shopee_finance_events set status='needs_mapping',last_error='shop_id_mismatch' where id=e.id;
    return 'needs_mapping';
  end if;
  d:=e.normalized_data;
  if d ? 'currency' and o.currency is not null and d->>'currency'<>o.currency then
    update finance.shopee_finance_events set status='needs_mapping',last_error='currency_mismatch' where id=e.id;
    return 'needs_mapping';
  end if;
  if e.provider_updated_at is not null and exists (
    select 1 from finance.shopee_finance_events newer
    where newer.marketplace_order_id=o.id and newer.status='applied'
      and newer.provider_updated_at>e.provider_updated_at
  ) then
    update finance.shopee_finance_events set status='superseded',marketplace_order_id=o.id,processed_at=now() where id=e.id;
    return 'superseded';
  end if;
  insert into public.marketplace_order_financials (
    order_id,currency,product_subtotal,buyer_paid,shipping_fee,escrow_amount,released_amount,
    commission_fee,service_fee,transaction_fee,other_fees,settlement_status,released_at,
    last_enriched_at,provider_payload,updated_at
  ) values (
    o.id,coalesce(d->>'currency',o.currency),
    (d->>'product_subtotal')::numeric,(d->>'buyer_paid')::numeric,(d->>'shipping_fee')::numeric,
    (d->>'escrow_amount')::numeric,(d->>'released_amount')::numeric,
    (d->>'commission_fee')::numeric,(d->>'service_fee')::numeric,(d->>'transaction_fee')::numeric,
    (d->>'other_fees')::numeric,d->>'settlement_status',(d->>'released_at')::timestamptz,
    now(),jsonb_build_object('shopee_finance',e.payload,'finance_ingest_event_id',e.id),now()
  ) on conflict(order_id) do update set
    currency=coalesce(excluded.currency,marketplace_order_financials.currency),
    product_subtotal=coalesce(excluded.product_subtotal,marketplace_order_financials.product_subtotal),
    buyer_paid=coalesce(excluded.buyer_paid,marketplace_order_financials.buyer_paid),
    shipping_fee=coalesce(excluded.shipping_fee,marketplace_order_financials.shipping_fee),
    escrow_amount=coalesce(excluded.escrow_amount,marketplace_order_financials.escrow_amount),
    released_amount=coalesce(excluded.released_amount,marketplace_order_financials.released_amount),
    commission_fee=coalesce(excluded.commission_fee,marketplace_order_financials.commission_fee),
    service_fee=coalesce(excluded.service_fee,marketplace_order_financials.service_fee),
    transaction_fee=coalesce(excluded.transaction_fee,marketplace_order_financials.transaction_fee),
    other_fees=coalesce(excluded.other_fees,marketplace_order_financials.other_fees),
    settlement_status=case
      when excluded.settlement_status='pending_release' and marketplace_order_financials.settlement_status='released'
        then marketplace_order_financials.settlement_status
      else coalesce(excluded.settlement_status,marketplace_order_financials.settlement_status) end,
    released_at=coalesce(excluded.released_at,marketplace_order_financials.released_at),
    last_enriched_at=now(),provider_payload=coalesce(marketplace_order_financials.provider_payload,'{}'::jsonb)||excluded.provider_payload,
    updated_at=now()
  returning * into f;

  update public.marketplace_order_financials set fee_breakdown=fee_breakdown||coalesce(d->'fee_breakdown','{}'::jsonb) where order_id=o.id;

  -- Update this order only; avoid running the global settlement sync per webhook.
  insert into finance.shopee_settlement_lines (
    marketplace_order_id,order_sn,completed_at,product_subtotal,buyer_paid,shipping_fee,
    escrow_amount,released_amount,commission_fee,service_fee,transaction_fee,other_fees,
    settlement_status,released_at,is_complete,metadata
  ) values (
    o.id,o.order_sn,case when lower(coalesce(o.current_status,'')) in ('completed','to receive','delivered') then o.latest_provider_update_at end,
    f.product_subtotal,f.buyer_paid,f.shipping_fee,
    f.escrow_amount,f.released_amount,f.commission_fee,
    f.service_fee,f.transaction_fee,f.other_fees,
    f.settlement_status,f.released_at,f.released_amount is not null and f.settlement_status='released',
    jsonb_build_object('provider_payload',f.provider_payload,'payment_method',f.payment_method)
  ) on conflict(marketplace_order_id) do update set
    completed_at=coalesce(excluded.completed_at,shopee_settlement_lines.completed_at),
    product_subtotal=excluded.product_subtotal,buyer_paid=excluded.buyer_paid,shipping_fee=excluded.shipping_fee,
    escrow_amount=excluded.escrow_amount,released_amount=excluded.released_amount,
    commission_fee=excluded.commission_fee,service_fee=excluded.service_fee,transaction_fee=excluded.transaction_fee,
    other_fees=excluded.other_fees,settlement_status=excluded.settlement_status,released_at=excluded.released_at,
    is_complete=excluded.is_complete,metadata=excluded.metadata,updated_at=now();

  if f.released_amount is not null and f.settlement_status='released' then
    update public.marketplace_enrichment_jobs set status='completed',completed_at=now(),locked_at=null,
      last_error=null,response_payload=jsonb_build_object('source','shopee-finance-ingest','finance',d),updated_at=now()
    where order_id=o.id and job_type='financial_release';
    insert into finance.wallet_events(wallet_account_id,event_type,direction,amount,occurred_at,external_reference,marketplace_order_id,metadata)
    select a.id,'wallet_release','in',f.released_amount,coalesce(f.released_at,now()),'shopee-release:'||o.order_sn,o.id,
      jsonb_build_object('order_sn',o.order_sn,'settlement_status',f.settlement_status)
    from finance.accounts a where a.code=case when f.currency='SGD' then '1031-SHOPEE-WALLET-SGD' else '1030-SHOPEE-WALLET' end and a.currency=f.currency and f.released_amount>0
    on conflict(wallet_account_id,event_type,external_reference) where external_reference is not null
      do update set amount=excluded.amount,occurred_at=excluded.occurred_at,metadata=excluded.metadata;
  end if;
  update finance.shopee_finance_events set status='applied',marketplace_order_id=o.id,processed_at=now(),last_error=null where id=e.id;
  return 'applied';
end;
$function$;
CREATE OR REPLACE FUNCTION finance.sync_shopee_financials()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_lines bigint; v_events bigint;
begin
  insert into finance.shopee_settlement_lines(marketplace_order_id,order_sn,completed_at,product_subtotal,buyer_paid,shipping_fee,escrow_amount,released_amount,commission_fee,service_fee,transaction_fee,other_fees,settlement_status,released_at,is_complete,metadata)
  select mo.id,mo.order_sn,case when lower(coalesce(mo.current_status,'')) in ('completed','to receive','delivered') then mo.latest_provider_update_at end,
    f.product_subtotal,f.buyer_paid,f.shipping_fee,f.escrow_amount,f.released_amount,f.commission_fee,f.service_fee,f.transaction_fee,f.other_fees,f.settlement_status,f.released_at,
    (f.released_amount is not null and f.last_enriched_at is not null),jsonb_build_object('provider_payload',coalesce(f.provider_payload,'{}'::jsonb),'payment_method',f.payment_method)
  from public.marketplace_orders mo join public.marketplace_order_financials f on f.order_id=mo.id
  on conflict(marketplace_order_id) do update set
    order_sn=excluded.order_sn,completed_at=excluded.completed_at,product_subtotal=excluded.product_subtotal,buyer_paid=excluded.buyer_paid,shipping_fee=excluded.shipping_fee,escrow_amount=excluded.escrow_amount,released_amount=excluded.released_amount,commission_fee=excluded.commission_fee,service_fee=excluded.service_fee,transaction_fee=excluded.transaction_fee,other_fees=excluded.other_fees,settlement_status=excluded.settlement_status,released_at=excluded.released_at,is_complete=excluded.is_complete,metadata=excluded.metadata,updated_at=now();
  get diagnostics v_lines=row_count;

  insert into finance.wallet_events(wallet_account_id,event_type,direction,amount,occurred_at,external_reference,marketplace_order_id,metadata)
  select a.id,'wallet_release','in',l.released_amount,coalesce(l.released_at,l.updated_at),'shopee-release:'||l.order_sn,l.marketplace_order_id,jsonb_build_object('order_sn',l.order_sn,'settlement_status',l.settlement_status)
  from finance.shopee_settlement_lines l cross join finance.accounts a
  where a.code=case when (select currency from public.marketplace_orders o where o.id=l.marketplace_order_id)='SGD' then '1031-SHOPEE-WALLET-SGD' else '1030-SHOPEE-WALLET' end and l.released_amount>0
  on conflict(wallet_account_id,event_type,external_reference) where external_reference is not null
  do update set amount=excluded.amount,occurred_at=excluded.occurred_at,metadata=excluded.metadata;
  get diagnostics v_events=row_count;
  return jsonb_build_object('lines_synced',v_lines,'wallet_events_synced',v_events);
end $function$;


alter table finance.shopee_settlement_lines alter column product_subtotal drop not null;
alter table finance.shopee_settlement_lines alter column buyer_paid drop not null;
alter table finance.shopee_settlement_lines alter column shipping_fee drop not null;
alter table finance.shopee_settlement_lines alter column escrow_amount drop not null;
alter table finance.shopee_settlement_lines alter column released_amount drop not null;
alter table finance.shopee_settlement_lines alter column commission_fee drop not null;
alter table finance.shopee_settlement_lines alter column service_fee drop not null;
alter table finance.shopee_settlement_lines alter column transaction_fee drop not null;
alter table finance.shopee_settlement_lines alter column other_fees drop not null;
create or replace function public.claim_marketplace_finance_run()
returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;begin
 insert into marketplace_ops.worker_state(key,last_started_at) values('finance',now()-interval '1 day') on conflict(key) do nothing;
 update marketplace_ops.worker_state set last_started_at=clock_timestamp(),last_error=null where key='finance' and last_started_at<now()-interval '5 minutes';
 get diagnostics n=row_count;return n=1;
end $$;
create or replace function public.marketplace_finance_runtime(p_action text,p_body jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s text:=p_body->>'shop_id';c marketplace_ops.release_cursor%rowtype;v_from timestamptz;begin
 if p_action='cursor' then
  select greatest(now()-interval '90 days',coalesce(min(placed_at),now()-interval '7 days')) into v_from from public.marketplace_orders where shop_id=s;
  insert into marketplace_ops.release_cursor(shop_id,from_at,to_at) values(s,v_from,least(v_from+interval '7 days',now())) on conflict(shop_id) do nothing;
  select * into c from marketplace_ops.release_cursor where shop_id=s;
  return to_jsonb(c);
 elsif p_action='cursor_save' then
  update marketplace_ops.release_cursor set from_at=(p_body->>'from_at')::timestamptz,to_at=(p_body->>'to_at')::timestamptz,page=(p_body->>'page')::integer,last_error=p_body->>'error',next_at=coalesce((p_body->>'next_at')::timestamptz,now()),updated_at=now() where shop_id=s;
  return jsonb_build_object('saved',true);
 elsif p_action='state' then
  update marketplace_ops.worker_state set last_finished_at=clock_timestamp(),last_error=left(p_body->>'error',300) where key='finance';return jsonb_build_object('saved',true);
 elsif p_action='complete_job' then
  update public.marketplace_enrichment_jobs set status='completed',completed_at=now(),locked_at=null,last_error=null,updated_at=now() where id=(p_body->>'job_id')::uuid and exists(select 1 from public.marketplace_order_financials f where f.order_id=marketplace_enrichment_jobs.order_id and f.settlement_status='released' and f.released_amount is not null);
  return jsonb_build_object('saved',true);
 elsif p_action='defer_job' then
  update public.marketplace_enrichment_jobs set status=case when p_body->>'blocked'='true' then 'failed' else 'pending' end,locked_at=null,last_error=left(p_body->>'error',300),available_at=now()+make_interval(hours=>case when p_body->>'blocked'='true' then 24 else 12 end),response_payload=coalesce(response_payload,'{}'::jsonb)||jsonb_build_object('source','direct_shopee','escrow_checked',p_body->>'escrow_checked'='true'),updated_at=now() where id=(p_body->>'job_id')::uuid;
  return jsonb_build_object('saved',true);
 elsif p_action='return_detail' then
  update public.marketplace_returns set return_solution=coalesce(p_body->>'return_solution',return_solution),return_reason=coalesce(p_body->>'reason',return_reason),refund_amount=coalesce((p_body->>'refund_amount')::numeric,refund_amount),raw_snapshot=raw_snapshot||jsonb_build_object('detail',p_body->'detail') where return_sn=p_body->>'return_sn' and provider='shopee' and order_id in(select id from public.marketplace_orders where shop_id=s);
  return jsonb_build_object('saved',true);
 end if;raise exception 'invalid_action';
end $$;
revoke all on function public.claim_marketplace_finance_run(),public.marketplace_finance_runtime(text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_marketplace_finance_run(),public.marketplace_finance_runtime(text,jsonb) to service_role;
revoke all on function public.process_marketplace_webhook_event(uuid),public.normalize_marketplace_webhook_event_trigger() from public,anon,authenticated;
grant execute on function public.process_marketplace_webhook_event(uuid),public.normalize_marketplace_webhook_event_trigger() to service_role;
