-- Internal business reporting; no order/payment mutation or journal posting.
create table if not exists finance.daily_business_report_settings (
 id boolean primary key default true check(id), enabled boolean not null default true,
 recipient_phone text not null check(recipient_phone ~ '^60[0-9]{8,11}$'),
 schedule_local_time time not null default '08:30', timezone text not null default 'Asia/Kuala_Lumpur' check(timezone='Asia/Kuala_Lumpur'),
 packing_per_order numeric not null default 0.40 check(packing_per_order between 0 and 10),
 alert_threshold_pct numeric not null default 15 check(alert_threshold_pct between 0 and 100),
 template_name text, template_language text not null default 'ms', updated_at timestamptz not null default now()
);
insert into finance.daily_business_report_settings(id,recipient_phone)
select true, text_value from public.whatsapp_settings where key='admin_order_notify_phone' on conflict(id) do nothing;
create table if not exists finance.daily_business_report_runs (
 id bigint generated always as identity primary key, report_date date not null,
 report_type text not null default 'daily' check(report_type='daily'), recipient_phone text not null,
 idempotency_key text not null unique, status text not null default 'pending'
 check(status in ('pending','processing','retry','sent','failed','skipped','uncertain')),
 attempts int not null default 0, next_attempt_at timestamptz not null default now(), started_at timestamptz,
 generated_at timestamptz, sent_at timestamptz, snapshot jsonb, message_preview text,
 provider_message_id text, delivery_status text, last_error text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists finance.daily_business_report_versions (
 id bigint generated always as identity primary key,report_date date not null,
 generated_at timestamptz not null default now(),snapshot jsonb not null,actor text not null
);
alter table finance.daily_business_report_settings enable row level security;
alter table finance.daily_business_report_runs enable row level security;
alter table finance.daily_business_report_versions enable row level security;
revoke all on finance.daily_business_report_settings,finance.daily_business_report_runs,finance.daily_business_report_versions from public,anon,authenticated;
grant all on finance.daily_business_report_settings,finance.daily_business_report_runs,finance.daily_business_report_versions to service_role;
grant usage,select on sequence finance.daily_business_report_runs_id_seq,finance.daily_business_report_versions_id_seq to service_role;
create index if not exists daily_business_report_due_idx on finance.daily_business_report_runs(next_attempt_at) where status in ('pending','retry');
insert into public.private_runtime_settings(setting_key,setting_value) values('daily_business_report_token',encode(gen_random_bytes(32),'hex')) on conflict do nothing;

-- Sale date is placed_at (Shopee) / created_at (direct); paid-only, non-cancelled.
create or replace function finance.business_sales(p_from date,p_to date)
returns table(order_id uuid,day date,channel text,sales numeric,shipping numeric,fees numeric,payout numeric,detail_complete boolean)
language sql stable security invoker set search_path='' as $$
 select m.id,(coalesce(m.placed_at,m.created_at) at time zone 'Asia/Kuala_Lumpur')::date,'shopee',
 f.product_subtotal,0::numeric,abs(coalesce(f.commission_fee,0))+abs(coalesce(f.service_fee,0))+abs(coalesce(f.transaction_fee,0))+abs(coalesce(f.other_fees,0)),
 case when f.released_at is not null or f.settlement_status='released' then f.released_amount end,m.detail_complete
 from public.marketplace_orders m left join public.marketplace_order_financials f on f.order_id=m.id
 where m.provider='shopee' and coalesce(m.currency,'MYR')='MYR' and m.payment_status='paid'
 and upper(coalesce(m.current_status,'')) !~ '(CANCEL|UNPAID|UNKNOWN|RETURN|REFUND)'
 and coalesce(m.metadata->>'dashboard_excluded','false')<>'true'
 and coalesce(m.placed_at,m.created_at)>=p_from::timestamp at time zone 'Asia/Kuala_Lumpur'
 and coalesce(m.placed_at,m.created_at)<(p_to+1)::timestamp at time zone 'Asia/Kuala_Lumpur'
 union all
 select o.id,(o.created_at at time zone 'Asia/Kuala_Lumpur')::date,
 case when to_jsonb(o)->>'sales_channel' in ('decocake_web','whatsapp','walkin','other') then to_jsonb(o)->>'sales_channel'
 when o.source in ('customer','customer_portal') then 'decocake_web'
 when d.source_type='chat_trigger' then 'whatsapp'
 when d.source_type='pickup_trigger' then 'pickup_trigger' else 'unknown' end,
 o.total-coalesce(o.delivery_fee,0),coalesce(o.delivery_fee,0),0,null,true
 from public.orders o left join lateral(select source_type from public.qrpay_order_drafts where order_id=o.id order by created_at desc,id limit 1)d on true
 where finance.order_is_paid(o.id)
 and lower(coalesce(o.status,'')||' '||coalesce(o.admin_status,'')||' '||coalesce(o.fulfillment_stage,'')) !~ '(cancel|refund|void|return)'
 and coalesce(o.source,'') not in ('shopee','marketplace','chatgpt-test')
 and not exists(select 1 from public.marketplace_orders m where m.internal_order_id=o.id or m.order_sn in(o.external_order_id,o.order_id,o.order_no))
 and o.created_at>=p_from::timestamp at time zone 'Asia/Kuala_Lumpur' and o.created_at<(p_to+1)::timestamp at time zone 'Asia/Kuala_Lumpur';
$$;
create or replace function public.finance_business_snapshot(p_date date default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d date:=coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date-1);
 first_day date;prev_start date;prev_end date;result jsonb;packing numeric;
begin
 if d>=(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Pilih tarikh sebelum hari ini';end if;
 first_day:=date_trunc('month',d)::date;prev_start:=(first_day-interval '1 month')::date;
 prev_end:=least(first_day-1,prev_start+extract(day from d)::int-1);
 select packing_per_order into packing from finance.daily_business_report_settings where id;
 with sales as materialized(select * from finance.business_sales(least(prev_start,d-13),d)),
 current_sales as materialized(select * from sales where day>=first_day),
 model as materialized(select s.*,case when channel='shopee' then finance.order_profit_row(order_id) else finance.direct_margin_row(order_id) end r from current_sales s),
 costs as materialized(select *,case when channel='shopee' then (r->>'material_total')::numeric else (r->>'material')::numeric end material,
 case when channel='shopee' then coalesce((r->'extra_costs'->'packaging'->>'amount')::numeric,0) else 0 end recorded_packing,
 case when channel='shopee' then payout-(r->>'material_total')::numeric-(r->>'extra_total')::numeric else (r->>'contribution')::numeric end base_contribution from model),
 totals as(select count(*) orders,count(sales) sales_known,coalesce(sum(sales),0) sales,coalesce(sum(shipping),0) shipping_collected,
 coalesce(sum(fees),0) fees,coalesce(sum(payout),0) released_payout,
 count(*)filter(where channel='shopee' and payout is null) payout_pending,
 count(*)filter(where material is not null) cost_known,coalesce(sum(material),0) material,
 coalesce(sum(greatest(packing-recorded_packing,0)),0) packing_added,
 coalesce(sum(case when channel<>'shopee' then (r->>'courier')::numeric-shipping end),0) direct_courier_net,
 count(*) filter(where base_contribution is not null and (channel<>'shopee' or payout is not null)) contribution_orders,
 coalesce(sum(base_contribution-greatest(packing-recorded_packing,0))filter(where channel<>'shopee' or payout is not null),0) contribution,
 count(*)filter(where not detail_complete) detail_incomplete,
 count(*)filter(where channel<>'shopee' and r->>'courier_state'='estimated') courier_estimated from costs),
 periods as(select coalesce(sum(sales)filter(where day=d),0) yesterday,
 coalesce(sum(sales)filter(where day>=first_day),0) mtd,
 coalesce(sum(sales)filter(where day between prev_start and prev_end),0) previous_mtd,
 coalesce(sum(fees)filter(where day between prev_start and prev_end),0) previous_fees,
 coalesce(sum(sales)filter(where day>=d-6),0)/7 avg7,
 coalesce(sum(sales)filter(where day between d-13 and d-7),0)/7 prev_avg7 from sales)
 select jsonb_build_object('schema_version',1,'report_date',d,'generated_at',now(),'timezone','Asia/Kuala_Lumpur',
 'basis','Paid orders by sale date; product sales exclude customer postage. Released payout is not bank reconciliation.',
 'cost_basis','MTD; estimated category/SKU costs; contribution subset only; excludes unrecorded overhead. Packing floor applied once.',
 'period',jsonb_build_object('from',first_day,'to',d,'previous_from',prev_start,'previous_to',prev_end),
 'daily',jsonb_build_object('sales',p.yesterday,'orders',(select count(*) from sales where day=d),'channels',
 (select coalesce(jsonb_agg(to_jsonb(c)),'[]') from(select channel,count(*) orders,sum(sales) sales from sales where day=d group by channel)c)),
 'mtd',to_jsonb(t)||jsonb_build_object('previous_sales',p.previous_mtd,'change_pct',case when p.previous_mtd>0 then round((p.mtd/p.previous_mtd-1)*100,2) end,
 'avg7',round(p.avg7,2),'previous_avg7',round(p.prev_avg7,2),'projection',round(p.mtd+p.avg7*((first_day+interval '1 month - 1 day')::date-d),2),
 'cost_completeness_pct',case when t.orders>0 then round(t.cost_known::numeric/t.orders*100,2) else 100 end),
 'alerts',jsonb_build_object('missing_sales',t.orders-t.sales_known,'missing_costs',t.orders-t.cost_known,'detail_incomplete',t.detail_incomplete,'payout_pending',t.payout_pending,
 'shipment_without_charge',(select count(*) from public.shipments sh join current_sales s on s.order_id=sh.order_id where sh.cancelled_at is null and sh.archived_at is null and sh.charged_amount is null),
 'unlinked_shipments',(select count(*) from public.shipments where order_id is null and created_at>=first_day::timestamp at time zone 'Asia/Kuala_Lumpur' and created_at<(d+1)::timestamp at time zone 'Asia/Kuala_Lumpur'),
 'shopee_last_seen',(select max(last_seen_at) from public.marketplace_orders where provider='shopee'),
 'shopee_stale',coalesce((select max(last_seen_at)<now()-interval '24 hours' from public.marketplace_orders where provider='shopee'),true),
 'sales_drop_alert',case when p.previous_mtd>0 then (p.mtd/p.previous_mtd-1)*100 < -(select alert_threshold_pct from finance.daily_business_report_settings where id) else false end,
 'fee_rate_increase_alert',case when p.previous_mtd>0 and p.mtd>0 then t.fees/p.mtd > p.previous_fees/p.previous_mtd else false end,
 'trend7',case when p.avg7<p.prev_avg7 then 'turun' when p.avg7>p.prev_avg7 then 'naik' else 'sama' end),
 'orders',(select coalesce(jsonb_agg(jsonb_build_object('order_id',order_id,'channel',channel,'day',day,'sales',sales,'material',material,'payout',payout,'state',r->>'state','contribution',case when channel<>'shopee' or payout is not null then base_contribution-greatest(packing-recorded_packing,0) end)),'[]') from costs))
 into result from totals t cross join periods p;
 return result;
end $$;
create or replace function public.finance_business_control(p_action text,p_date date default null,p_settings jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cfg finance.daily_business_report_settings%rowtype;d date:=coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date-1);snap jsonb;rid bigint;
begin
 select * into cfg from finance.daily_business_report_settings where id;
 if p_action='settings_save' then
  update finance.daily_business_report_settings set enabled=coalesce((p_settings->>'enabled')::boolean,enabled),
  recipient_phone=coalesce(p_settings->>'recipient_phone',recipient_phone),schedule_local_time=coalesce((p_settings->>'schedule_local_time')::time,schedule_local_time),
  template_name=nullif(p_settings->>'template_name',''),template_language=coalesce(nullif(p_settings->>'template_language',''),'ms'),updated_at=now() where id;
 elsif p_action='generate' then
  snap:=public.finance_business_snapshot(d);
  insert into finance.daily_business_report_versions(report_date,snapshot,actor)values(d,snap,'owner');
 elsif p_action in ('send','test') then
  if d>=(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Report date must be before today';end if;
  insert into finance.daily_business_report_runs(report_date,recipient_phone,idempotency_key)
  values(d,cfg.recipient_phone,d||':daily:'||cfg.recipient_phone||case when p_action='test' then ':test:'||gen_random_uuid()::text else '' end)on conflict do nothing;
 elsif p_action='retry' then
  update finance.daily_business_report_runs set status='retry',attempts=0,next_attempt_at=now(),last_error=null where report_date=d and status='failed';
 elsif p_action<>'read' then raise exception 'Invalid report action';
 end if;
 return jsonb_build_object('settings',(select to_jsonb(s) from finance.daily_business_report_settings s where id),
 'snapshot',coalesce(snap,(select snapshot from finance.daily_business_report_versions where report_date=d order by id desc limit 1)),
 'history',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select id,report_date,status,attempts,recipient_phone,sent_at,generated_at,delivery_status,last_error,provider_message_id,message_preview from finance.daily_business_report_runs order by id desc limit 30)x));
end $$;
create or replace function public.finance_business_claim() returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 -- Never blindly retry a worker that may already have called the provider.
 update finance.daily_business_report_runs set status='uncertain',last_error='Worker interrupted; verify provider before manual resend',updated_at=now() where status='processing' and started_at<now()-interval '10 minutes';
 with candidate as(select id from finance.daily_business_report_runs where status in ('pending','retry') and next_attempt_at<=now() and attempts<5 order by id for update skip locked limit 1),
 claimed as(update finance.daily_business_report_runs r set status='processing',started_at=now(),attempts=attempts+1,updated_at=now() from candidate c where r.id=c.id returning r.*)
 select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;return result;
end $$;
create or replace function public.finance_business_finish(p_id bigint,p_status text,p_snapshot jsonb,p_message text,p_provider_id text default null,p_error text default null)returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_status not in ('sent','retry','failed','uncertain') then raise exception 'Invalid status';end if;
 update finance.daily_business_report_runs set status=case when p_status='retry' and attempts>=5 then 'failed' else p_status end,
 snapshot=p_snapshot,message_preview=p_message,generated_at=now(),sent_at=case when p_status='sent' then now() end,
 provider_message_id=p_provider_id,delivery_status=case when p_status='sent' then 'accepted' else null end,last_error=p_error,
 next_attempt_at=now()+make_interval(mins=>least(60,5*power(2,attempts)::int)),updated_at=now() where id=p_id and status='processing';
 if p_snapshot is not null then insert into finance.daily_business_report_versions(report_date,snapshot,actor)select report_date,p_snapshot,'scheduler' from finance.daily_business_report_runs where id=p_id;end if;
end $$;
-- Restricted scheduler entry point uses a dedicated private runtime token, never a URL credential.
create or replace function public.finance_business_tick() returns bigint language plpgsql security definer set search_path='' as $$
declare cfg finance.daily_business_report_settings%rowtype;local_now timestamp:=now() at time zone 'Asia/Kuala_Lumpur';rid bigint;token text;
begin
 select * into cfg from finance.daily_business_report_settings where id;
 if cfg.enabled and local_now::time>=cfg.schedule_local_time then
 insert into finance.daily_business_report_runs(report_date,recipient_phone,idempotency_key)
 values(local_now::date-1,cfg.recipient_phone,(local_now::date-1)||':daily:'||cfg.recipient_phone)on conflict do nothing;
 end if;
 if exists(select 1 from finance.daily_business_report_runs where status in('pending','retry')and next_attempt_at<=now() or status='processing' and started_at<now()-interval '10 minutes')then
 select setting_value into token from public.private_runtime_settings where setting_key='daily_business_report_token';
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/daily-business-report',headers:=jsonb_build_object('Content-Type','application/json','x-business-report-token',token),body:='{}',timeout_milliseconds:=120000)into rid;
 end if;return rid;
end $$;
-- No public execution of financial data or scheduler functions.
revoke all on function finance.business_sales(date,date),public.finance_business_snapshot(date),public.finance_business_control(text,date,jsonb),public.finance_business_claim(),public.finance_business_finish(bigint,text,jsonb,text,text,text),public.finance_business_tick() from public,anon,authenticated;
grant execute on function finance.business_sales(date,date),public.finance_business_snapshot(date),public.finance_business_control(text,date,jsonb),public.finance_business_claim(),public.finance_business_finish(bigint,text,jsonb,text,text,text),public.finance_business_tick() to service_role;
select cron.schedule('icetak-daily-business-report','*/5 * * * *','select public.finance_business_tick();');
