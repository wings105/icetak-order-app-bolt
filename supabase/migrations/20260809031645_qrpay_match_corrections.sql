-- Owner-only QRPay match corrections.
-- Keeps the bank transaction, payment history and order artefacts auditable while
-- allowing a mistaken match to be unassigned or moved to another order.

create or replace function finance.recalculate_order_payment(
  p_order_id uuid,
  p_actor text default 'system'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_paid numeric:=0;
  v_count integer:=0;
  v_primary text;
  v_last_paid timestamptz;
  v_payment text;
  v_payment_status text;
begin
  if p_order_id is null then return null; end if;

  select * into v_order from public.orders where id=p_order_id for update;
  if not found then return null; end if;

  select
    count(*)::integer,
    coalesce(sum(p.amount),0),
    (array_agg(p.transaction_id order by coalesce(p.paid_at,p.created_at),p.created_at,p.id))[1],
    max(coalesce(p.paid_at,p.created_at))
  into v_count,v_paid,v_primary,v_last_paid
  from public.payment_transactions p
  where p.order_id=p_order_id;

  v_payment:=case
    when v_paid>=coalesce(v_order.total,0)-0.009 and coalesce(v_order.total,0)>0 then 'Paid'
    when v_paid>0 then 'Partial Payment'
    else 'Unpaid'
  end;
  v_payment_status:=case
    when v_payment='Paid' then 'paid'
    when v_payment='Partial Payment' then 'partial'
    else 'pending'
  end;

  update public.orders set
    payment=v_payment,
    payment_status=v_payment_status,
    payment_transaction_id=v_primary,
    payment_method=case when v_count=0 then null when v_count=1 then 'QRPay' else 'Multiple QRPay' end,
    payment_verified_at=case when v_count=0 then null else coalesce(v_last_paid,payment_verified_at,now()) end,
    payment_verified_by=case when v_count=0 then null else coalesce(nullif(p_actor,''),payment_verified_by,'system') end,
    updated_at=now()
  where id=p_order_id;

  return jsonb_build_object(
    'order_id',p_order_id,
    'order_no',coalesce(v_order.order_no,v_order.order_id),
    'order_total',v_order.total,
    'linked_amount',round(v_paid,2),
    'payment_count',v_count,
    'payment_status',v_payment_status
  );
end;
$$;

create or replace function finance.reclassify_transaction_journal(
  p_transaction_id bigint,
  p_actor text default 'system'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_entry finance.journal_entries%rowtype;
  v_reversal_id bigint;
  v_new_entry_id bigint;
begin
  select * into v_entry
  from finance.journal_entries
  where transaction_id=p_transaction_id and status='posted'
  for update;

  if not found then
    v_new_entry_id:=finance.post_transaction(p_transaction_id,p_actor);
    return jsonb_build_object('reversal_entry_id',null,'new_entry_id',v_new_entry_id);
  end if;

  insert into finance.journal_entries(
    transaction_id,entry_date,description,status,source_type,source_reference,
    posted_at,posted_by,reversed_entry_id
  ) values(
    null,(now() at time zone 'Asia/Kuala_Lumpur')::date,
    'Reversal: '||v_entry.description,'posted','qrpay_match_correction',
    'reversal:'||v_entry.id::text,now(),p_actor,v_entry.id
  ) returning id into v_reversal_id;

  insert into finance.journal_lines(journal_entry_id,account_id,debit,credit,memo)
  select v_reversal_id,l.account_id,l.credit,l.debit,'Correction reversal: '||coalesce(l.memo,'')
  from finance.journal_lines l
  where l.journal_entry_id=v_entry.id;

  update finance.journal_entries
  set status='reversed',transaction_id=null
  where id=v_entry.id;

  v_new_entry_id:=finance.post_transaction(p_transaction_id,p_actor);
  return jsonb_build_object('reversal_entry_id',v_reversal_id,'new_entry_id',v_new_entry_id);
end;
$$;

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
  v_unmatched public.unmatched_payment_transactions%rowtype;
  v_matched public.payment_transactions%rowtype;
  v_job public.qrpay_ai_jobs%rowtype;
  v_transaction_id text:=nullif(btrim(coalesce(p_transaction_id,'')),'');
  v_query text:=nullif(btrim(coalesce(p_query,'')),'');
  v_query_phone text;
  v_phone text;
  v_amount numeric;
  v_paid_at timestamptz;
  v_provider text;
  v_sender_name text;
  v_current_order_id uuid;
  v_already_matched boolean:=false;
  v_rows jsonb;
  v_current jsonb;
begin
  if v_transaction_id is null then raise exception 'Transaction ID is required'; end if;

  select * into v_unmatched
  from public.unmatched_payment_transactions
  where transaction_id=v_transaction_id
  order by created_at desc limit 1;

  if found then
    v_amount:=v_unmatched.amount;
    v_paid_at:=coalesce(v_unmatched.paid_at,v_unmatched.created_at);
    v_provider:=v_unmatched.provider;
    v_sender_name:=v_unmatched.sender_name;
  else
    select * into v_matched
    from public.payment_transactions
    where transaction_id=v_transaction_id
    limit 1;
    if not found then
      return jsonb_build_object('transaction_id',v_transaction_id,'already_matched',false,'candidates','[]'::jsonb);
    end if;
    v_amount:=v_matched.amount;
    v_paid_at:=coalesce(v_matched.paid_at,v_matched.created_at);
    v_provider:=v_matched.provider;
    v_sender_name:=v_matched.sender_name;
    v_current_order_id:=v_matched.order_id;
    v_already_matched:=v_matched.order_id is not null;
  end if;

  select * into v_job from public.qrpay_ai_jobs where transaction_id=v_transaction_id limit 1;
  v_phone:=nullif(regexp_replace(coalesce(v_job.matched_phone,''),'[^0-9]','','g'),'');
  if v_phone is null then
    v_phone:=nullif(regexp_replace(coalesce(v_matched.raw_payload->>'matched_phone',v_unmatched.raw_payload->>'matched_phone',''),'[^0-9]','','g'),'');
  end if;
  v_query_phone:=nullif(regexp_replace(coalesce(v_query,''),'[^0-9]','','g'),'');

  if v_current_order_id is not null then
    select jsonb_build_object(
      'order_id',o.id,'order_no',coalesce(o.order_no,o.order_id),'total',o.total,
      'status',o.status,'admin_status',o.admin_status,'payment_status',o.payment_status,
      'source',o.source,
      'can_cancel_source',lower(coalesce(o.source,''))='qrpay_ai' and o.external_order_id='qrpay-ai:'||v_transaction_id,
      'item_count',(select count(*) from public.order_items x where x.order_id=o.id),
      'component_count',(select count(*) from public.production_components x where x.order_id=o.id),
      'clickup_count',(select count(*) from public.clickup_tasks x where x.order_id=o.id),
      'clickup_statuses',coalesce((select jsonb_agg(distinct coalesce(x.status,'-')) from public.clickup_tasks x where x.order_id=o.id),'[]'::jsonb),
      'shipment_count',(select count(*) from public.shipments x where x.order_id=o.id and x.archived_at is null),
      'shipment_statuses',coalesce((select jsonb_agg(distinct coalesce(x.status,x.normalized_status,'-')) from public.shipments x where x.order_id=o.id and x.archived_at is null),'[]'::jsonb),
      'requires_processed_confirmation',
        lower(coalesce(o.status,'')) in ('completed','cancelled','shipped','delivered')
        or lower(coalesce(o.admin_status,'')) like '%collected%'
        or exists(select 1 from public.clickup_tasks x where x.order_id=o.id)
        or exists(select 1 from public.shipments x where x.order_id=o.id and x.archived_at is null)
    ) into v_current
    from public.orders o where o.id=v_current_order_id;
  end if;

  with order_data as (
    select
      o.id,coalesce(o.order_no,o.order_id) order_no,coalesce(o.total,0) total,
      coalesce(o.delivery_fee,0) delivery_fee,o.created_at,o.payment_status,o.payment_transaction_id,
      coalesce(nullif(c.name,''),nullif(o.delivery_name,''),'Customer') customer_name,
      nullif(regexp_replace(coalesce(nullif(o.delivery_phone,''),c.phone,''),'[^0-9]','','g'),'') phone,
      coalesce((select sum(pt.amount) from public.payment_transactions pt where pt.order_id=o.id and pt.transaction_id<>v_transaction_id),0) linked_amount
    from public.orders o
    left join public.customers c on c.id=o.customer_id
    where o.id is distinct from v_current_order_id
  ), calculated as (
    select d.*,
      round(greatest(d.total-d.linked_amount,0),2) outstanding_before,
      round(d.linked_amount+v_amount,2) paid_after,
      round(greatest(d.total-(d.linked_amount+v_amount),0),2) remaining_after,
      round(greatest((d.linked_amount+v_amount)-d.total,0),2) overpaid_after
    from order_data d
  ), ranked as (
    select d.*,
      (d.phone is not null and v_phone is not null and d.phone=v_phone) phone_match,
      round(d.total-d.paid_after,2) amount_difference,
      case when d.overpaid_after>=0.01 then 'overpaid' when d.remaining_after>=0.01 then 'partial' else 'settled' end settlement_status,
      (case when v_query is not null and lower(d.order_no)=lower(v_query) then 300 else 0 end+
       case when v_query is not null and lower(d.order_no) like '%'||lower(v_query)||'%' then 120 else 0 end+
       case when d.phone is not null and v_phone is not null and d.phone=v_phone then 100 else 0 end+
       case when abs(d.outstanding_before-v_amount)<0.01 then 60 else 0 end+
       case when d.created_at between v_paid_at-interval '3 days' and v_paid_at+interval '14 days' then 20 else 0 end) score
    from calculated d
    where (v_query is null and v_phone is not null and d.phone=v_phone and d.created_at between v_paid_at-interval '30 days' and v_paid_at+interval '30 days')
       or (v_query is not null and (d.order_no ilike '%'||v_query||'%' or (v_query_phone is not null and d.phone like '%'||v_query_phone||'%') or d.customer_name ilike '%'||v_query||'%'))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id',id,'order_no',order_no,'total',total,'delivery_fee',delivery_fee,'created_at',created_at,
    'payment_status',payment_status,'payment_transaction_id',payment_transaction_id,'customer_name',customer_name,
    'phone',phone,'phone_match',phone_match,'linked_amount',linked_amount,'outstanding_before',outstanding_before,
    'paid_after',paid_after,'remaining_after',remaining_after,'overpaid_after',overpaid_after,
    'settlement_status',settlement_status,'amount_difference',amount_difference,
    'requires_confirmation',(not phone_match or overpaid_after>=0.01),'score',score,'can_match',true,'blocked_reason',null
  ) order by score desc,created_at desc),'[]'::jsonb)
  into v_rows from (select * from ranked order by score desc,created_at desc limit 10) x;

  return jsonb_build_object(
    'transaction',jsonb_build_object('transaction_id',v_transaction_id,'amount',v_amount,'paid_at',v_paid_at,
      'provider',v_provider,'phone',v_phone,'customer_name',coalesce(nullif(v_job.matched_customer_name,''),nullif(v_sender_name,''))),
    'already_matched',v_already_matched,
    'current_order',v_current,
    'candidates',v_rows
  );
