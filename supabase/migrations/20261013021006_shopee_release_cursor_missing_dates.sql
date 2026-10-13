-- Date-less orders must retain their known release history window.
CREATE OR REPLACE FUNCTION public.marketplace_finance_runtime(p_action text, p_body jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s text:=p_body->>'shop_id';c marketplace_ops.release_cursor%rowtype;v_from timestamptz;begin
 if p_action='cursor' then
  select greatest(now()-interval '90 days',coalesce(min(coalesce(placed_at,created_at)),now()-interval '7 days')) into v_from from public.marketplace_orders where shop_id=s;
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
 elsif p_action='complete_detail' then
  update public.marketplace_enrichment_jobs set status='completed',completed_at=now(),locked_at=null,last_error=null,updated_at=now() where id=(p_body->>'job_id')::uuid and job_type='financial_detail' and exists(select 1 from public.marketplace_order_financials f where f.order_id=marketplace_enrichment_jobs.order_id and f.escrow_amount is not null);
  return jsonb_build_object('saved',true);
 elsif p_action='defer_job' then
  update public.marketplace_enrichment_jobs set status=case when p_body->>'blocked'='true' then 'failed' else 'pending' end,locked_at=null,last_error=left(p_body->>'error',300),available_at=now()+make_interval(hours=>case when p_body->>'blocked'='true' then 24 else 12 end),response_payload=coalesce(response_payload,'{}'::jsonb)||jsonb_build_object('source','direct_shopee','escrow_checked',p_body->>'escrow_checked'='true'),updated_at=now() where id=(p_body->>'job_id')::uuid and status<>'completed';
  return jsonb_build_object('saved',true);
 elsif p_action='return_detail' then
  update public.marketplace_returns set return_solution=coalesce(p_body->>'return_solution',return_solution),return_reason=coalesce(p_body->>'reason',return_reason),refund_amount=coalesce((p_body->>'refund_amount')::numeric,refund_amount),raw_snapshot=raw_snapshot||jsonb_build_object('detail',p_body->'detail') where return_sn=p_body->>'return_sn' and provider='shopee' and order_id in(select id from public.marketplace_orders where shop_id=s);
  return jsonb_build_object('saved',true);
 end if;raise exception 'invalid_action';
end $function$;
-- SG was previously unconfigured and has status-only orders without placed_at.
-- Replay from their first recorded order, bounded to 90 days; ingest/wallet hashes deduplicate.
with start_at as (select greatest(now()-interval '90 days',min(coalesce(placed_at,created_at))) at from public.marketplace_orders where shop_id='1635364464')
update marketplace_ops.release_cursor c set from_at=s.at,to_at=least(s.at+interval '7 days',now()),page=1,next_at=now(),last_error=null,updated_at=now() from start_at s where c.shop_id='1635364464' and s.at is not null and c.from_at>s.at;
