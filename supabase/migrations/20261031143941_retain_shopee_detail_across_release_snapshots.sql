-- A payout-only event is wallet evidence, not a replacement for order-income detail.
-- Keep immutable snapshots and field provenance; recheck signed detail separately.
create or replace function finance.capture_order_finance(p_order_id uuid)
returns void language plpgsql set search_path='' as $$
declare
 p jsonb; fs jsonb; k text; previous finance.order_finance_snapshots%rowtype;
 retained jsonb; snapshot_id bigint; release_only boolean;
begin
 select coalesce(provider_payload->'shopee_finance',provider_payload),
        coalesce(provider_payload->>'finance_ingest_event_id',md5(provider_payload::text))
 into p,k from public.marketplace_order_financials
 where order_id=p_order_id and last_enriched_at is not null;
 if p is null then return; end if;
 -- The existing unique source key remains the replay boundary.
 if exists(select 1 from finance.order_finance_snapshots
           where order_id=p_order_id and source='webhook' and source_key=k) then return; end if;
 fs:=finance.order_finance_fields(p);
 if fs='{}' then return; end if;
 release_only:=fs?'released_amount' and (fs-'released_amount')='{}';
 if release_only then
  select * into previous from finance.order_finance_snapshots
  where order_id=p_order_id and source='webhook' order by id desc limit 1;
  -- Retain only the immediately preceding complete webhook detail. Never fill
  -- genuinely incomplete detail from older snapshots, Excel or another order.
  if previous.id is not null and previous.metrics->>'fee_total' is not null then
   select jsonb_object_agg(e.key,e.value||jsonb_build_object(
    'retained_from_snapshot',coalesce(e.value->'retained_from_snapshot',to_jsonb(previous.id)),
    'observed_at',coalesce(e.value->'observed_at',to_jsonb(previous.captured_at))))
   into retained from jsonb_each(previous.fields)e;
   fs:=coalesce(retained,'{}')||fs;
  end if;
 end if;
 insert into finance.order_finance_snapshots(order_id,source,source_key,fields,metrics)
 values(p_order_id,'webhook',k,fs,finance.order_finance_metrics(fs)||
  case when retained is not null then jsonb_build_object(
    'detail_retained',true,'detail_snapshot_id',previous.id) else '{}'::jsonb end)
 on conflict do nothing returning id into snapshot_id;
 if release_only and snapshot_id is not null then
  -- Detail can change at final payout (for example affiliate charges). Reuse
  -- the existing signed worker; do not infer current fees or release from status.
  insert into public.marketplace_enrichment_jobs(order_id,job_type,request_payload)
  select m.id,'financial_detail',jsonb_build_object(
   'source','release_detail_refresh','finance_source_key',k)
  from public.marketplace_orders m
  where m.id=p_order_id and m.provider='shopee' and m.shop_id is not null
   and upper(coalesce(m.current_status,'')) not in ('CANCELLED','IN_CANCEL')
  on conflict(order_id,job_type) do update set
   status='pending',available_at=now(),completed_at=null,locked_at=null,lease_id=null,
   request_payload=marketplace_enrichment_jobs.request_payload||excluded.request_payload,
   updated_at=now()
  where marketplace_enrichment_jobs.status<>'processing';
 end if;
end $$;
revoke all on function finance.capture_order_finance(uuid) from public,anon,authenticated;
grant execute on function finance.capture_order_finance(uuid) to service_role;
