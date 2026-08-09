-- Allow one order to be reconciled against multiple QRPay transactions.

create or replace function public.finance_admin_qrpay_match_candidates(
  p_transaction_id text,
  p_query text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_payment public.unmatched_payment_transactions%rowtype;
  v_job public.qrpay_ai_jobs%rowtype;
  v_transaction_id text:=nullif(btrim(coalesce(p_transaction_id,'')),'');
  v_query text:=nullif(btrim(coalesce(p_query,'')),'');
  v_query_phone text;
  v_phone text;
  v_rows jsonb;
begin
  if v_transaction_id is null then raise exception 'Transaction ID is required'; end if;

  select * into v_payment
  from public.unmatched_payment_transactions
  where transaction_id=v_transaction_id
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'transaction_id',v_transaction_id,
      'already_matched',exists(select 1 from public.payment_transactions where transaction_id=v_transaction_id),
      'candidates','[]'::jsonb
    );
  end if;

  select * into v_job
  from public.qrpay_ai_jobs
  where transaction_id=v_transaction_id
  limit 1;

  v_phone:=nullif(regexp_replace(coalesce(v_job.matched_phone,''),'[^0-9]','','g'),'');
  v_query_phone:=nullif(regexp_replace(coalesce(v_query,''),'[^0-9]','','g'),'');

  with order_data as (
    select
      o.id,
      coalesce(o.order_no,o.order_id) order_no,
      coalesce(o.total,0) total,
      coalesce(o.delivery_fee,0) delivery_fee,
      o.created_at,
      o.payment_status,
      o.payment_transaction_id,
      coalesce(nullif(c.name,''),nullif(o.delivery_name,''),'Customer') customer_name,
      nullif(regexp_replace(coalesce(nullif(o.delivery_phone,''),c.phone,''),'[^0-9]','','g'),'') phone,
      coalesce((
        select sum(pt.amount)
        from public.payment_transactions pt
        where pt.order_id=o.id and pt.transaction_id<>v_transaction_id
      ),0) linked_amount
    from public.orders o
    left join public.customers c on c.id=o.customer_id
  ), calculated as (
    select d.*,
      round(greatest(d.total-d.linked_amount,0),2) outstanding_before,
      round(d.linked_amount+v_payment.amount,2) paid_after,
      round(greatest(d.total-(d.linked_amount+v_payment.amount),0),2) remaining_after,
      round(greatest((d.linked_amount+v_payment.amount)-d.total,0),2) overpaid_after
    from order_data d
  ), ranked as (
    select d.*,
      (d.phone is not null and v_phone is not null and d.phone=v_phone) phone_match,
      round(d.total-d.paid_after,2) amount_difference,
      case
        when d.overpaid_after>=0.01 then 'overpaid'
        when d.remaining_after>=0.01 then 'partial'
        else 'settled'
      end settlement_status,
      (
        case when v_query is not null and lower(d.order_no)=lower(v_query) then 300 else 0 end +
        case when v_query is not null and lower(d.order_no) like '%'||lower(v_query)||'%' then 120 else 0 end +
        case when d.phone is not null and v_phone is not null and d.phone=v_phone then 100 else 0 end +
        case when abs(d.outstanding_before-v_payment.amount)<0.01 then 60 else 0 end +
        case when d.created_at between coalesce(v_payment.paid_at,v_payment.created_at)-interval '3 days'
                                   and coalesce(v_payment.paid_at,v_payment.created_at)+interval '14 days' then 20 else 0 end
      ) score
    from calculated d
    where
      (
        v_query is null
        and v_phone is not null
        and d.phone=v_phone
        and d.created_at between coalesce(v_payment.paid_at,v_payment.created_at)-interval '30 days'
                             and coalesce(v_payment.paid_at,v_payment.created_at)+interval '30 days'
      )
      or
      (
        v_query is not null
        and (
          d.order_no ilike '%'||v_query||'%'
          or (v_query_phone is not null and d.phone like '%'||v_query_phone||'%')
          or d.customer_name ilike '%'||v_query||'%'
        )
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id',id,
    'order_no',order_no,
    'total',total,
    'delivery_fee',delivery_fee,
    'created_at',created_at,
    'payment_status',payment_status,
    'payment_transaction_id',payment_transaction_id,
    'customer_name',customer_name,
    'phone',phone,
    'phone_match',phone_match,
    'linked_amount',linked_amount,
    'outstanding_before',outstanding_before,
    'paid_after',paid_after,
    'remaining_after',remaining_after,
    'overpaid_after',overpaid_after,
    'settlement_status',settlement_status,
    'amount_difference',amount_difference,
    'requires_confirmation',(not phone_match or overpaid_after>=0.01),
    'score',score,
    'can_match',true,
    'blocked_reason',null
  ) order by score desc,created_at desc),'[]'::jsonb)
  into v_rows
  from (select * from ranked order by score desc,created_at desc limit 10) x;

  return jsonb_build_object(
    'transaction',jsonb_build_object(
      'transaction_id',v_payment.transaction_id,
      'amount',v_payment.amount,
      'paid_at',coalesce(v_payment.paid_at,v_payment.created_at),
      'provider',v_payment.provider,
      'phone',v_phone,
      'customer_name',nullif(v_job.matched_customer_name,'')
    ),
    'already_matched',false,
    'candidates',v_rows
  );
