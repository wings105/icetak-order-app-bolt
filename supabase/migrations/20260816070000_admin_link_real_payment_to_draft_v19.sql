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

  select coalesce(nullif(regexp_replace(coalesce(j.matched_phone,''),'[^0-9]','','g'),''),v_phone),
         coalesce(nullif(j.matched_customer_name,''),nullif(v_sender_name,''))
  into v_phone,v_customer_name
  from public.qrpay_ai_jobs j
  where j.transaction_id=v_tx
  order by j.created_at desc
  limit 1;

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
      case
        when x.session_amount_match then 0::numeric
        else round(coalesce(x.draft_total,0)-v_amount,2)
      end amount_difference,
      (x.session_amount_match or x.total_amount_match) amount_match,
      (case when x.normalized_phone is not null and v_phone is not null and x.normalized_phone=v_phone then 150 else 0 end+
       case when x.session_amount_match then 120 when x.total_amount_match then 100 else 0 end+
       case when x.customer_confirmed_at is not null then 30 else 0 end+
       case when x.status='awaiting_payment' then 25 else 0 end+
       case when x.created_at between coalesce(v_paid_at,now())-interval '3 days' and coalesce(v_paid_at,now())+interval '1 day' then 20 else 0 end+
       case when v_query is not null and (x.id::text ilike '%'||v_query||'%' or x.review_token ilike '%'||v_query||'%' or coalesce(x.customer_name,'') ilike '%'||v_query||'%') then 200 else 0 end) score
    from draft_data x
    where
      (v_query is null and (
        (x.normalized_phone is not null and v_phone is not null and x.normalized_phone=v_phone)
        or x.session_amount_match or x.total_amount_match
      ))
      or
      (v_query is not null and (
        x.id::text ilike '%'||v_query||'%'
        or x.review_token ilike '%'||v_query||'%'
        or coalesce(x.customer_name,'') ilike '%'||v_query||'%'
        or (v_query_phone is not null and x.normalized_phone like '%'||v_query_phone||'%')
      ))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id','draft:'||id::text,
    'order_no','DRAFT:'||id::text,
    'total',draft_total,
    'delivery_fee',shipping_fee,
    'created_at',created_at,
    'payment_status',payment_status,
    'payment_transaction_id',transaction_id,
    'customer_name','🧾 DRAFT · '||coalesce(nullif(customer_name,''),'Customer'),
    'phone',customer_phone,
    'phone_match',phone_match,
    'linked_amount',0,
    'outstanding_before',draft_total,
    'paid_after',case when amount_match then draft_total else v_amount end,
    'remaining_after',case when amount_match then 0 else greatest(coalesce(draft_total,0)-v_amount,0) end,
    'overpaid_after',case when amount_match then 0 else greatest(v_amount-coalesce(draft_total,0),0) end,
    'settlement_status',case when amount_match then 'settled' when v_amount<coalesce(draft_total,0) then 'partial' else 'overpaid' end,
    'requires_confirmation',not coalesce(phone_match,false),
    'amount_difference',amount_difference,
    'score',score,
    'can_match',amount_match,
    'blocked_reason',case when amount_match then null else 'Payment amount tidak sama dengan draft / payment session' end,
    'candidate_kind','draft',
    'draft_id',id,
    'review_token',review_token,
    'customer_review_token',customer_review_token,
    'draft_status',status,
    'customer_status',customer_status,
    'customer_confirmed',customer_confirmed_at is not null,
    'date_need',date_need,
    'delivery',delivery
  ) order by score desc,created_at desc),'[]'::jsonb)
  into v_rows
  from (select * from ranked order by score desc,created_at desc limit 10) z;

  return jsonb_build_object(
    'transaction',jsonb_build_object('transaction_id',v_tx,'amount',v_amount,'paid_at',v_paid_at,'provider',v_provider,'phone',v_phone,'customer_name',v_customer_name),
    'candidates',v_rows
  );
end
$$;

