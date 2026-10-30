-- Execute inside BEGIN/ROLLBACK. Net dispatch, queues, wallet and fixture all roll back.
set local role service_role;
do $$declare o uuid;older uuid;j jsonb;r jsonb;f public.marketplace_order_financials%rowtype;old_lease uuid;begin
 update public.marketplace_enrichment_jobs set available_at=now()+interval '1 day' where status in ('pending','failed');
 insert into public.marketplace_orders(provider,order_sn,shop_id,currency,region,payment_status,current_status,placed_at)
 values('shopee','QA20261030FINANCELIFECYCLE','99887766001','MYR','MY','paid','READY_TO_SHIP',now()) returning id into o;
 -- An older completed order with a long-waiting release must not delay a new order.
 insert into public.marketplace_orders(provider,order_sn,shop_id,currency,region,payment_status,current_status,placed_at)
 values('shopee','QA20261030FINANCEOLDER','99887766001','MYR','MY','paid','COMPLETED',now()-interval '5 days') returning id into older;
 insert into public.marketplace_order_financials(order_id,currency,product_subtotal,buyer_paid,shipping_fee,escrow_amount,commission_fee,service_fee,transaction_fee,other_fees)
 values(older,'MYR',20,20,0,15,3,1,1,0);
 update public.marketplace_enrichment_jobs set status='completed' where order_id=older and job_type='financial_detail';
 update public.marketplace_enrichment_jobs set available_at=now()-interval '1 day' where order_id=older and job_type='financial_release';
 if marketplace_ops.finance_detail_complete(o) then raise exception 'missing_finance_marked_complete';end if;
 update public.marketplace_enrichment_jobs set attempts=10,available_at=now() where order_id=o and job_type='financial_detail';
 r:=public.claim_marketplace_finance_jobs(1);
 if jsonb_array_length(r)<>1 then raise exception 'claim_cap_or_order_signal_failed: %',r;end if;j:=r->0;
 if (j->>'order_id')::uuid<>o then raise exception 'wrong_order_claimed';end if;
 old_lease:=(j->>'lease_id')::uuid;
 r:=public.finish_marketplace_finance_job((j->>'job_id')::uuid,old_lease,null);
 if r->>'reason'<>'FINANCE_FIELDS_INCOMPLETE' then raise exception 'empty_finance_completed';end if;
 update public.marketplace_enrichment_jobs set available_at=now() where order_id=o;
 j:=public.claim_marketplace_finance_jobs(1)->0;
 r:=public.finish_marketplace_finance_job((j->>'job_id')::uuid,old_lease,'STALE_WRITE');
 if r->>'stale_lease'<>'true' then raise exception 'stale_lease_accepted';end if;
 insert into public.marketplace_order_financials(order_id,currency,product_subtotal,buyer_paid,shipping_fee,escrow_amount,
 commission_fee,service_fee,transaction_fee,other_fees,settlement_status,last_enriched_at)
 values(o,'MYR',20,24.9,4.9,15,3,1,1,0,'pending_release',now());
 r:=public.finish_marketplace_finance_job((j->>'job_id')::uuid,(j->>'lease_id')::uuid,null);
 if r->>'completed'<>'true' then raise exception 'complete_detail_not_saved';end if;
 update public.marketplace_order_financials set escrow_amount=14,estimated_escrow_amount=999 where order_id=o;
 select * into f from public.marketplace_order_financials where order_id=o;
 if f.estimated_escrow_amount<>15 or f.payout_difference is not null then raise exception 'estimate_rewritten_or_premature_release';end if;
 update public.marketplace_orders set current_status='COMPLETED' where id=o;
 j:=public.claim_marketplace_finance_jobs(1)->0;
 if j->>'job_type'<>'financial_release' then raise exception 'completed_not_rechecked';end if;
 r:=public.finish_marketplace_finance_job((j->>'job_id')::uuid,(j->>'lease_id')::uuid,null);
 if r->>'reason'<>'AWAITING_CONFIRMED_RELEASE' then raise exception 'completed_invented_release';end if;
 select * into f from public.marketplace_order_financials where order_id=o;
 if f.completed_finance_checked_at is null or f.released_amount is not null then raise exception 'completion_check_or_release_evidence_bad';end if;
 -- Exact released amount/time supplied by provider release evidence; keep estimate.
 perform public.ingest_shopee_finance(jsonb_build_array(jsonb_build_object('order_sn','QA20261030FINANCELIFECYCLE',
 'shop_id','99887766001','payload_hash',md5(o::text||'release')||md5(o::text||'release'),'mapping_errors','[]'::jsonb,
 'normalized_data',jsonb_build_object('released_amount',14,'released_at',now(),'settlement_status','released'),
 'payload',jsonb_build_object('release_evidence','shopee_get_escrow_list'))),false);
 select * into f from public.marketplace_order_financials where order_id=o;
 if f.payout_difference<>-1 or f.estimated_escrow_amount<>15 or f.released_amount<>14 then raise exception 'release_estimate_comparison_bad';end if;
 if has_function_privilege('anon','public.claim_marketplace_finance_jobs(integer)','execute')
 or has_function_privilege('authenticated','public.finish_marketplace_finance_job(uuid,uuid,text)','execute') then raise exception 'finance_rpc_exposed';end if;
end $$;
reset role;
select 'FINANCE_LIFECYCLE_ROLLBACK_PASS' result;