end;
$$;

create or replace function public.finance_admin_correct_qrpay_match(
  p_transaction_id text,
  p_action text,
  p_target_order_no text default null,
  p_actor text default 'admin1',
  p_confirm_processed boolean default false,
  p_confirm_mismatch boolean default false,
  p_cancel_source boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_transaction_id text:=nullif(btrim(coalesce(p_transaction_id,'')),'');
  v_action text:=lower(nullif(btrim(coalesce(p_action,'')),''));
  v_target_order_no text:=nullif(btrim(coalesce(p_target_order_no,'')),'');
  v_actor text:=coalesce(nullif(btrim(coalesce(p_actor,'')),''),'admin1');
  v_payment public.payment_transactions%rowtype;
  v_source public.orders%rowtype;
  v_target public.orders%rowtype;
  v_job public.qrpay_ai_jobs%rowtype;
  v_unmatched_id uuid;
  v_finance_id bigint;
  v_old_classification_id bigint;
  v_sales_account_id bigint;
  v_unclassified_id bigint;
  v_source_result jsonb;
  v_target_result jsonb;
  v_journal_result jsonb;
  v_clickup_count integer:=0;
  v_shipment_count integer:=0;
  v_requires_processed boolean:=false;
  v_can_cancel_source boolean:=false;
  v_target_phone text;
  v_payment_phone text;
  v_target_linked numeric:=0;
  v_target_paid numeric:=0;
  v_target_overpaid numeric:=0;
  v_phone_match boolean:=false;
  v_requires_mismatch boolean:=false;
  v_cancelled boolean:=false;
  v_existing_unmatched public.unmatched_payment_transactions%rowtype;
begin
  if v_transaction_id is null then raise exception 'Transaction ID is required'; end if;
  if v_action not in ('unmatch','unmatch_create','relink') then raise exception 'Invalid correction action'; end if;

  perform pg_advisory_xact_lock(hashtextextended('qrpay-correction:'||v_transaction_id,0));

  select * into v_payment from public.payment_transactions where transaction_id=v_transaction_id for update;
  if not found then
    select * into v_existing_unmatched from public.unmatched_payment_transactions where transaction_id=v_transaction_id order by created_at desc limit 1;
    if found and v_action in ('unmatch','unmatch_create') then
      return jsonb_build_object('success',true,'duplicate',true,'action',v_action,'transaction_id',v_transaction_id,
        'amount',v_existing_unmatched.amount,'paid_at',coalesce(v_existing_unmatched.paid_at,v_existing_unmatched.created_at),
        'sender_name',v_existing_unmatched.sender_name,'phone',null);
    end if;
    raise exception 'QRPay transaction % is not linked to an order',v_transaction_id;
  end if;
  if v_payment.order_id is null then raise exception 'QRPay transaction % has no linked order',v_transaction_id; end if;

  if v_action='relink'
     and v_target_order_no is not null
     and v_payment.raw_payload->>'correction_action'='relink'
     and lower(coalesce(v_payment.raw_payload->>'target_order_no',''))=lower(v_target_order_no) then
    return jsonb_build_object(
      'success',true,'duplicate',true,'action','relink','transaction_id',v_transaction_id,
      'amount',v_payment.amount,'paid_at',coalesce(v_payment.paid_at,v_payment.created_at),
      'sender_name',v_payment.sender_name,'phone',v_payment.raw_payload->>'matched_phone',
      'source_order_no',v_payment.raw_payload->>'previous_order_no','target_order_no',v_target_order_no,
      'source_cancelled',coalesce((v_payment.raw_payload->>'source_cancelled')::boolean,false)
    );
  end if;

  select * into v_source from public.orders where id=v_payment.order_id for update;
  if not found then raise exception 'Source order was not found'; end if;
  select * into v_job from public.qrpay_ai_jobs where transaction_id=v_transaction_id limit 1 for update;
  v_payment_phone:=nullif(regexp_replace(coalesce(v_job.matched_phone,v_payment.raw_payload->>'matched_phone',''),'[^0-9]','','g'),'');

  select count(*)::integer into v_clickup_count from public.clickup_tasks where order_id=v_source.id;
  select count(*)::integer into v_shipment_count from public.shipments where order_id=v_source.id and archived_at is null;
  v_requires_processed:=lower(coalesce(v_source.status,'')) in ('completed','cancelled','shipped','delivered')
    or lower(coalesce(v_source.admin_status,'')) like '%collected%'
    or v_clickup_count>0 or v_shipment_count>0;
  v_can_cancel_source:=lower(coalesce(v_source.source,''))='qrpay_ai'
    and v_source.external_order_id='qrpay-ai:'||v_transaction_id;

  if p_cancel_source and not v_can_cancel_source then raise exception 'Only the QRPay auto-created source order can be cancelled'; end if;
  if v_requires_processed and not coalesce(p_confirm_processed,false) then
    return jsonb_build_object(
      'success',false,'requires_processed_confirmation',true,'transaction_id',v_transaction_id,
      'source_order_no',coalesce(v_source.order_no,v_source.order_id),'source_status',v_source.status,
      'source_admin_status',v_source.admin_status,'clickup_count',v_clickup_count,'shipment_count',v_shipment_count,
      'can_cancel_source',v_can_cancel_source
    );
  end if;

  select id into v_sales_account_id from finance.accounts where code='4000-SALES' limit 1;
  select id into v_unclassified_id from finance.accounts where code='4090-UNCLASS-IN' limit 1;
  select id,classification_account_id into v_finance_id,v_old_classification_id
  from finance.transactions
  where status<>'void' and (external_reference=v_transaction_id or bank_reference=v_transaction_id)
  order by id limit 1 for update;

  if v_action='relink' then
    if v_target_order_no is null then raise exception 'Target order is required'; end if;
    select * into v_target from public.orders
    where lower(coalesce(order_no,order_id))=lower(v_target_order_no)
    order by created_at desc limit 1 for update;
    if not found then raise exception 'Target order % was not found',v_target_order_no; end if;
    if v_target.id=v_source.id then raise exception 'Target order is already linked to this QRPay'; end if;

    select nullif(regexp_replace(coalesce(nullif(v_target.delivery_phone,''),c.phone,''),'[^0-9]','','g'),'')
    into v_target_phone from public.customers c where c.id=v_target.customer_id;
    if v_target_phone is null then v_target_phone:=nullif(regexp_replace(coalesce(v_target.delivery_phone,''),'[^0-9]','','g'),''); end if;
    select coalesce(sum(amount),0) into v_target_linked from public.payment_transactions where order_id=v_target.id and transaction_id<>v_transaction_id;
    v_target_paid:=round(v_target_linked+v_payment.amount,2);
    v_target_overpaid:=round(greatest(v_target_paid-coalesce(v_target.total,0),0),2);
    v_phone_match:=v_payment_phone is not null and v_target_phone is not null and v_payment_phone=v_target_phone;
    v_requires_mismatch:=not v_phone_match or v_target_overpaid>=0.01;
    if v_requires_mismatch and not coalesce(p_confirm_mismatch,false) then
      return jsonb_build_object(
        'success',false,'requires_mismatch_confirmation',true,'transaction_id',v_transaction_id,
        'target_order_no',coalesce(v_target.order_no,v_target.order_id),'payment_amount',v_payment.amount,
        'target_total',v_target.total,'target_linked_amount',v_target_linked,'target_paid_after',v_target_paid,
        'target_overpaid_after',v_target_overpaid,'phone_match',v_phone_match
      );
    end if;

    update public.payment_transactions set
      order_id=v_target.id,payment_session_id=null,
      raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object(
        'match_corrected',true,'correction_action','relink','correction_actor',v_actor,'correction_at',now(),
        'previous_order_id',v_source.id,'previous_order_no',coalesce(v_source.order_no,v_source.order_id),
        'target_order_id',v_target.id,'target_order_no',coalesce(v_target.order_no,v_target.order_id),
        'source_cancelled',p_cancel_source
      )
    where id=v_payment.id;

    if v_finance_id is not null then
      update finance.payment_allocations set status='reversed',reversed_at=now()
      where transaction_id=v_finance_id and order_id=v_source.id and status='allocated';
      insert into finance.payment_allocations(transaction_id,order_id,payment_session_id,amount,status,created_by)
      values(v_finance_id,v_target.id,null,v_payment.amount,'allocated',v_actor);
      update finance.transactions set
        order_id=v_target.id,status='posted',reconciliation_status='matched',classification_account_id=v_sales_account_id,
        description='QRPay relinked to '||coalesce(v_target.order_no,v_target.order_id),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'match_corrected',true,'correction_action','relink','correction_actor',v_actor,'correction_at',now(),
          'previous_order_id',v_source.id,'target_order_id',v_target.id
        ),updated_at=now()
      where id=v_finance_id;
      if v_old_classification_id is distinct from v_sales_account_id then
        v_journal_result:=finance.reclassify_transaction_journal(v_finance_id,v_actor);
      end if;
    end if;

    update public.qrpay_ai_jobs set
      order_id=v_target.id,order_no=coalesce(v_target.order_no,v_target.order_id),status='completed',
      match_reason='manual_admin_relink_order',completed_at=now(),locked_at=null,updated_at=now()
    where transaction_id=v_transaction_id;
    update public.admin_order_reviews set
      order_id=v_target.id,order_no=coalesce(v_target.order_no,v_target.order_id),status='created',
      evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
        'match_corrected',true,'correction_action','relink','actor',v_actor,
        'previous_order_id',v_source.id,'target_order_id',v_target.id
      ),updated_at=now()
    where transaction_id=v_transaction_id or qrpay_job_id=v_job.id;

    v_source_result:=finance.recalculate_order_payment(v_source.id,v_actor);
    v_target_result:=finance.recalculate_order_payment(v_target.id,v_actor);
  else
    select * into v_existing_unmatched
    from public.unmatched_payment_transactions
    where transaction_id=v_transaction_id order by created_at desc limit 1 for update;
    if found then
      v_unmatched_id:=v_existing_unmatched.id;
    else
      insert into public.unmatched_payment_transactions(
        provider,transaction_id,amount,paid_at,sender_name,raw_payload,raw,created_at
      ) values(
        coalesce(nullif(v_payment.provider,''),'duitnow'),v_transaction_id,v_payment.amount,
        coalesce(v_payment.paid_at,v_payment.created_at),v_payment.sender_name,
        coalesce(v_payment.raw_payload,'{}'::jsonb)||jsonb_build_object(
          'match_corrected',true,'correction_action',v_action,'correction_actor',v_actor,'correction_at',now(),
          'previous_order_id',v_source.id,'previous_order_no',coalesce(v_source.order_no,v_source.order_id),
          'reserved_for_create',v_action='unmatch_create'
        ),coalesce(v_payment.raw_payload,'{}'::jsonb),coalesce(v_payment.created_at,now())
      ) returning id into v_unmatched_id;
    end if;

    update public.qrpay_ai_jobs set
      unmatched_payment_id=v_unmatched_id,order_id=null,order_no=null,status='needs_review',
      match_reason=case when v_action='unmatch_create' then 'manual_unmatched_reserved_for_new_order' else 'manual_admin_unmatch' end,
      completed_at=null,locked_at=null,updated_at=now()
    where transaction_id=v_transaction_id;
    update public.admin_order_reviews set
      order_id=null,order_no=null,status='pending_admin',approved_at=null,completed_at=null,
      evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
        'match_corrected',true,'correction_action',v_action,'actor',v_actor,
        'previous_order_id',v_source.id,'previous_order_no',coalesce(v_source.order_no,v_source.order_id)
      ),updated_at=now()
    where transaction_id=v_transaction_id or qrpay_job_id=v_job.id;

    if v_finance_id is not null then
      update finance.payment_allocations set status='reversed',reversed_at=now()
      where transaction_id=v_finance_id and order_id=v_source.id and status='allocated';
      update finance.transactions set
        order_id=null,status='posted',reconciliation_status='unmatched',classification_account_id=v_unclassified_id,
        description='QRPay awaiting order: '||v_transaction_id,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'match_corrected',true,'correction_action',v_action,'correction_actor',v_actor,'correction_at',now(),
          'previous_order_id',v_source.id,'previous_order_no',coalesce(v_source.order_no,v_source.order_id)
        ),updated_at=now()
      where id=v_finance_id;
      v_journal_result:=finance.reclassify_transaction_journal(v_finance_id,v_actor);
      insert into finance.reconciliation_cases(case_type,status,primary_transaction_id,reason,details)
      values('unmatched_payment','open',v_finance_id,'QRPay manually unmatched from order',jsonb_build_object(
        'transaction_id',v_transaction_id,'previous_order_id',v_source.id,'actor',v_actor,'action',v_action
      ));
    end if;

    delete from public.payment_transactions where id=v_payment.id;
    v_source_result:=finance.recalculate_order_payment(v_source.id,v_actor);
  end if;

  if p_cancel_source then
    update public.orders set
      status='Cancelled',admin_status='Cancelled - Wrong QRPay Match',tab='completed',
      admin_remark=concat_ws(E'\n',nullif(admin_remark,''),
        '[QRPay MATCH CORRECTED] '||v_transaction_id||' unlinked by '||v_actor||' at '||to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI:SS')||' MYT. ClickUp/items retained for audit.'),
      updated_at=now()
    where id=v_source.id;
    v_cancelled:=true;
  end if;

  if v_finance_id is not null then
    insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data)
    values(v_actor,'correct_qrpay_match','transaction',v_finance_id::text,
      jsonb_build_object('transaction_id',v_transaction_id,'source_order_id',v_source.id,'source_order_no',coalesce(v_source.order_no,v_source.order_id)),
      jsonb_build_object('action',v_action,'target_order_id',v_target.id,'target_order_no',coalesce(v_target.order_no,v_target.order_id),
        'source_cancelled',v_cancelled,'journal',v_journal_result));
  end if;
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(v_source.id::text,coalesce(v_source.order_no,v_source.order_id),'correct_qrpay_match',v_actor,jsonb_build_object(
    'transaction_id',v_transaction_id,'action',v_action,'payment_id',v_payment.id,'payment_amount',v_payment.amount,
    'source_order_id',v_source.id,'source_order_no',coalesce(v_source.order_no,v_source.order_id),
    'target_order_id',v_target.id,'target_order_no',coalesce(v_target.order_no,v_target.order_id),
    'source_cancelled',v_cancelled,'clickup_count',v_clickup_count,'shipment_count',v_shipment_count,
    'finance_transaction_id',v_finance_id
  ));

  return jsonb_build_object(
    'success',true,'duplicate',false,'action',v_action,'transaction_id',v_transaction_id,
    'amount',v_payment.amount,'paid_at',coalesce(v_payment.paid_at,v_payment.created_at),
    'sender_name',v_payment.sender_name,'phone',v_payment_phone,
    'source_order_no',coalesce(v_source.order_no,v_source.order_id),
    'target_order_no',coalesce(v_target.order_no,v_target.order_id),'source_cancelled',v_cancelled,
    'source_payment',v_source_result,'target_payment',v_target_result,
    'unmatched_payment_id',v_unmatched_id,'finance_transaction_id',v_finance_id,'journal',v_journal_result
  );
end;
$$;

revoke execute on function finance.recalculate_order_payment(uuid,text) from public,anon,authenticated;
revoke execute on function finance.reclassify_transaction_journal(bigint,text) from public,anon,authenticated;
revoke execute on function public.finance_admin_qrpay_match_candidates(text,text) from public,anon,authenticated;
revoke execute on function public.finance_admin_correct_qrpay_match(text,text,text,text,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function finance.recalculate_order_payment(uuid,text) to service_role;
grant execute on function finance.reclassify_transaction_journal(bigint,text) to service_role;
grant execute on function public.finance_admin_qrpay_match_candidates(text,text) to service_role;
grant execute on function public.finance_admin_correct_qrpay_match(text,text,text,text,boolean,boolean,boolean) to service_role;

comment on function public.finance_admin_correct_qrpay_match(text,text,text,text,boolean,boolean,boolean)
is 'Owner-only atomic QRPay unmatch, new-order reservation, or relink with order/ledger recalculation and audit history.';
