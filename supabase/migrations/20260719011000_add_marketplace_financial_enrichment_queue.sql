CREATE OR REPLACE FUNCTION public.claim_marketplace_enrichment_jobs(p_limit integer DEFAULT 10)
 RETURNS TABLE(job_id uuid, order_id uuid, order_sn text, shop_id text, region text, currency text, job_type text, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with candidates as (
    select j.id
    from public.marketplace_enrichment_jobs j
    where j.status in ('pending','failed')
      and j.available_at <= now()
      and j.attempts < 10
    order by j.available_at,j.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),50))
  ), claimed as (
    update public.marketplace_enrichment_jobs j
       set status='processing',attempts=j.attempts+1,locked_at=now(),
           last_error=null,updated_at=now()
    from candidates c
    where j.id=c.id
    returning j.*
  )
  select c.id,c.order_id,o.order_sn,o.shop_id,o.region,o.currency,c.job_type,c.attempts
  from claimed c
  join public.marketplace_orders o on o.id=c.order_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_marketplace_financial_enrichment(p_job_id uuid, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job public.marketplace_enrichment_jobs%rowtype;
  v_data jsonb;
begin
  select * into v_job
  from public.marketplace_enrichment_jobs
  where id=p_job_id
  for update;
  if not found then raise exception 'enrichment job not found'; end if;
  if v_job.job_type <> 'financial_release' then raise exception 'unsupported enrichment job type'; end if;

  v_data := case when jsonb_typeof(p_payload->'data')='object' then p_payload->'data' else coalesce(p_payload,'{}'::jsonb) end;

  insert into public.marketplace_order_financials (
    order_id,currency,escrow_amount,released_amount,commission_fee,service_fee,
    transaction_fee,other_fees,settlement_status,released_at,last_enriched_at,
    provider_payload,updated_at
  ) values (
    v_job.order_id,
    nullif(v_data->>'currency',''),
    public.marketplace_safe_numeric(v_data->>'escrow_amount'),
    public.marketplace_safe_numeric(coalesce(v_data->>'released_amount',v_data->>'seller_income')),
    public.marketplace_safe_numeric(v_data->>'commission_fee'),
    public.marketplace_safe_numeric(v_data->>'service_fee'),
    public.marketplace_safe_numeric(v_data->>'transaction_fee'),
    public.marketplace_safe_numeric(v_data->>'other_fees'),
    coalesce(nullif(v_data->>'settlement_status',''),'released'),
    case when nullif(v_data->>'released_at','') is not null then
      case when (v_data->>'released_at') ~ '^[0-9]+([.][0-9]+)?$'
           then to_timestamp((v_data->>'released_at')::double precision)
           else (v_data->>'released_at')::timestamptz end
    end,
    now(),p_payload,now()
  )
  on conflict (order_id) do update set
    currency=coalesce(excluded.currency,public.marketplace_order_financials.currency),
    escrow_amount=coalesce(excluded.escrow_amount,public.marketplace_order_financials.escrow_amount),
    released_amount=coalesce(excluded.released_amount,public.marketplace_order_financials.released_amount),
    commission_fee=coalesce(excluded.commission_fee,public.marketplace_order_financials.commission_fee),
    service_fee=coalesce(excluded.service_fee,public.marketplace_order_financials.service_fee),
    transaction_fee=coalesce(excluded.transaction_fee,public.marketplace_order_financials.transaction_fee),
    other_fees=coalesce(excluded.other_fees,public.marketplace_order_financials.other_fees),
    settlement_status=excluded.settlement_status,
    released_at=coalesce(excluded.released_at,public.marketplace_order_financials.released_at),
    last_enriched_at=now(),
    provider_payload=public.marketplace_order_financials.provider_payload || excluded.provider_payload,
    updated_at=now();

  update public.marketplace_enrichment_jobs
     set status='completed',completed_at=now(),locked_at=null,last_error=null,
         response_payload=p_payload,updated_at=now()
   where id=p_job_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fail_marketplace_enrichment_job(p_job_id uuid, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_attempts integer;
begin
  select attempts into v_attempts
  from public.marketplace_enrichment_jobs
  where id=p_job_id
  for update;
  if not found then return; end if;

  update public.marketplace_enrichment_jobs
     set status='failed',locked_at=null,
         available_at=now()+make_interval(mins=>least(360,greatest(1,power(2,least(v_attempts,8))::integer))),
         last_error=left(coalesce(p_error,'unknown enrichment error'),1000),
         updated_at=now()
   where id=p_job_id;
end;
$function$;

revoke all on function public.claim_marketplace_enrichment_jobs(integer) from public,anon,authenticated;
revoke all on function public.complete_marketplace_financial_enrichment(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.fail_marketplace_enrichment_job(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_marketplace_enrichment_jobs(integer) to service_role;
grant execute on function public.complete_marketplace_financial_enrichment(uuid,jsonb) to service_role;
grant execute on function public.fail_marketplace_enrichment_job(uuid,text) to service_role;
