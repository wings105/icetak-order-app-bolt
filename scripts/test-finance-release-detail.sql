-- Execute with the service/database role. Every fixture change is rolled back.
begin;
do $test$
declare
 oid uuid; full_payload jsonb; k text; s finance.order_finance_snapshots%rowtype;
 before_count bigint; lease uuid:=gen_random_uuid(); observed_lease uuid; observed_status text;
begin
 select f.order_id into oid from public.marketplace_order_financials f
 join public.marketplace_orders m on m.id=f.order_id
 where m.provider='shopee' and m.shop_id is not null
  and upper(coalesce(m.current_status,'')) not in ('CANCELLED','IN_CANCEL')
  and not exists(select 1 from public.marketplace_enrichment_jobs j
                 where j.order_id=f.order_id and j.status='processing')
 order by f.order_id limit 1 for update of f;
 if oid is null then raise exception 'A non-processing Shopee finance fixture is required'; end if;
 full_payload:='{"order_income":{"escrow_amount":10.30,"original_cost_of_goods_sold":12,
 "commission_fee":1,"service_fee":0.5,"seller_transaction_fee":0.2,
 "actual_shipping_fee":0,"buyer_paid_shipping_fee":0,"shopee_shipping_rebate":0,
 "shipping_fee_sst":0,"seller_return_refund":0,"reverse_shipping_fee":0,
 "voucher_from_seller":0,"seller_coin_cash_back":0,"total_adjustment_amount":0}}';
 update public.marketplace_order_financials set last_enriched_at=now(),
  provider_payload=jsonb_build_object('finance_ingest_event_id',gen_random_uuid(),'shopee_finance',full_payload)
 where order_id=oid;
 insert into public.marketplace_enrichment_jobs(order_id,job_type,status)
 values(oid,'financial_detail','completed')
 on conflict(order_id,job_type) do update set status='completed',locked_at=null,lease_id=null;
 -- Wallet-only update keeps known detail, including original field provenance.
 k:=gen_random_uuid()::text;
 update public.marketplace_order_financials set last_enriched_at=now(),
  provider_payload=jsonb_build_object('finance_ingest_event_id',k,'shopee_finance','{"released_amount":10.30}'::jsonb)
 where order_id=oid;
 select * into s from finance.order_finance_snapshots where order_id=oid and source='webhook' order by id desc limit 1;
 if (s.metrics->>'fee_total')::numeric<>1.70
  or (s.fields#>>'{released_amount,amount}')::numeric<>10.30
  or s.fields#>>'{commission_fee,retained_from_snapshot}' is null
  or s.metrics->>'detail_retained'<>'true' then raise exception 'Release erased known detail/provenance'; end if;
 if not exists(select 1 from public.marketplace_enrichment_jobs where order_id=oid and job_type='financial_detail' and status='pending') then raise exception 'Signed detail refresh not queued'; end if;
 if (finance.order_profit_row(oid)#>>'{finance_metrics,fee_total}')::numeric<>1.70 then raise exception 'Report did not retain fee detail'; end if;
 select count(*) into before_count from finance.order_finance_snapshots where order_id=oid;
 update public.marketplace_enrichment_jobs set status='completed' where order_id=oid and job_type='financial_detail';
 perform finance.capture_order_finance(oid);
 if (select count(*) from finance.order_finance_snapshots where order_id=oid)<>before_count
  or exists(select 1 from public.marketplace_enrichment_jobs where order_id=oid and job_type='financial_detail' and status<>'completed') then raise exception 'Replay duplicated snapshot or refresh'; end if;
 -- A fresh full response is authoritative: explicit zero must replace older fees.
 full_payload:=jsonb_set(jsonb_set(jsonb_set(full_payload,'{order_income,commission_fee}','0'),
  '{order_income,service_fee}','0'),'{order_income,seller_transaction_fee}','0');
 update public.marketplace_order_financials set last_enriched_at=now(),
  provider_payload=jsonb_build_object('finance_ingest_event_id',gen_random_uuid(),'shopee_finance',full_payload)
 where order_id=oid;
 select * into s from finance.order_finance_snapshots where order_id=oid and source='webhook' order by id desc limit 1;
 if (s.metrics->>'fee_total')::numeric is distinct from 0 or s.metrics?'detail_retained' then raise exception 'New explicit zero was overwritten'; end if;
 -- A genuinely partial income response must remain partial, even with old data.
 update public.marketplace_order_financials set last_enriched_at=now(),
  provider_payload=jsonb_build_object('finance_ingest_event_id',gen_random_uuid(),'shopee_finance','{"order_income":{"commission_fee":2}}'::jsonb)
 where order_id=oid;
 -- Excel must never fill a missing webhook detail implicitly.
 insert into finance.order_finance_snapshots(order_id,source,source_key,fields,metrics)
 values(oid,'excel',gen_random_uuid()::text,finance.order_finance_fields(full_payload),
        finance.order_finance_metrics(finance.order_finance_fields(full_payload)));
 update public.marketplace_order_financials set last_enriched_at=now(),
  provider_payload=jsonb_build_object('finance_ingest_event_id',gen_random_uuid(),'shopee_finance','{"released_amount":0}'::jsonb)
 where order_id=oid;
 select * into s from finance.order_finance_snapshots where order_id=oid and source='webhook' order by id desc limit 1;
 if s.metrics->>'fee_total' is not null or s.fields?'commission_fee' then raise exception 'Missing detail incorrectly borrowed old/Excel fees'; end if;
 -- A release update cannot steal an in-flight worker lease.
 update public.marketplace_enrichment_jobs set status='processing',lease_id=lease,locked_at=now()
 where order_id=oid and job_type='financial_detail';
 update public.marketplace_order_financials set last_enriched_at=now(),
  provider_payload=jsonb_build_object('finance_ingest_event_id',gen_random_uuid(),'shopee_finance','{"released_amount":1}'::jsonb)
 where order_id=oid;
 select status,lease_id into observed_status,observed_lease from public.marketplace_enrichment_jobs
 where order_id=oid and job_type='financial_detail';
 if observed_status<>'processing' or observed_lease is distinct from lease then raise exception 'Processing lease overwritten'; end if;
 if has_function_privilege('anon','finance.capture_order_finance(uuid)','EXECUTE')
 or has_function_privilege('authenticated','finance.capture_order_finance(uuid)','EXECUTE')
 or not has_function_privilege('service_role','finance.capture_order_finance(uuid)','EXECUTE') then raise exception 'Private capture permissions changed'; end if;
end $test$;
rollback;