end;
$$;

create or replace function public.finance_admin_manual_match_qrpay(
  p_transaction_id text,
  p_order_no text,
  p_actor text default 'admin1',
  p_confirm_mismatch boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_transaction_id text:=nullif(btrim(coalesce(p_transaction_id,'')),'');
  v_order_no text:=nullif(btrim(coalesce(p_order_no,'')),'');
  v_actor text:=coalesce(nullif(btrim(coalesce(p_actor,'')),''),'admin1');
  v_unmatched public.unmatched_payment_transactions%rowtype;
  v_job public.qrpay_ai_jobs%rowtype;
  v_order public.orders%rowtype;
  v_existing public.payment_transactions%rowtype;
  v_payment_id uuid;
  v_finance_id bigint;
  v_sales_account_id bigint;
  v_journal_id bigint;
  v_phone text;
  v_order_phone text;
  v_linked_amount numeric:=0;
  v_paid_after numeric:=0;
  v_remaining_after numeric:=0;
  v_overpaid_after numeric:=0;
  v_amount_difference numeric:=0;
  v_phone_match boolean;
  v_requires_confirmation boolean;
  v_settlement_status text;
begin
  if v_transaction_id is null or v_order_no is null then
    raise exception 'Transaction ID and order number are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('qrpay-manual-match:'||v_transaction_id,0));

  select * into v_order
  from public.orders
  where lower(coalesce(order_no,order_id))=lower(v_order_no)
  order by created_at desc
  limit 1
  for update;
  if not found then raise exception 'Order % was not found',v_order_no; end if;

  select * into v_existing
  from public.payment_transactions
  where transaction_id=v_transaction_id
  limit 1
  for update;
  if found then
    if v_existing.order_id=v_order.id then
      return jsonb_build_object(
        'success',true,'duplicate',true,'transaction_id',v_transaction_id,
        'order_id',v_order.id,'order_no',coalesce(v_order.order_no,v_order.order_id),
        'payment_id',v_existing.id
      );
    end if;
    raise exception 'Transaction % is already linked to another order',v_transaction_id;
  end if;

  select * into v_unmatched
  from public.unmatched_payment_transactions
  where transaction_id=v_transaction_id
  order by created_at desc
  limit 1
  for update;
  if not found then raise exception 'Unmatched QRPay transaction % was not found',v_transaction_id; end if;

  select * into v_job
  from public.qrpay_ai_jobs
  where transaction_id=v_transaction_id
  limit 1
  for update;

  v_phone:=nullif(regexp_replace(coalesce(v_job.matched_phone,''),'[^0-9]','','g'),'');
  select nullif(regexp_replace(coalesce(nullif(v_order.delivery_phone,''),c.phone,''),'[^0-9]','','g'),'')
  into v_order_phone
  from public.customers c
  where c.id=v_order.customer_id;
  if v_order_phone is null then
    v_order_phone:=nullif(regexp_replace(coalesce(v_order.delivery_phone,''),'[^0-9]','','g'),'');
  end if;

  select coalesce(sum(pt.amount),0) into v_linked_amount
  from public.payment_transactions pt
  where pt.order_id=v_order.id and pt.transaction_id<>v_transaction_id;

  v_paid_after:=round(v_linked_amount+v_unmatched.amount,2);
  v_remaining_after:=round(greatest(coalesce(v_order.total,0)-v_paid_after,0),2);
  v_overpaid_after:=round(greatest(v_paid_after-coalesce(v_order.total,0),0),2);
  v_amount_difference:=round(coalesce(v_order.total,0)-v_paid_after,2);
  v_phone_match:=v_phone is not null and v_order_phone is not null and v_phone=v_order_phone;
  v_requires_confirmation:=not v_phone_match or v_overpaid_after>=0.01;
  v_settlement_status:=case
    when v_overpaid_after>=0.01 then 'overpaid'
    when v_remaining_after>=0.01 then 'partial'
    else 'settled'
  end;

  if v_requires_confirmation and not coalesce(p_confirm_mismatch,false) then
    return jsonb_build_object(
      'success',false,
      'requires_confirmation',true,
      'transaction_id',v_transaction_id,
      'payment_amount',v_unmatched.amount,
      'order_id',v_order.id,
      'order_no',coalesce(v_order.order_no,v_order.order_id),
      'order_total',v_order.total,
      'linked_amount',v_linked_amount,
      'paid_after',v_paid_after,
      'remaining_after',v_remaining_after,
      'overpaid_after',v_overpaid_after,
      'settlement_status',v_settlement_status,
      'amount_difference',v_amount_difference,
      'payment_phone',v_phone,
      'order_phone',v_order_phone,
      'phone_match',v_phone_match
    );
  end if;

  insert into public.payment_transactions(
    order_id,payment_session_id,provider,transaction_id,amount,paid_at,sender_name,raw_payload
  ) values(
    v_order.id,null,coalesce(nullif(v_unmatched.provider,''),'duitnow'),v_transaction_id,
    v_unmatched.amount,coalesce(v_unmatched.paid_at,v_unmatched.created_at),nullif(v_unmatched.sender_name,''),
    coalesce(v_unmatched.raw_payload,v_unmatched.raw,'{}'::jsonb)||jsonb_build_object(
      'manual_match',true,
      'manual_match_order_no',coalesce(v_order.order_no,v_order.order_id),
      'manual_match_actor',v_actor,
      'manual_match_at',now(),
      'matched_phone',v_phone,
      'order_phone',v_order_phone,
      'linked_amount_before',v_linked_amount,
      'paid_after',v_paid_after,
      'remaining_after',v_remaining_after,
      'overpaid_after',v_overpaid_after,
      'settlement_status',v_settlement_status
    )
  ) returning id into v_payment_id;

  update public.orders set
    payment_method=coalesce(nullif(payment_method,''),'QRPay Manual Match'),
    payment_transaction_id=coalesce(payment_transaction_id,v_transaction_id),
    payment_verified_at=coalesce(payment_verified_at,now()),
    payment_verified_by=v_actor,
    payment=case when v_remaining_after<0.01 or lower(coalesce(payment,''))='paid' then 'Paid' else payment end,
    payment_status=case when v_remaining_after<0.01 or lower(coalesce(payment_status,''))='paid' then 'paid' else coalesce(payment_status,'pending') end,
    updated_at=now()
  where id=v_order.id;

  update public.qrpay_ai_jobs set
    order_id=v_order.id,
    order_no=coalesce(v_order.order_no,v_order.order_id),
    status='completed',
    completed_at=now(),
    locked_at=null,
    match_reason='manual_admin_match_existing_order_'||v_settlement_status,
    updated_at=now()
  where transaction_id=v_transaction_id;

  update public.admin_order_reviews set
    status='created',
    order_id=v_order.id,
    order_no=coalesce(v_order.order_no,v_order.order_id),
    approved_at=coalesce(approved_at,now()),
    completed_at=now(),
    last_error=null,
    evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
      'manual_match',true,'actor',v_actor,'linked_amount_before',v_linked_amount,
      'paid_after',v_paid_after,'remaining_after',v_remaining_after,
      'overpaid_after',v_overpaid_after,'settlement_status',v_settlement_status,
      'phone_match',v_phone_match
    ),
    updated_at=now()
  where transaction_id=v_transaction_id or qrpay_job_id=v_job.id;

  select id into v_finance_id
  from finance.transactions
  where status<>'void'
    and (external_reference=v_transaction_id or bank_reference=v_transaction_id)
  order by id
  limit 1
  for update;

  if v_finance_id is not null then
    select id into v_sales_account_id from finance.accounts where code='4000-SALES' limit 1;
    update finance.raw_events set processing_status='processed',processing_error=null,last_seen_at=now()
    where id in(select raw_event_id from finance.reconciliation_cases where primary_transaction_id=v_finance_id and raw_event_id is not null);
    update finance.transactions set
      order_id=v_order.id,
      status='posted',
      reconciliation_status='matched',
      classification_account_id=coalesce(v_sales_account_id,classification_account_id),
      settled_at=coalesce(settled_at,occurred_at),
      description='QRPay matched to '||coalesce(v_order.order_no,v_order.order_id),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'manual_match',true,'manual_match_actor',v_actor,'payment_transaction_id',v_payment_id,
        'order_no',coalesce(v_order.order_no,v_order.order_id),
        'linked_amount_before',v_linked_amount,'paid_after',v_paid_after,
        'remaining_after',v_remaining_after,'overpaid_after',v_overpaid_after,
        'settlement_status',v_settlement_status
      ),
      updated_at=now()
    where id=v_finance_id;
    insert into finance.payment_allocations(transaction_id,order_id,payment_session_id,amount,status,created_by)
    select v_finance_id,v_order.id,null,v_unmatched.amount,'allocated',v_actor
    where not exists(
      select 1 from finance.payment_allocations
      where transaction_id=v_finance_id and order_id=v_order.id and status='allocated'
    );
    update finance.reconciliation_cases set
      status='resolved',resolution='manual_order_match',resolved_by=v_actor,resolved_at=now()
    where primary_transaction_id=v_finance_id and status='open';
    v_journal_id:=finance.post_transaction(v_finance_id,v_actor);
    insert into finance.audit_log(actor,action,entity_type,entity_id,after_data)
    values(v_actor,'manual_match_qrpay','transaction',v_finance_id::text,jsonb_build_object(
      'order_id',v_order.id,'order_no',coalesce(v_order.order_no,v_order.order_id),
      'payment_id',v_payment_id,'journal_entry_id',v_journal_id,
      'paid_after',v_paid_after,'remaining_after',v_remaining_after,
      'settlement_status',v_settlement_status
    ));
  end if;

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(v_order.id::text,coalesce(v_order.order_no,v_order.order_id),'manual_match_qrpay',v_actor,jsonb_build_object(
    'transaction_id',v_transaction_id,'payment_id',v_payment_id,'payment_amount',v_unmatched.amount,
    'order_total',v_order.total,'linked_amount_before',v_linked_amount,
    'paid_after',v_paid_after,'remaining_after',v_remaining_after,
    'overpaid_after',v_overpaid_after,'settlement_status',v_settlement_status,
    'phone_match',v_phone_match,'finance_transaction_id',v_finance_id
  ));

  delete from public.unmatched_payment_transactions where id=v_unmatched.id;

  return jsonb_build_object(
    'success',true,
    'duplicate',false,
    'transaction_id',v_transaction_id,
    'payment_id',v_payment_id,
    'payment_amount',v_unmatched.amount,
    'order_id',v_order.id,
    'order_no',coalesce(v_order.order_no,v_order.order_id),
    'order_total',v_order.total,
    'linked_amount_before',v_linked_amount,
    'paid_after',v_paid_after,
    'remaining_after',v_remaining_after,
    'overpaid_after',v_overpaid_after,
    'settlement_status',v_settlement_status,
    'amount_difference',v_amount_difference,
    'phone_match',v_phone_match,
    'finance_transaction_id',v_finance_id,
    'journal_entry_id',v_journal_id
  );