create or replace function public.icetak_admin_link_payment_to_draft(
  p_transaction_id text,
  p_draft_id uuid,
  p_actor text default 'admin1',
  p_confirm_mismatch boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_tx text:=nullif(btrim(coalesce(p_transaction_id,'')),'');
  d public.qrpay_order_drafts%rowtype;
  pt public.payment_transactions%rowtype;
  up public.unmatched_payment_transactions%rowtype;
  oldps public.payment_sessions%rowtype;
  v_sid uuid;
  v_amount numeric;
  v_paid_at timestamptz;
  v_provider text;
  v_sender text;
  v_raw jsonb:='{}'::jsonb;
  v_payment_phone text;
  v_draft_phone text;
  v_session_amount_match boolean:=false;
  v_total_amount_match boolean:=false;
  v_address_ok boolean:=false;
  v_ready boolean:=false;
  v_waiting jsonb:='[]'::jsonb;
  v_result jsonb:='{}'::jsonb;
  v_order_id uuid;
  v_order_no text;
  v_delivery text;
  c jsonb;
begin
  if v_tx is null then raise exception 'Transaction ID is required'; end if;
  if p_draft_id is null then raise exception 'Draft ID is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended('admin-payment-link:'||v_tx,0));

  select * into pt from public.payment_transactions where transaction_id=v_tx for update;
  if found then
    if pt.order_id is not null then
      raise exception 'Payment already linked to a real order';
    end if;
    v_amount:=pt.amount; v_paid_at:=coalesce(pt.paid_at,pt.created_at); v_provider:=pt.provider; v_sender:=pt.sender_name; v_raw:=coalesce(pt.raw_payload,'{}'::jsonb);
  else
    select * into up from public.unmatched_payment_transactions where transaction_id=v_tx order by created_at desc limit 1 for update;
    if not found then raise exception 'Payment transaction not found'; end if;
    v_amount:=up.amount; v_paid_at:=coalesce(up.paid_at,up.created_at); v_provider:=up.provider; v_sender:=up.sender_name; v_raw:=coalesce(up.raw_payload,coalesce(up.raw,'{}'::jsonb),'{}'::jsonb);
  end if;

  select * into d from public.qrpay_order_drafts where id=p_draft_id for update;
  if not found then raise exception 'Draft not found'; end if;
  if d.order_id is not null then raise exception 'Draft already converted to order %',coalesce(d.order_no,d.order_id::text); end if;
  if d.status='rejected' then raise exception 'Rejected draft cannot receive payment'; end if;
  if coalesce(d.payment_required,false)=false then raise exception 'Draft does not require online payment'; end if;
  if coalesce(d.payment_mode,'') in ('cash_counter','cash_at_counter') then raise exception 'Cash pickup draft cannot use QRPay link'; end if;

  select exists(select 1 from public.payment_sessions ps where ps.draft_id=d.id and abs(coalesce(ps.expected_amount,0)-v_amount)<0.01)
  into v_session_amount_match;
  v_total_amount_match:=abs(coalesce(d.draft_total,0)-coalesce(v_amount,0))<0.01;
  if not (v_session_amount_match or v_total_amount_match) then
    raise exception 'Payment amount RM% does not match draft total RM%',to_char(v_amount,'FM999999990.00'),to_char(d.draft_total,'FM999999990.00');
  end if;

  select nullif(regexp_replace(coalesce(j.matched_phone,''),'[^0-9]','','g'),'')
  into v_payment_phone
  from public.qrpay_ai_jobs j where j.transaction_id=v_tx order by j.created_at desc limit 1;
  v_payment_phone:=coalesce(v_payment_phone,nullif(regexp_replace(coalesce(v_raw->>'matched_phone',v_raw->>'phone',''),'[^0-9]','','g'),''));
  v_draft_phone:=nullif(regexp_replace(coalesce(d.customer_phone,''),'[^0-9]','','g'),'');
  if v_payment_phone is not null and v_draft_phone is not null and v_payment_phone<>v_draft_phone and not p_confirm_mismatch then
    raise exception 'Customer phone does not match. Confirm mismatch to continue.';
  end if;

  if pt.payment_session_id is not null then
    select * into oldps from public.payment_sessions where id=pt.payment_session_id for update;
    if found and oldps.order_id is not null then raise exception 'Existing payment session already belongs to an order'; end if;
    if found and oldps.draft_id is not null and oldps.draft_id<>d.id then
      update public.payment_sessions set status='superseded',transaction_id=null where id=oldps.id;
    elsif found and oldps.draft_id=d.id then
      v_sid:=oldps.id;
    end if;
  end if;

  if v_sid is null then
    select ps.id into v_sid
    from public.payment_sessions ps
    where ps.draft_id=d.id
      and abs(coalesce(ps.expected_amount,0)-v_amount)<0.01
      and (ps.transaction_id is null or ps.transaction_id=v_tx)
    order by ps.created_at desc
    limit 1
    for update;
  end if;

  if v_sid is null then
    insert into public.payment_sessions(
      draft_id,purpose,base_amount,expected_amount,discount,amount_offset_cents,reservation_grace_seconds,status,expires_at,order_token,transaction_id,matched_at
    ) values(
      d.id,'admin_payment_link',d.draft_total,v_amount,round(coalesce(d.draft_total,0)-v_amount,2),
      greatest(0,round((coalesce(d.draft_total,0)-v_amount)*100)::int),120,'matched',now(),d.customer_review_token,v_tx,now()
    ) returning id into v_sid;
  else
    update public.payment_sessions
    set status='matched',transaction_id=v_tx,matched_at=coalesce(matched_at,now()),draft_id=d.id,order_id=null
    where id=v_sid;
  end if;

  if pt.id is null then
    insert into public.payment_transactions(order_id,payment_session_id,provider,transaction_id,amount,paid_at,sender_name,raw_payload)
    values(null,v_sid,coalesce(v_provider,'duitnow'),v_tx,v_amount,v_paid_at,coalesce(v_sender,''),
      v_raw||jsonb_build_object('draft_id',d.id,'admin_linked_draft',true,'linked_by',p_actor))
    returning * into pt;
  else
    update public.payment_transactions
    set payment_session_id=v_sid,
        raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object('draft_id',d.id,'admin_linked_draft',true,'linked_by',p_actor,'linked_at',now())
    where id=pt.id
    returning * into pt;
  end if;

  delete from public.unmatched_payment_transactions where transaction_id=v_tx;

  update public.qrpay_order_drafts
  set payment_session_id=v_sid,
      transaction_id=v_tx,
      provider=coalesce(v_provider,provider,'duitnow'),
      payment_amount=v_amount,
      payment_received_at=v_paid_at,
      payment_snapshot=coalesce(payment_snapshot,'{}'::jsonb)||v_raw||jsonb_build_object('admin_linked_draft',true,'linked_by',p_actor),
      payment_status='paid',
      payment_difference=round(coalesce(draft_total,0)-v_amount,2),
      status=case when customer_confirmed_at is not null then 'paid' else status end,
      updated_at=now(),version=version+1,last_error=null
  where id=d.id
  returning * into d;

  update public.order_sessions set status=case when d.customer_confirmed_at is not null then 'paid' else status end,updated_at=now()
  where id=d.order_session_id;

  update public.qrpay_order_drafts
  set status='rejected',rejected_at=coalesce(rejected_at,now()),rejected_by='admin-payment-link',
      last_error='duplicate_transaction_linked_to_draft:'||d.id::text,updated_at=now(),version=version+1
  where transaction_id=v_tx and id<>d.id and order_id is null and source_type='qrpay_payment' and status not in ('confirmed','rejected');

  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data,metadata)
  values(d.id,'admin_linked_real_payment',coalesce(nullif(p_actor,''),'admin1'),d.working_draft,d.working_draft,
    jsonb_build_object('transaction_id',v_tx,'amount',v_amount,'payment_session_id',v_sid,'provider',v_provider,'payment_phone',v_payment_phone,'draft_phone',v_draft_phone));

  c:=coalesce(d.working_draft->'customer','{}'::jsonb);
  v_delivery:=lower(coalesce(d.working_draft->>'delivery',''));
  v_address_ok:=v_delivery='pickup' or (
    length(regexp_replace(coalesce(c->>'address_line1',''),'[^[:alnum:]]','','g'))>=3
    and coalesce(c->>'postcode','') ~ '^\d{5}$'
    and length(regexp_replace(coalesce(c->>'city',''),'[^[:alnum:]]','','g'))>=2
    and length(regexp_replace(coalesce(c->>'state',''),'[^[:alnum:]]','','g'))>=2
  );

  if d.admin_approved_at is null then v_waiting:=v_waiting||jsonb_build_array('admin_approval'); end if;
  if d.customer_confirmed_at is null then v_waiting:=v_waiting||jsonb_build_array('customer_confirmation'); end if;
  if not v_address_ok then v_waiting:=v_waiting||jsonb_build_array('address'); end if;
  v_ready:=jsonb_array_length(v_waiting)=0;

  if v_ready then
    v_result:=public.icetak_finalize_generic_order_draft(d.id,'admin-payment-link:'||coalesce(nullif(p_actor,''),'admin1'));
    v_order_id:=nullif(v_result->>'order_db_id','')::uuid;
    if v_order_id is null then select order_id into v_order_id from public.qrpay_order_drafts where id=d.id; end if;
    if v_order_id is null then raise exception 'Order creation failed after payment link'; end if;
    select coalesce(order_no,order_id) into v_order_no from public.orders where id=v_order_id;

    update public.payment_sessions set order_id=v_order_id,status='matched',transaction_id=v_tx,matched_at=coalesce(matched_at,now()) where id=v_sid;
    update public.payment_transactions set order_id=v_order_id,payment_session_id=v_sid where transaction_id=v_tx;
    update public.orders
    set payment='Paid',payment_status='paid',payment_method=case when lower(coalesce(v_provider,'')) like '%duit%' then 'QR Pay / DuitNow' else 'QR Pay' end,
        payment_transaction_id=v_tx,payment_verified_at=coalesce(payment_verified_at,now()),payment_verified_by=coalesce(nullif(p_actor,''),'admin1'),updated_at=now()
    where id=v_order_id;
    update public.payment_order_attention_alerts set status='resolved',resolved_at=coalesce(resolved_at,now()),locked_at=null,updated_at=now()
    where transaction_id=v_tx and status<>'resolved';

    insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
    values(v_order_id::text,v_order_no,'link_real_payment_to_draft',coalesce(nullif(p_actor,''),'admin1'),
      jsonb_build_object('draft_id',d.id,'transaction_id',v_tx,'amount',v_amount,'payment_session_id',v_sid));

    return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
      'success',true,'linked',true,'finalized',true,'draft_id',d.id,'transaction_id',v_tx,'payment_session_id',v_sid,
      'order_db_id',v_order_id,'order_no',v_order_no,'order_id',v_order_no,'payment_status','paid','waiting_for','[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'success',true,'linked',true,'finalized',false,'draft_id',d.id,'review_token',d.review_token,'customer_review_token',d.customer_review_token,
    'transaction_id',v_tx,'amount',v_amount,'payment_session_id',v_sid,'payment_status','paid','waiting_for',v_waiting
  );
end
$$;

revoke all on function public.finance_admin_qrpay_draft_candidates(text,text) from public,anon,authenticated;
revoke all on function public.icetak_admin_link_payment_to_draft(text,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.finance_admin_qrpay_draft_candidates(text,text) to service_role;
grant execute on function public.icetak_admin_link_payment_to_draft(text,uuid,text,boolean) to service_role;
