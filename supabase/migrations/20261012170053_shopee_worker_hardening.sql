-- Financial recovery is service-only; stale leases can recover without unlimited provider calls.
revoke all on function public.capture_marketplace_webhook(text,text,text,text,integer,text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,jsonb,text,integer),public.claim_marketplace_enrichment_jobs(integer),public.complete_marketplace_financial_enrichment(uuid,jsonb),public.fail_marketplace_enrichment_job(uuid,text) from public,anon,authenticated;
grant execute on function public.capture_marketplace_webhook(text,text,text,text,integer,text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,jsonb,text,integer),public.claim_marketplace_enrichment_jobs(integer),public.complete_marketplace_financial_enrichment(uuid,jsonb),public.fail_marketplace_enrichment_job(uuid,text) to service_role;

create or replace function public.claim_marketplace_finance_run()
returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;begin
 update public.marketplace_enrichment_jobs set status=case when attempts>=10 then 'failed' else 'pending' end,locked_at=null,last_error='WORKER_LEASE_EXPIRED',available_at=now(),updated_at=now() where status='processing' and locked_at<now()-interval '5 minutes';
 insert into marketplace_ops.worker_state(key,last_started_at) values('finance',now()-interval '1 day') on conflict(key) do nothing;
 update marketplace_ops.worker_state set last_started_at=clock_timestamp(),last_error=null where key='finance' and last_started_at<now()-interval '5 minutes';
 get diagnostics n=row_count;return n=1;
end $$;

