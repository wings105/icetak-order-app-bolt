-- Canonical order -> signed finance read -> immutable estimate -> confirmed release.
-- Existing provider events, wallets, currency separation and owner-only UI remain authoritative.
alter table public.marketplace_order_financials
 add column estimated_escrow_amount numeric,
 add column estimate_recorded_at timestamptz,
 add column estimate_source text,
 add column estimate_snapshot jsonb,
 add column completed_finance_checked_at timestamptz,
 add column escrow_checked_at timestamptz,
 add column payout_difference numeric generated always as
  (case when settlement_status='released' and released_at is not null then released_amount-estimated_escrow_amount end) stored;
alter table public.marketplace_enrichment_jobs add column lease_id uuid;

create or replace function marketplace_ops.finance_detail_complete(p_order_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.marketplace_order_financials f where f.order_id=p_order_id
 and f.product_subtotal is not null and f.buyer_paid is not null and f.shipping_fee is not null
 and f.escrow_amount is not null and f.commission_fee is not null
 and f.service_fee is not null and f.transaction_fee is not null)
$$;

create or replace function finance.keep_initial_shopee_estimate()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.estimated_escrow_amount is not null then
  new.estimated_escrow_amount:=old.estimated_escrow_amount;
  new.estimate_recorded_at:=old.estimate_recorded_at;
  new.estimate_source:=old.estimate_source;
  new.estimate_snapshot:=old.estimate_snapshot;
 elsif new.estimated_escrow_amount is null and new.escrow_amount is not null
 and coalesce(new.settlement_status,'pending_release')<>'released' and new.released_at is null then
  new.estimated_escrow_amount:=new.escrow_amount;
  new.estimate_recorded_at:=coalesce(new.last_enriched_at,now());
  new.estimate_source:='first_observed_before_release';
  new.estimate_snapshot:=jsonb_build_object('escrow_amount',new.escrow_amount,'product_subtotal',new.product_subtotal,
   'buyer_paid',new.buyer_paid,'shipping_fee',new.shipping_fee,'commission_fee',new.commission_fee,
   'service_fee',new.service_fee,'transaction_fee',new.transaction_fee,'other_fees',new.other_fees,
   'provider_payload',new.provider_payload);
 end if;
 return new;
end $$;
create trigger keep_initial_shopee_estimate before insert or update on public.marketplace_order_financials
 for each row execute function finance.keep_initial_shopee_estimate();

-- Reconstruct the earliest *recorded* estimate from genuine pre-release evidence.
-- Never label a final payout as an initial estimate when no history exists.
with first_estimate as (
 select distinct on(e.marketplace_order_id) e.marketplace_order_id,e.normalized_data,e.received_at
 from finance.shopee_finance_events e join public.marketplace_order_financials f on f.order_id=e.marketplace_order_id
 where e.status='applied' and e.normalized_data->>'escrow_amount' is not null
 and e.normalized_data->>'released_amount' is null and e.normalized_data->>'released_at' is null
 and coalesce(e.normalized_data->>'settlement_status','pending_release')<>'released'
 and (f.released_at is null or e.received_at<f.released_at)
 order by e.marketplace_order_id,e.received_at,e.id
)
update public.marketplace_order_financials f set estimated_escrow_amount=(e.normalized_data->>'escrow_amount')::numeric,
 estimate_recorded_at=e.received_at,estimate_source='earliest_recorded_provider_estimate',estimate_snapshot=e.normalized_data
from first_estimate e where f.order_id=e.marketplace_order_id and f.estimated_escrow_amount is null;

create or replace function public.reconcile_marketplace_finance_jobs(p_limit integer default 200)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare n integer:=0;k integer;begin
 -- Finish overdue leases and keep their attempt/error history. Retry never stops at ten.
 update public.marketplace_enrichment_jobs set status='pending',lease_id=null,locked_at=null,
  last_error='WORKER_LEASE_EXPIRED',available_at=now()+interval '1 minute',updated_at=now()
 where job_type in ('financial_detail','financial_release') and status='processing' and locked_at<now()-interval '3 minutes';
 insert into public.marketplace_enrichment_jobs(order_id,job_type,request_payload)
 select m.id,'financial_detail',jsonb_build_object('source','canonical_finance_repair')
 from public.marketplace_orders m left join public.marketplace_enrichment_jobs j on j.order_id=m.id and j.job_type='financial_detail'
 where m.provider='shopee' and m.shop_id is not null
 and (m.payment_status='paid' or upper(coalesce(m.current_status,'')) in ('READY_TO_SHIP','PROCESSED','SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED'))
 and not marketplace_ops.finance_detail_complete(m.id) and (j.id is null or j.status='completed')
 order by coalesce(m.placed_at,m.created_at) desc limit greatest(1,least(p_limit,500))
 on conflict(order_id,job_type) do update set status='pending',available_at=now(),completed_at=null,
  response_payload=marketplace_enrichment_jobs.response_payload||jsonb_build_object('repair_reason','missing_required_finance'),updated_at=now()
 where marketplace_enrichment_jobs.status='completed';
 get diagnostics n=row_count;
 insert into public.marketplace_enrichment_jobs(order_id,job_type,request_payload)
 select m.id,'financial_release',jsonb_build_object('source','canonical_completion_repair')
 from public.marketplace_orders m left join public.marketplace_order_financials f on f.order_id=m.id
 left join public.marketplace_enrichment_jobs j on j.order_id=m.id and j.job_type='financial_release'
 where m.provider='shopee' and m.shop_id is not null and upper(m.current_status)='COMPLETED'
 and (f.completed_finance_checked_at is null or f.released_at is null or f.released_amount is null or f.settlement_status is distinct from 'released')
 and (j.id is null or j.status='completed')
 order by coalesce(m.placed_at,m.created_at) desc limit greatest(1,least(p_limit,500))
 on conflict(order_id,job_type) do update set status='pending',available_at=now(),completed_at=null,updated_at=now()
 where marketplace_enrichment_jobs.status='completed';
 get diagnostics k=row_count;
 return jsonb_build_object('detail_enqueued',n,'release_enqueued',k);