end;
$$;

create or replace function public.icetak_reconcile_unmatched_qrpay_on_payment_insert()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_unmatched public.unmatched_payment_transactions%rowtype;
  v_job public.qrpay_ai_jobs%rowtype;
  v_order_no text;
  v_actor text:=coalesce(nullif(new.raw_payload->>'verified_by',''),'admin1');
  v_finance_id bigint;
  v_sales_account_id bigint;
  v_journal_id bigint;
begin
  if new.provider<>'manual_qr' or new.order_id is null then return new; end if;

  select * into v_unmatched
  from public.unmatched_payment_transactions
  where transaction_id=new.transaction_id
  order by created_at desc
  limit 1
  for update;
  if not found then return new; end if;

  if abs(coalesce(new.amount,0)-coalesce(v_unmatched.amount,0))>=0.01 then
    raise exception 'QRPay amount (%) must equal created order payment (%)',v_unmatched.amount,new.amount;
  end if;

  select coalesce(order_no,order_id) into v_order_no
  from public.orders where id=new.order_id;

  select * into v_job
  from public.qrpay_ai_jobs
  where transaction_id=new.transaction_id
  limit 1
  for update;

  update public.payment_transactions set
    provider=coalesce(nullif(v_unmatched.provider,''),'duitnow'),
    paid_at=coalesce(v_unmatched.paid_at,v_unmatched.created_at,new.paid_at),
    sender_name=coalesce(nullif(v_unmatched.sender_name,''),nullif(new.sender_name,'')),
    raw_payload=coalesce(v_unmatched.raw_payload,v_unmatched.raw,'{}'::jsonb)||coalesce(new.raw_payload,'{}'::jsonb)||jsonb_build_object(
      'created_from_qrpay_daily',true,'qrpay_job_id',v_job.id,'reconciled_at',now()
    )
  where id=new.id;

  update public.qrpay_ai_jobs set
    order_id=new.order_id,order_no=v_order_no,status='completed',completed_at=now(),locked_at=null,
    match_reason='manual_admin_created_paid_order',updated_at=now()
  where transaction_id=new.transaction_id;

  update public.admin_order_reviews set
    status='created',order_id=new.order_id,order_no=v_order_no,approved_at=coalesce(approved_at,now()),
    completed_at=now(),last_error=null,
    evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
      'created_from_qrpay_daily',true,'actor',v_actor,'payment_id',new.id
    ),updated_at=now()
  where transaction_id=new.transaction_id or qrpay_job_id=v_job.id;

  select id into v_finance_id
  from finance.transactions
  where status<>'void' and (external_reference=new.transaction_id or bank_reference=new.transaction_id)
  order by id limit 1 for update;

  if v_finance_id is not null then
    select id into v_sales_account_id from finance.accounts where code='4000-SALES' limit 1;
    update finance.raw_events set processing_status='processed',processing_error=null,last_seen_at=now()
    where id in(select raw_event_id from finance.reconciliation_cases where primary_transaction_id=v_finance_id and raw_event_id is not null);
    update finance.transactions set
      order_id=new.order_id,status='posted',reconciliation_status='matched',
      classification_account_id=coalesce(v_sales_account_id,classification_account_id),
      settled_at=coalesce(settled_at,occurred_at),description='QRPay created order '||v_order_no,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'created_from_qrpay_daily',true,'actor',v_actor,'payment_transaction_id',new.id,'order_no',v_order_no
      ),updated_at=now()
    where id=v_finance_id;
    insert into finance.payment_allocations(transaction_id,order_id,payment_session_id,amount,status,created_by)
    select v_finance_id,new.order_id,null,new.amount,'allocated',v_actor
    where not exists(
      select 1 from finance.payment_allocations
      where transaction_id=v_finance_id and order_id=new.order_id and status='allocated'
    );
    update finance.reconciliation_cases set
      status='resolved',resolution='manual_order_create',resolved_by=v_actor,resolved_at=now()
    where primary_transaction_id=v_finance_id and status='open';
    v_journal_id:=finance.post_transaction(v_finance_id,v_actor);
    insert into finance.audit_log(actor,action,entity_type,entity_id,after_data)
    values(v_actor,'create_order_from_qrpay','transaction',v_finance_id::text,jsonb_build_object(
      'order_id',new.order_id,'order_no',v_order_no,'payment_id',new.id,'journal_entry_id',v_journal_id
    ));
  end if;

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(new.order_id::text,v_order_no,'create_order_from_qrpay',v_actor,jsonb_build_object(
    'transaction_id',new.transaction_id,'payment_id',new.id,'payment_amount',new.amount,
    'finance_transaction_id',v_finance_id
  ));

  delete from public.unmatched_payment_transactions where id=v_unmatched.id;
  return new;
end;
$$;

drop trigger if exists trg_reconcile_unmatched_qrpay_on_payment_insert on public.payment_transactions;
create trigger trg_reconcile_unmatched_qrpay_on_payment_insert
after insert on public.payment_transactions
for each row
when (new.provider='manual_qr')
execute function public.icetak_reconcile_unmatched_qrpay_on_payment_insert();

revoke execute on function public.finance_admin_qrpay_match_candidates(text,text) from public,anon,authenticated;
revoke execute on function public.finance_admin_manual_match_qrpay(text,text,text,boolean) from public,anon,authenticated;
revoke execute on function public.icetak_reconcile_unmatched_qrpay_on_payment_insert() from public,anon,authenticated;
grant execute on function public.finance_admin_qrpay_match_candidates(text,text) to service_role;
grant execute on function public.finance_admin_manual_match_qrpay(text,text,text,boolean) to service_role;

comment on function public.finance_admin_qrpay_match_candidates(text,text) is 'Owner Finance helper for cumulative QRPay-to-order candidate lookup.';
comment on function public.finance_admin_manual_match_qrpay(text,text,text,boolean) is 'Atomically links one of multiple QRPay transactions to an existing order and finance ledger.';
