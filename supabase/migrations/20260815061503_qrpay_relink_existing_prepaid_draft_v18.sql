-- QRPay V18: when an unmatched payment has already been matched by the AI worker
-- to one customer, prefer one exact existing prepaid chat draft (same phone + amount)
-- instead of creating a second QRPay draft. Also finalize an already-paid draft when
-- the customer later confirms a valid address.

create or replace function public.icetak_try_attach_qrpay_job_to_existing_draft(
  p_job_id uuid,
  p_internal_token text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_expected text;
  v_job public.qrpay_ai_jobs%rowtype;
  v_unmatched public.unmatched_payment_transactions%rowtype;
  v_candidate public.qrpay_order_drafts%rowtype;
  v_candidate_id uuid;
  v_candidate_count integer := 0;
  v_phone text;
  v_sid uuid;
  v_paid_at timestamptz;
  v_payload jsonb;
  v_existing_order uuid;
begin
  select setting_value into v_expected
  from public.private_runtime_settings
  where setting_key='qrpay_ai_worker_token';

  if v_expected is null or p_internal_token is distinct from v_expected then
    raise exception 'Unauthorized qrpay AI worker';
  end if;

  select * into v_job
  from public.qrpay_ai_jobs
  where id=p_job_id
  for update;
  if not found then raise exception 'qrpay_ai_job_not_found'; end if;

  select pt.order_id into v_existing_order
  from public.payment_transactions pt
  where pt.transaction_id=v_job.transaction_id and pt.order_id is not null
  limit 1;
  if v_existing_order is not null then
    return jsonb_build_object('success',true,'attached',false,'reason','transaction_already_has_order','order_id',v_existing_order);
  end if;

  if v_job.unmatched_payment_id is not null then
    select * into v_unmatched
    from public.unmatched_payment_transactions
    where id=v_job.unmatched_payment_id
    for update;
  end if;
  if v_unmatched.id is null then
    select * into v_unmatched
    from public.unmatched_payment_transactions
    where transaction_id=v_job.transaction_id
    order by created_at desc limit 1 for update;
  end if;

  v_phone:=public.icetak_normalize_phone(coalesce(v_job.matched_phone,''));
  if nullif(v_phone,'') is null then
    return jsonb_build_object('success',true,'attached',false,'reason','matched_phone_missing');
  end if;
  v_paid_at:=coalesce(v_unmatched.paid_at,v_job.payment_received_at,now());

  select count(*), (array_agg(d.id order by d.updated_at desc,d.created_at desc))[1]
  into v_candidate_count,v_candidate_id
  from public.qrpay_order_drafts d
  where d.order_id is null
    and d.source_type='chat_trigger'
    and d.payment_mode='prepaid'
    and coalesce(d.payment_required,false)=true
    and coalesce(d.payment_status,'unpaid') in ('unpaid','pending','awaiting_payment')
    and d.admin_approved_at is not null
    and d.status in ('ready_customer','customer_confirmed')
    and public.icetak_normalize_phone(d.customer_phone)=v_phone
    and abs(coalesce(d.draft_total,0)-coalesce(v_job.amount,0)) < 0.01
    and d.created_at >= v_paid_at - interval '24 hours'
    and d.created_at <= v_paid_at + interval '30 minutes';

  if v_candidate_count<>1 or v_candidate_id is null then
    return jsonb_build_object(
      'success',true,'attached',false,
      'reason',case when v_candidate_count=0 then 'no_exact_existing_draft' else 'ambiguous_existing_draft' end,
      'candidate_count',v_candidate_count,'matched_phone',v_phone,'amount',v_job.amount
    );
  end if;

  select * into v_candidate
  from public.qrpay_order_drafts
  where id=v_candidate_id
  for update;

  select ps.id into v_sid
  from public.payment_sessions ps
  where ps.draft_id=v_candidate.id and abs(ps.expected_amount-v_job.amount)<0.01
  order by ps.created_at desc limit 1 for update;
  if v_sid is not null then
    update public.payment_sessions
    set status='matched',transaction_id=v_job.transaction_id,matched_at=now()
    where id=v_sid;
  end if;

  v_payload:=coalesce(v_unmatched.raw_payload,'{}'::jsonb)
    || jsonb_build_object(
      'provider',coalesce(v_unmatched.provider,v_job.provider,'duitnow'),
      'transaction_id',v_job.transaction_id,'amount',v_job.amount,'paid_at',v_paid_at,
      'sender_name',coalesce(v_unmatched.sender_name,''),
      '_match_reason','existing_draft_exact_phone_amount',
      'matched_phone',v_phone,'matched_conversation_id',v_job.matched_conversation_id,
      'match_score',v_job.match_score,'match_reason',v_job.match_reason
    );

  insert into public.payment_transactions(
    order_id,payment_session_id,provider,transaction_id,amount,paid_at,sender_name,raw_payload
  ) values(
    null,v_sid,coalesce(v_unmatched.provider,v_job.provider,'duitnow'),v_job.transaction_id,
    v_job.amount,v_paid_at,coalesce(v_unmatched.sender_name,''),
    v_payload||jsonb_build_object('draft_id',v_candidate.id,'relinked_existing_draft',true)
  )
  on conflict(transaction_id) do update
  set payment_session_id=coalesce(excluded.payment_session_id,public.payment_transactions.payment_session_id),
      provider=excluded.provider,amount=excluded.amount,paid_at=excluded.paid_at,
      sender_name=excluded.sender_name,
      raw_payload=coalesce(public.payment_transactions.raw_payload,'{}'::jsonb)||excluded.raw_payload;

  update public.qrpay_order_drafts
  set qrpay_job_id=v_job.id,
      unmatched_payment_id=v_unmatched.id,
      payment_session_id=coalesce(v_sid,payment_session_id),
      transaction_id=v_job.transaction_id,
      provider=coalesce(v_unmatched.provider,v_job.provider,provider,'duitnow'),
      payment_amount=v_job.amount,payment_received_at=v_paid_at,
      payment_snapshot=coalesce(payment_snapshot,'{}'::jsonb)||v_payload,
      payment_status='paid',payment_difference=round(coalesce(draft_total,0)-v_job.amount,2),
      status=case when customer_confirmed_at is not null then 'paid' else status end,
      updated_at=now(),version=version+1,last_error=null
  where id=v_candidate.id;

  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data,metadata)
  values(
    v_candidate.id,'payment_relinked_existing_draft','qrpay-ai-worker',v_candidate.working_draft,v_candidate.working_draft,
    jsonb_build_object('transaction_id',v_job.transaction_id,'amount',v_job.amount,'payment_session_id',v_sid,
      'qrpay_job_id',v_job.id,'matched_phone',v_phone,'match_score',v_job.match_score)
  );

  update public.qrpay_order_drafts
  set status='rejected',rejected_at=coalesce(rejected_at,now()),rejected_by='system-existing-draft-relink',
      last_error='duplicate_payment_relinked_to_draft:'||v_candidate.id::text,updated_at=now(),version=version+1
  where transaction_id=v_job.transaction_id and id<>v_candidate.id and order_id is null
    and source_type='qrpay_payment' and status not in ('confirmed','rejected');

  update public.admin_order_reviews
  set status='rejected',rejected_at=coalesce(rejected_at,now()),completed_at=coalesce(completed_at,now()),
      last_error='duplicate_payment_relinked_to_existing_draft:'||v_candidate.id::text,updated_at=now()
  where transaction_id=v_job.transaction_id
    and coalesce(order_id,'00000000-0000-0000-0000-000000000000'::uuid)='00000000-0000-0000-0000-000000000000'::uuid;

  update public.qrpay_ai_jobs
  set status='completed',completed_at=now(),locked_at=null,extraction=v_candidate.working_draft,
      evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
        'existing_draft_relinked',true,'existing_draft_id',v_candidate.id,'transaction_id',v_job.transaction_id),
      updated_at=now(),last_error=null
  where id=v_job.id;

  if v_unmatched.id is not null then
    delete from public.unmatched_payment_transactions where id=v_unmatched.id;
  end if;

  return jsonb_build_object(
    'success',true,'attached',true,'draft_id',v_candidate.id,'review_token',v_candidate.review_token,
    'customer_review_token',v_candidate.customer_review_token,'transaction_id',v_job.transaction_id,
    'amount',v_job.amount,'matched_phone',v_phone,'payment_session_id',v_sid,'payment_status','paid'
  );
