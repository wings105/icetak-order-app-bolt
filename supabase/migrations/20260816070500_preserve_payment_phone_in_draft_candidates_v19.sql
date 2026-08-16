create or replace function public.finance_admin_qrpay_draft_candidates(
  p_transaction_id text,
  p_query text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_tx text:=nullif(btrim(coalesce(p_transaction_id,'')),'');
  v_query text:=nullif(btrim(coalesce(p_query,'')),'');
  v_query_phone text;
  v_amount numeric;
  v_paid_at timestamptz;
  v_provider text;
  v_sender_name text;
  v_phone text;
  v_customer_name text;
  v_ai_phone text;
  v_ai_name text;
  v_rows jsonb;
begin
  if v_tx is null then raise exception 'Transaction ID is required'; end if;

  select pt.amount,coalesce(pt.paid_at,pt.created_at),pt.provider,pt.sender_name,
         nullif(regexp_replace(coalesce(pt.raw_payload->>'matched_phone',pt.raw_payload->>'phone',''),'[^0-9]','','g'),'')
  into v_amount,v_paid_at,v_provider,v_sender_name,v_phone
  from public.payment_transactions pt
  where pt.transaction_id=v_tx
  limit 1;

  if v_amount is null then
    select up.amount,coalesce(up.paid_at,up.created_at),up.provider,up.sender_name,
           nullif(regexp_replace(coalesce(up.raw_payload->>'matched_phone',up.raw_payload->>'phone',''),'[^0-9]','','g'),'')
    into v_amount,v_paid_at,v_provider,v_sender_name,v_phone
    from public.unmatched_payment_transactions up
    where up.transaction_id=v_tx
    order by up.created_at desc
    limit 1;
  end if;

  if v_amount is null then
    return jsonb_build_object('transaction_id',v_tx,'candidates','[]'::jsonb);
  end if;

  select nullif(regexp_replace(coalesce(j.matched_phone,''),'[^0-9]','','g'),''),
         nullif(j.matched_customer_name,'')
  into v_ai_phone,v_ai_name
  from public.qrpay_ai_jobs j
  where j.transaction_id=v_tx
  order by j.created_at desc
  limit 1;
  v_phone:=coalesce(v_ai_phone,v_phone);
  v_customer_name:=coalesce(v_ai_name,nullif(v_sender_name,''));

  v_query_phone:=nullif(regexp_replace(coalesce(v_query,''),'[^0-9]','','g'),'');

  with draft_data as (
    select
      d.*,
      nullif(regexp_replace(coalesce(d.customer_phone,''),'[^0-9]','','g'),'') normalized_phone,
      exists(
        select 1 from public.payment_sessions ps
        where ps.draft_id=d.id and abs(coalesce(ps.expected_amount,0)-v_amount)<0.01
      ) session_amount_match,
      abs(coalesce(d.draft_total,0)-v_amount)<0.01 total_amount_match,
      coalesce((d.working_draft->>'date_need'),null) date_need,
      coalesce((d.working_draft->>'delivery'),'') delivery
    from public.qrpay_order_drafts d
    where d.order_id is null
      and d.status not in ('confirmed','rejected')
      and coalesce(d.payment_required,false)=true
      and coalesce(d.payment_mode,'prepaid') not in ('cash_counter','cash_at_counter')
      and d.admin_approved_at is not null
      and d.created_at >= coalesce(v_paid_at,now())-interval '30 days'
      and d.created_at <= coalesce(v_paid_at,now())+interval '1 day'
  ), ranked as (
    select x.*,
      (x.normalized_phone is not null and v_phone is not null and x.normalized_phone=v_phone) phone_match,
      case when x.session_amount_match then 0::numeric else round(coalesce(x.draft_total,0)-v_amount,2) end amount_difference,
      (x.session_amount_match or x.total_amount_match) amount_match,
      (case when x.normalized_phone is not null and v_phone is not null and x.normalized_phone=v_phone then 150 else 0 end+
       case when x.session_amount_match then 120 when x.total_amount_match then 100 else 0 end+
       case when x.customer_confirmed_at is not null then 30 else 0 end+
       case when x.status='awaiting_payment' then 25 else 0 end+
       case when x.created_at between coalesce(v_paid_at,now())-interval '3 days' and coalesce(v_paid_at,now())+interval '1 day' then 20 else 0 end+
       case when v_query is not null and (x.id::text ilike '%'||v_query||'%' or x.review_token ilike '%'||v_query||'%' or coalesce(x.customer_name,'') ilike '%'||v_query||'%') then 200 else 0 end) score
    from draft_data x
    where
      (v_query is null and ((x.normalized_phone is not null and v_phone is not null and x.normalized_phone=v_phone) or x.session_amount_match or x.total_amount_match))
      or
      (v_query is not null and (
        x.id::text ilike '%'||v_query||'%'
        or x.review_token ilike '%'||v_query||'%'
        or coalesce(x.customer_name,'') ilike '%'||v_query||'%'
        or (v_query_phone is not null and x.normalized_phone like '%'||v_query_phone||'%')
      ))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id','draft:'||id::text,'order_no','DRAFT:'||id::text,'total',draft_total,'delivery_fee',shipping_fee,'created_at',created_at,
    'payment_status',payment_status,'payment_transaction_id',transaction_id,'customer_name','🧾 DRAFT · '||coalesce(nullif(customer_name,''),'Customer'),
    'phone',customer_phone,'phone_match',phone_match,'linked_amount',0,'outstanding_before',draft_total,
    'paid_after',case when amount_match then draft_total else v_amount end,
    'remaining_after',case when amount_match then 0 else greatest(coalesce(draft_total,0)-v_amount,0) end,
    'overpaid_after',case when amount_match then 0 else greatest(v_amount-coalesce(draft_total,0),0) end,
    'settlement_status',case when amount_match then 'settled' when v_amount<coalesce(draft_total,0) then 'partial' else 'overpaid' end,
    'requires_confirmation',not coalesce(phone_match,false),'amount_difference',amount_difference,'score',score,'can_match',amount_match,
    'blocked_reason',case when amount_match then null else 'Payment amount tidak sama dengan draft / payment session' end,
    'candidate_kind','draft','draft_id',id,'review_token',review_token,'customer_review_token',customer_review_token,
    'draft_status',status,'customer_status',customer_status,'customer_confirmed',customer_confirmed_at is not null,'date_need',date_need,'delivery',delivery
  ) order by score desc,created_at desc),'[]'::jsonb)
  into v_rows
  from (select * from ranked order by score desc,created_at desc limit 10) z;

  return jsonb_build_object(
    'transaction',jsonb_build_object('transaction_id',v_tx,'amount',v_amount,'paid_at',v_paid_at,'provider',v_provider,'phone',v_phone,'customer_name',v_customer_name),
    'candidates',v_rows
  );
end
$$;

revoke all on function public.finance_admin_qrpay_draft_candidates(text,text) from public,anon,authenticated;
grant execute on function public.finance_admin_qrpay_draft_candidates(text,text) to service_role;