end $$;

create or replace function public.claim_marketplace_finance_jobs(p_limit integer default 3)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;begin
 with due as (
  select j.id from public.marketplace_enrichment_jobs j join public.marketplace_orders m on m.id=j.order_id
  where j.job_type in ('financial_detail','financial_release') and j.status in ('pending','failed')
  and j.available_at<=now() and m.provider='shopee' and m.shop_id is not null
  and not exists(select 1 from public.marketplace_enrichment_jobs p where p.order_id=j.order_id and p.status='processing')
  -- Prefer detail before release for the same order, and recent orders before history.
  and (j.job_type='financial_detail' or not exists(select 1 from public.marketplace_enrichment_jobs d
   where d.order_id=j.order_id and d.job_type='financial_detail' and d.status in ('pending','failed') and d.available_at<=now()))
  order by case when coalesce(m.placed_at,m.created_at)>now()-interval '7 days' then 0 else 1 end,
   j.available_at,coalesce(m.placed_at,m.created_at) desc,j.id
  for update of j skip locked limit greatest(1,least(p_limit,3))
 ), claimed as (
  update public.marketplace_enrichment_jobs j set status='processing',attempts=attempts+1,
   locked_at=now(),lease_id=gen_random_uuid(),updated_at=now() from due where j.id=due.id returning j.*
 )
 select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'lease_id',j.lease_id,'order_id',m.id,'order_sn',m.order_sn,
  'shop_id',m.shop_id,'currency',m.currency,'job_type',j.job_type)),'[]'::jsonb) into result
 from claimed j join public.marketplace_orders m on m.id=j.order_id;
 return result;
end $$;

create or replace function public.finish_marketplace_finance_job(p_job_id uuid,p_lease_id uuid,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.marketplace_enrichment_jobs%rowtype;f public.marketplace_order_financials%rowtype;
 complete_order boolean;ok boolean;err text:=p_error;begin
 select * into j from public.marketplace_enrichment_jobs where id=p_job_id for update;
 if not found or j.lease_id is distinct from p_lease_id or p_lease_id is null then return jsonb_build_object('stale_lease',true);end if;
 select * into f from public.marketplace_order_financials where order_id=j.order_id;
 select upper(current_status)='COMPLETED' into complete_order from public.marketplace_orders where id=j.order_id;
 if err is null then
  update public.marketplace_order_financials set escrow_checked_at=now(),
   completed_finance_checked_at=case when complete_order then now() else completed_finance_checked_at end
   where order_id=j.order_id;
  ok:=marketplace_ops.finance_detail_complete(j.order_id) and (j.job_type='financial_detail' or
   (f.settlement_status='released' and f.released_at is not null and f.released_amount is not null));
  if not ok then err:=case when j.job_type='financial_release' and marketplace_ops.finance_detail_complete(j.order_id)
   then 'AWAITING_CONFIRMED_RELEASE' else 'FINANCE_FIELDS_INCOMPLETE' end;end if;
 else ok:=false;end if;
 update public.marketplace_enrichment_jobs set status=case when ok then 'completed' else 'pending' end,
  completed_at=case when ok then now() end,locked_at=null,lease_id=null,last_error=left(err,300),
  available_at=case when ok then available_at when err='AWAITING_CONFIRMED_RELEASE' then now()+interval '6 hours'
   when err ~* '(TOKEN|CREDENTIAL|permission|scope|auth|sign|SHOP_DISABLED)' then now()+interval '1 hour'
   else now()+make_interval(mins=>least(360,power(2,least(attempts,8))::integer)) end,
  response_payload=response_payload||jsonb_build_object('source','direct_shopee_order_lifecycle','checked_at',now(),
   'last_outcome',case when ok then 'completed' else 'retry' end,'last_error',err),updated_at=now() where id=j.id;
 return jsonb_build_object('completed',ok,'retry',not ok,'reason',err);
end $$;

create or replace function marketplace_ops.kick_finance_worker(p_mode text default 'orders')
returns bigint language plpgsql security invoker set search_path='' as $$
declare token text;n integer;begin
 if p_mode not in ('orders','maintenance') then raise exception 'invalid_mode';end if;
 insert into marketplace_ops.worker_state(key,last_started_at) values('finance_dispatch_'||p_mode,now()-interval '1 day') on conflict do nothing;
 update marketplace_ops.worker_state set last_started_at=now() where key='finance_dispatch_'||p_mode and last_started_at<now()-interval '10 seconds';
 get diagnostics n=row_count;if n=0 then return null;end if;
 select setting_value into token from public.private_runtime_settings where setting_key='admin_window_bridge_token';
 if nullif(token,'') is null then return null;end if;
 return net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/shopee-financial-enrich',
  headers:=jsonb_build_object('content-type','application/json','x-admin-window-token',token),
  body:=jsonb_build_object('mode',p_mode,'limit',3),timeout_milliseconds:=60000);
