-- Run with a privileged SQL client. All test data is rolled back.
begin;
set local role service_role;
do $test$
declare
  r jsonb;
  event jsonb;
  o uuid;
  f public.marketplace_order_financials%rowtype;
  v_count integer;
begin
  event:=jsonb_build_object('payload_hash',repeat('1',64),'order_sn','TESTFINANCE01','shop_id','1',
    'normalized_data',jsonb_build_object('escrow_amount','20','commission_fee','1','service_fee','0','transaction_fee','0.5','settlement_status','pending_release'),
    'mapping_errors','[]'::jsonb,'payload',jsonb_build_object('test',true));
  r:=public.ingest_shopee_finance(jsonb_build_array(event),false);
  if (r->>'pending_order')::integer<>1 then raise exception 'unknown order not queued: %',r; end if;
  insert into public.marketplace_orders(provider,order_sn,shop_id,currency,region,current_status)
    values('shopee','TESTFINANCE01','1','MYR','MY','COMPLETED') returning id into o;
  insert into public.marketplace_enrichment_jobs(order_id,job_type,status)
    values(o,'financial_release','pending');
  execute 'set constraints shopee_finance_replay_after_order_insert immediate';
  select * into f from public.marketplace_order_financials where order_id=o;
  if f.escrow_amount is distinct from 20 or f.transaction_fee is distinct from 0.5 or f.released_amount is not null then
    raise exception 'delayed replay failed or pending escrow marked released';
  end if;
  select count(*) into v_count from finance.shopee_settlement_lines where marketplace_order_id=o and is_complete=false;
  if v_count<>1 then raise exception 'pending settlement missing'; end if;
  event:=jsonb_build_object('payload_hash',repeat('2',64),'order_sn','TESTFINANCE01','shop_id','1',
    'normalized_data',jsonb_build_object('released_amount','18.5','settlement_status','released','released_at','2026-10-02T10:00:00Z','provider_updated_at','2026-10-02T10:00:00Z'),
    'mapping_errors','[]'::jsonb,'payload',jsonb_build_object('test',true,'released',true));
  r:=public.ingest_shopee_finance(jsonb_build_array(event),false);
  if (r->>'applied')::integer<>1 then raise exception 'release not applied: %',r; end if;
  r:=public.ingest_shopee_finance(jsonb_build_array(event),false);
  if (r->>'duplicates')::integer<>1 then raise exception 'retry not idempotent'; end if;
  select * into f from public.marketplace_order_financials where order_id=o;
  if f.released_amount is distinct from 18.5 or f.commission_fee is distinct from 1 or f.transaction_fee is distinct from 0.5 then
    raise exception 'partial release overwrote fees';
  end if;
  select count(*) into v_count from finance.shopee_settlement_lines where marketplace_order_id=o and is_complete;
  if v_count<>1 then raise exception 'released settlement not complete'; end if;
  select count(*) into v_count from public.marketplace_enrichment_jobs where order_id=o and status='completed';
  if v_count<>1 then raise exception 'release job not completed'; end if;
  select count(*) into v_count from finance.wallet_events where marketplace_order_id=o and amount=18.5;
  if v_count<>1 then raise exception 'wallet release duplicated or missing'; end if;
  event:=jsonb_build_object('payload_hash',repeat('3',64),'order_sn','TESTFINANCE01','shop_id','1',
    'normalized_data',jsonb_build_object('commission_fee','99','provider_updated_at','2026-09-01T10:00:00Z'),
    'mapping_errors','[]'::jsonb,'payload',jsonb_build_object('test',true,'stale',true));
  r:=public.ingest_shopee_finance(jsonb_build_array(event),false);
  if r#>>'{results,0,status}'<>'superseded' then raise exception 'stale snapshot accepted'; end if;
  select * into f from public.marketplace_order_financials where order_id=o;
  if f.commission_fee is distinct from 1 then raise exception 'stale fees overwrote current data'; end if;
  event:=jsonb_set(event,'{payload_hash}',to_jsonb(repeat('4',64)));
  event:=jsonb_set(event,'{shop_id}',to_jsonb('2'::text));
  r:=public.ingest_shopee_finance(jsonb_build_array(event),false);
  if (r->>'needs_mapping')::integer<>1 then raise exception 'shop mismatch not held'; end if;
  if has_function_privilege('anon','public.ingest_shopee_finance(jsonb,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.ingest_shopee_finance(jsonb,boolean)','EXECUTE') then
    raise exception 'public role can invoke privileged receiver';
  end if;
end;
$test$;
rollback;
select 'passed: deferred matching, partial updates, release, idempotency, stale protection, shop check, private access; rolled back' as verification;
