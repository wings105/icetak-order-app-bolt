CREATE OR REPLACE FUNCTION public.icetak_create_generic_order_draft(p_source_type text, p_conversation_id uuid, p_customer_phone text, p_customer_name text, p_payload jsonb, p_request_key text DEFAULT NULL::text, p_cutoff_at timestamp with time zone DEFAULT now(), p_trigger_message_id uuid DEFAULT NULL::uuid, p_payment_mode text DEFAULT 'prepaid'::text, p_actor text DEFAULT 'system'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  s jsonb;
  sid uuid;
  d public.qrpay_order_drafts%rowtype;
  totals jsonb;
  work jsonb;
  req text := nullif(btrim(p_request_key), '');
  pay_required boolean;
  pmode text := lower(coalesce(nullif(p_payment_mode, ''), 'prepaid'));
  resolved jsonb;
begin
  -- AP and native delivery share one provider-message identity, irrespective of caller request_key.
  if nullif(p_payload#>>'{evidence,provider_message_id}','') is not null then
    perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',p_conversation_id::text,p_source_type,pmode,p_payload#>>'{evidence,provider_message_id}'),0));
    select * into d from public.qrpay_order_drafts
      where conversation_id=p_conversation_id and source_type=p_source_type and payment_mode=pmode
        and evidence->>'provider_message_id'=p_payload#>>'{evidence,provider_message_id}'
      order by created_at limit 1;
    if found then return to_jsonb(d) || jsonb_build_object('duplicate',true);end if;
  end if;
  if req is not null then perform pg_advisory_xact_lock(hashtextextended('draft-request:'||req,0));end if;
  if req is not null then
    select * into d from public.qrpay_order_drafts where request_key = req limit 1;
    if found then return to_jsonb(d) || jsonb_build_object('duplicate', true); end if;
  end if;

  resolved := public.icetak_apply_crm_customer_to_draft_payload(p_customer_phone, p_customer_name, p_payload);
  p_payload := resolved->'payload';
  p_customer_phone := resolved->>'customer_phone';
  p_customer_name := resolved->>'customer_name';

  s := public.icetak_open_order_session(p_conversation_id, p_customer_phone, p_customer_name, p_source_type, p_cutoff_at, p_trigger_message_id, jsonb_build_object('actor', p_actor));
  sid := (s->>'id')::uuid;
  if jsonb_typeof(coalesce(p_payload->'items', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) = 0 then
    raise exception 'At least one draft item required';
  end if;
  p_payload := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('source_type', coalesce(nullif(p_source_type, ''), 'chat_trigger'), 'payment_mode', pmode, 'cutoff_at', p_cutoff_at);
  p_payload := public.icetak_enrich_draft_quick_order_v13(p_payload);
  totals := public.icetak_qrpay_draft_totals(p_payload);
  pay_required := pmode not in ('cash_counter', 'cash_at_counter', 'prepaid_external', 'already_paid');
  work := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('total', (totals->>'draft_total')::numeric, 'draft_total', (totals->>'draft_total')::numeric, 'delivery_fee', (totals->>'shipping_fee')::numeric, 'source_type', p_source_type, 'payment_mode', pmode, 'order_session_id', sid);
  insert into public.qrpay_order_drafts(source_type, request_key, order_session_id, transaction_id, provider, payment_amount, payment_received_at, payment_snapshot, conversation_id, customer_phone, customer_name, match_score, match_reason, ai_draft, working_draft, evidence, item_subtotal, shipping_fee, draft_total, payment_difference, ai_worker_version, status, payment_required, payment_status, payment_mode, trigger_message_id, cutoff_at)
  values(coalesce(nullif(p_source_type, ''), 'chat_trigger'), req, sid, null, null, null, null, '{}'::jsonb, p_conversation_id, nullif(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g'), ''), p_customer_name, nullif(p_payload->>'match_score', '')::numeric, p_payload->>'match_reason', work, work, coalesce(p_payload->'evidence', '{}'::jsonb), (totals->>'item_subtotal')::numeric, (totals->>'shipping_fee')::numeric, (totals->>'draft_total')::numeric, 0, coalesce(p_payload#>>'{evidence,worker_version}', p_payload#>>'{evidence,extractor}', 'draft-engine-v1'), 'pending_admin', pay_required, case when pmode in ('prepaid_external', 'already_paid') then 'paid' when pmode in ('cash_counter', 'cash_at_counter') then 'cash_counter' else 'unpaid' end, pmode, p_trigger_message_id, p_cutoff_at)
  returning * into d;
  update public.order_sessions set status = 'draft_created', updated_at = now() where id = sid;
  insert into public.qrpay_order_draft_events(draft_id, event_type, actor, after_data, metadata)
  values(d.id, 'ai_draft_created', coalesce(nullif(p_actor, ''), 'system'), work, jsonb_build_object('source_type', p_source_type, 'order_session_id', sid, 'ai_feedback_version', 'v14', 'crm_customer_resolution', resolved - 'payload'));
  return to_jsonb(d) || jsonb_build_object('session', s, 'duplicate', false);
end;
$function$