end $$;

create or replace function marketplace_ops.signal_order_finance()
returns trigger language plpgsql security invoker set search_path='' as $$
declare changed boolean:=false;begin
 if new.provider<>'shopee' or new.shop_id is null then return new;end if;
 if new.payment_status='paid' or upper(coalesce(new.current_status,'')) in ('READY_TO_SHIP','PROCESSED','SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED') then
  if not marketplace_ops.finance_detail_complete(new.id) then
   insert into public.marketplace_enrichment_jobs(order_id,job_type,request_payload)
    values(new.id,'financial_detail',jsonb_build_object('source','canonical_order_event'))
   on conflict(order_id,job_type) do update set status='pending',available_at=now(),completed_at=null,updated_at=now()
    where marketplace_enrichment_jobs.status='completed';
   changed:=true;
  end if;
  if upper(new.current_status)='COMPLETED' and (tg_op='INSERT' or upper(old.current_status) is distinct from 'COMPLETED') then
   insert into public.marketplace_enrichment_jobs(order_id,job_type,request_payload)
    values(new.id,'financial_release',jsonb_build_object('source','canonical_completed_event'))
   on conflict(order_id,job_type) do update set status='pending',available_at=now(),completed_at=null,updated_at=now()
    where marketplace_enrichment_jobs.status<>'processing';
   changed:=true;
  end if;
  if changed then perform marketplace_ops.kick_finance_worker('orders');end if;
 end if;
 return new;
end $$;
create trigger signal_order_finance after insert or update of current_status,payment_status,shop_id
 on public.marketplace_orders for each row execute function marketplace_ops.signal_order_finance();

create or replace function public.claim_marketplace_finance_maintenance()
returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;begin
 insert into marketplace_ops.worker_state(key,last_started_at) values('finance_maintenance',now()-interval '1 day') on conflict do nothing;
 update marketplace_ops.worker_state set last_started_at=now(),last_error=null where key='finance_maintenance'
 and (last_finished_at>=last_started_at or last_started_at<now()-interval '3 minutes');
 get diagnostics n=row_count;return n=1;
end $$;
create or replace function public.finish_marketplace_finance_maintenance(p_error text default null)
returns void language sql security invoker set search_path='' as $$
 update marketplace_ops.worker_state set last_finished_at=clock_timestamp(),last_error=left(p_error,300) where key='finance_maintenance'
$$;

revoke all on function marketplace_ops.finance_detail_complete(uuid),finance.keep_initial_shopee_estimate(),
 marketplace_ops.kick_finance_worker(text),marketplace_ops.signal_order_finance(),
 public.reconcile_marketplace_finance_jobs(integer),public.claim_marketplace_finance_jobs(integer),
 public.finish_marketplace_finance_job(uuid,uuid,text),public.claim_marketplace_finance_maintenance(),public.finish_marketplace_finance_maintenance(text)
 from public,anon,authenticated;
grant execute on function marketplace_ops.finance_detail_complete(uuid),finance.keep_initial_shopee_estimate(),
 marketplace_ops.kick_finance_worker(text),marketplace_ops.signal_order_finance(),
 public.reconcile_marketplace_finance_jobs(integer),public.claim_marketplace_finance_jobs(integer),
 public.finish_marketplace_finance_job(uuid,uuid,text),public.claim_marketplace_finance_maintenance(),public.finish_marketplace_finance_maintenance(text)
 to service_role;

-- Owner-requested recovery: retain attempt history and remove the permanent ten-attempt ceiling.
update public.marketplace_enrichment_jobs set status='pending',locked_at=null,lease_id=null,available_at=now(),
 response_payload=response_payload||jsonb_build_object('recovery','order_lifecycle_v2','previous_error',last_error,'previous_attempts',attempts),updated_at=now()
 where job_type in ('financial_detail','financial_release') and status in ('failed','pending') and attempts>=10;
select public.reconcile_marketplace_finance_jobs(500);
select cron.schedule('icetak-shopee-order-finance','* * * * *', $$select marketplace_ops.kick_finance_worker('orders');$$);
select cron.schedule('icetak-shopee-release-finance','* * * * *', $$select marketplace_ops.kick_finance_worker('maintenance');$$);
