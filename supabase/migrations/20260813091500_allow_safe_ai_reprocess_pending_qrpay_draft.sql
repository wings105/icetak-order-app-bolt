create or replace function public.icetak_create_or_update_qrpay_draft(p_job_id uuid, p_payload jsonb, p_internal_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_expected text;
  v_job public.qrpay_ai_jobs%rowtype;
  v_unmatched public.unmatched_payment_transactions%rowtype;
  v_existing public.qrpay_order_drafts%rowtype;
  v_draft public.qrpay_order_drafts%rowtype;
  v_totals jsonb;
  v_work jsonb;
  v_review_id uuid;
  v_worker_version text;
  v_event_type text;
  v_human_touched boolean := false;
begin
  select setting_value into v_expected from public.private_runtime_settings where setting_key='qrpay_ai_worker_token';
  if v_expected is null or p_internal_token is distinct from v_expected then raise exception 'Unauthorized qrpay AI worker'; end if;
  select * into v_job from public.qrpay_ai_jobs where id=p_job_id for update;
  if not found then raise exception 'qrpay_ai_job_not_found'; end if;
  if v_job.order_id is not null then return jsonb_build_object('success',true,'duplicate',true,'reason','job_already_has_order','order_db_id',v_job.order_id,'order_id',v_job.order_no); end if;

  if v_job.unmatched_payment_id is not null then select * into v_unmatched from public.unmatched_payment_transactions where id=v_job.unmatched_payment_id; end if;
  if v_unmatched.id is null then select * into v_unmatched from public.unmatched_payment_transactions where transaction_id=v_job.transaction_id order by created_at desc limit 1; end if;
  if jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then raise exception 'AI extracted no order items'; end if;

  v_totals:=public.icetak_qrpay_draft_totals(p_payload);
  v_work:=coalesce(p_payload,'{}'::jsonb)||jsonb_build_object(
    'payment_amount',v_job.amount,'total',(v_totals->>'draft_total')::numeric,'draft_total',(v_totals->>'draft_total')::numeric,
    'delivery_fee',(v_totals->>'shipping_fee')::numeric,'transaction_id',v_job.transaction_id,'payment_received_at',v_job.payment_received_at
  );
  v_worker_version:=coalesce(p_payload#>>'{evidence,worker_version}',p_payload#>>'{evidence,extractor}','qrpay-ai-draft-v1');

  select * into v_existing from public.qrpay_order_drafts where transaction_id=v_job.transaction_id for update;
  if found then
    select exists(
      select 1 from public.qrpay_order_draft_events e
      where e.draft_id=v_existing.id
        and coalesce(e.actor,'') not in ('qrpay-ai-worker','system')
    ) into v_human_touched;

    if v_existing.status not in ('needs_rematch','pending_admin') then
      return jsonb_build_object('success',true,'duplicate',true,'draft_id',v_existing.id,'review_token',v_existing.review_token,'status',v_existing.status,'transaction_id',v_existing.transaction_id,'reason','draft_locked_by_status');
    end if;
    if v_existing.status='pending_admin' and v_human_touched then
      return jsonb_build_object('success',true,'duplicate',true,'draft_id',v_existing.id,'review_token',v_existing.review_token,'status',v_existing.status,'transaction_id',v_existing.transaction_id,'reason','human_edit_protected');
    end if;
  end if;

  if found then
    v_event_type:=case when v_existing.status='needs_rematch' then 'ai_rematch_draft_created' else 'ai_draft_reprocessed' end;
    insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data,metadata)
    values(v_existing.id,v_event_type,'qrpay-ai-worker',v_existing.working_draft,v_work,jsonb_build_object('previous_conversation_id',v_existing.conversation_id,'new_conversation_id',v_job.matched_conversation_id,'worker_version',v_worker_version,'human_touched',v_human_touched));
    update public.qrpay_order_drafts set
      qrpay_job_id=v_job.id,unmatched_payment_id=coalesce(v_unmatched.id,unmatched_payment_id),provider=coalesce(v_job.provider,v_unmatched.provider,provider),
      payment_snapshot=case when payment_snapshot='{}'::jsonb then jsonb_build_object('provider',coalesce(v_unmatched.provider,v_job.provider),'transaction_id',v_job.transaction_id,'amount',v_job.amount,'paid_at',coalesce(v_unmatched.paid_at,v_job.payment_received_at),'sender_name',v_unmatched.sender_name,'raw_payload',coalesce(v_unmatched.raw_payload,'{}'::jsonb),'raw',coalesce(v_unmatched.raw,'{}'::jsonb)) else payment_snapshot end,
      conversation_id=v_job.matched_conversation_id,
      customer_phone=nullif(regexp_replace(coalesce(p_payload#>>'{customer,phone}',v_job.matched_phone,''),'[^0-9]','','g'),''),
      customer_name=coalesce(nullif(p_payload#>>'{customer,name}',''),v_job.matched_customer_name),match_score=coalesce(v_job.match_score,nullif(p_payload->>'match_score','')::numeric),match_reason=coalesce(v_job.match_reason,p_payload->>'match_reason'),
      ai_draft=v_work,working_draft=v_work,confirmed_draft=null,evidence=coalesce(p_payload->'evidence','{}'::jsonb),
      item_subtotal=(v_totals->>'item_subtotal')::numeric,shipping_fee=(v_totals->>'shipping_fee')::numeric,draft_total=(v_totals->>'draft_total')::numeric,
      payment_difference=round((v_totals->>'draft_total')::numeric-payment_amount,2),ai_worker_version=v_worker_version,status='pending_admin',version=version+1,
      admin_link_sent_at=null,last_error=null,updated_at=now()
    where id=v_existing.id returning * into v_draft;
  else
    v_event_type:='ai_draft_created';
    insert into public.qrpay_order_drafts(qrpay_job_id,unmatched_payment_id,transaction_id,provider,payment_amount,payment_received_at,payment_snapshot,conversation_id,customer_phone,customer_name,match_score,match_reason,ai_draft,working_draft,evidence,item_subtotal,shipping_fee,draft_total,payment_difference,ai_worker_version,status)
    values(v_job.id,v_unmatched.id,v_job.transaction_id,coalesce(v_job.provider,v_unmatched.provider),v_job.amount,v_job.payment_received_at,
      jsonb_build_object('provider',coalesce(v_unmatched.provider,v_job.provider),'transaction_id',v_job.transaction_id,'amount',v_job.amount,'paid_at',coalesce(v_unmatched.paid_at,v_job.payment_received_at),'sender_name',v_unmatched.sender_name,'raw_payload',coalesce(v_unmatched.raw_payload,'{}'::jsonb),'raw',coalesce(v_unmatched.raw,'{}'::jsonb)),
      v_job.matched_conversation_id,nullif(regexp_replace(coalesce(p_payload#>>'{customer,phone}',v_job.matched_phone,''),'[^0-9]','','g'),''),coalesce(nullif(p_payload#>>'{customer,name}',''),v_job.matched_customer_name),coalesce(v_job.match_score,nullif(p_payload->>'match_score','')::numeric),coalesce(v_job.match_reason,p_payload->>'match_reason'),v_work,v_work,coalesce(p_payload->'evidence','{}'::jsonb),(v_totals->>'item_subtotal')::numeric,(v_totals->>'shipping_fee')::numeric,(v_totals->>'draft_total')::numeric,round((v_totals->>'draft_total')::numeric-v_job.amount,2),v_worker_version,'pending_admin') returning * into v_draft;
    insert into public.qrpay_order_draft_events(draft_id,event_type,actor,after_data,metadata)
    values(v_draft.id,v_event_type,'qrpay-ai-worker',v_work,jsonb_build_object('payment_snapshot',v_draft.payment_snapshot,'worker_version',v_worker_version));
  end if;

  insert into public.admin_order_reviews(draft_id,source_type,source_key,qrpay_job_id,transaction_id,amount,candidate_phone,candidate_name,match_score,extraction,evidence,status)
  values(v_draft.id,'qrpay_draft','qrpay:'||v_job.transaction_id,v_job.id,v_job.transaction_id,v_job.amount,v_draft.customer_phone,v_draft.customer_name,v_draft.match_score,v_work,v_draft.evidence,'pending_admin')
  on conflict(source_type,source_key) do update set draft_id=excluded.draft_id,qrpay_job_id=excluded.qrpay_job_id,transaction_id=excluded.transaction_id,amount=excluded.amount,candidate_phone=excluded.candidate_phone,candidate_name=excluded.candidate_name,match_score=excluded.match_score,extraction=excluded.extraction,evidence=excluded.evidence,status='pending_admin',completed_at=null,approved_at=null,rejected_at=null,fallback_notified_at=null,last_notified_at=null,updated_at=now()
  returning id into v_review_id;

  update public.qrpay_ai_jobs set status='draft_created',extraction=v_work,evidence=coalesce(v_job.evidence,'{}'::jsonb)||jsonb_build_object('draft_id',v_draft.id,'review_id',v_review_id,'draft_review_token',v_draft.review_token),locked_at=null,completed_at=now(),updated_at=now(),last_error=null where id=v_job.id;
  return jsonb_build_object('success',true,'draft_created',true,'rematched',v_event_type='ai_rematch_draft_created','reprocessed',v_event_type='ai_draft_reprocessed','draft_id',v_draft.id,'review_token',v_draft.review_token,'admin_review_id',v_review_id,'transaction_id',v_draft.transaction_id,'payment_amount',v_draft.payment_amount,'draft_total',v_draft.draft_total,'payment_difference',v_draft.payment_difference,'status',v_draft.status);
end;
$function$;