end;
$$;

revoke all on function public.icetak_try_attach_qrpay_job_to_existing_draft(uuid,text) from public,anon,authenticated;
grant execute on function public.icetak_try_attach_qrpay_job_to_existing_draft(uuid,text) to service_role;

alter function public.icetak_create_or_update_qrpay_draft(uuid,jsonb,text)
  rename to icetak_create_or_update_qrpay_draft_legacy_v17;

create function public.icetak_create_or_update_qrpay_draft(
  p_job_id uuid,p_payload jsonb,p_internal_token text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_attach jsonb;
begin
  v_attach:=public.icetak_try_attach_qrpay_job_to_existing_draft(p_job_id,p_internal_token);
  if coalesce((v_attach->>'attached')::boolean,false) then return v_attach; end if;
  return public.icetak_create_or_update_qrpay_draft_legacy_v17(p_job_id,p_payload,p_internal_token);
end;
$$;
revoke all on function public.icetak_create_or_update_qrpay_draft(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_create_or_update_qrpay_draft(uuid,jsonb,text) to service_role;

alter function public.icetak_customer_confirm_draft(text,jsonb,text)
  rename to icetak_customer_confirm_draft_legacy_v17;

create function public.icetak_customer_confirm_draft(
  p_customer_token text,p_customer jsonb default '{}'::jsonb,p_actor text default 'customer-link'::text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_result jsonb;
  d public.qrpay_order_drafts%rowtype;
  v_final jsonb;
  v_order_id uuid;
  v_order_no text;
begin
  v_result:=public.icetak_customer_confirm_draft_legacy_v17(p_customer_token,p_customer,p_actor);
  select * into d from public.qrpay_order_drafts where customer_review_token=p_customer_token for update;

  if found and d.order_id is null and d.admin_approved_at is not null and d.customer_confirmed_at is not null
     and coalesce(d.payment_required,false)=true and d.payment_status='paid' then
    v_final:=public.icetak_finalize_generic_order_draft(d.id,p_actor);
    v_order_id:=nullif(v_final->>'order_db_id','')::uuid;
    v_order_no:=v_final->>'order_id';

    if v_order_id is not null and nullif(d.transaction_id,'') is not null then
      update public.payment_transactions set order_id=v_order_id
      where transaction_id=d.transaction_id and order_id is null;
      update public.orders
      set payment_method='Draft Checkout QR Pay',payment_transaction_id=d.transaction_id,
          payment_verified_at=coalesce(payment_verified_at,now()),
          payment_verified_by=coalesce(nullif(d.provider,''),'payment_webhook'),
          payment_status='paid',payment='Paid',updated_at=now()
      where id=v_order_id;
    end if;

    if d.qrpay_job_id is not null then
      update public.qrpay_ai_jobs
      set order_id=v_order_id,order_no=coalesce(v_order_no,order_no),status='completed',
          completed_at=coalesce(completed_at,now()),updated_at=now(),last_error=null
      where id=d.qrpay_job_id;
    end if;

    return v_result||jsonb_build_object('success',true,'payment_required',false,'already_paid',true,'order',v_final,'order_id',v_order_no);
  end if;
  return v_result;
end;
$$;
revoke all on function public.icetak_customer_confirm_draft(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_customer_confirm_draft(text,jsonb,text) to service_role;
