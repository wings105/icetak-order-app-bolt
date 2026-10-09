-- Run in one transaction; all synthetic drafts/events are rolled back.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE d uuid; token text; h jsonb; item jsonb; expected_count bigint; report jsonb; kind text; month text;
BEGIN
  INSERT INTO public.qrpay_order_drafts(source_type,customer_name,working_draft,payment_required,payment_status,followup_enabled)
  VALUES('admin_manual','QA cancellation audit rollback','{"items":[]}',true,'unpaid',false)
  RETURNING id,review_token INTO d,token;
  PERFORM public.icetak_admin_cancel_draft(token,'customer_order_shopee','QA Shopee order reference','automation','automation');
  h:=public.finance_admin_draft_cancellation_history(d);
  IF (h->>'total')::int<>1 OR h#>>'{events,0,source}'<>'automation' OR h#>>'{events,0,actor}'<>'automation'
    OR h#>>'{events,0,reason_detail}'<>'QA Shopee order reference' THEN RAISE EXCEPTION 'Auto cancellation audit missing'; END IF;
  PERFORM public.icetak_admin_reopen_cancelled_draft(d,'qa-owner');
  IF (public.finance_admin_draft_cancellation_history(d)->>'total')::int<>2 THEN RAISE EXCEPTION 'Reopen lost history'; END IF;
  PERFORM public.icetak_admin_cancel_draft(token,'customer_order_shopee','QA manual reason','qa-owner','admin');
  h:=public.finance_admin_draft_cancellation_history(d);
  IF (h->>'total')::int<>3 THEN RAISE EXCEPTION 'Repeated cancellation history lost'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'events') e WHERE e->>'source'='admin' AND e->>'actor'='qa-owner' AND e->>'reason_detail'='QA manual reason')
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h->'events') e WHERE e->>'event_type'='draft_reopened' AND e->>'reason_code'='customer_order_shopee') THEN RAISE EXCEPTION 'Manual/reopen detail missing'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(h->'events') LOOP
    IF item ?| ARRAY['before_data','after_data','diff','metadata','review_token','working_draft','payment_snapshot'] THEN RAISE EXCEPTION 'Raw snapshot exposed'; END IF;
  END LOOP;
  INSERT INTO public.qrpay_order_draft_events(draft_id,event_type,actor,metadata)
    SELECT d,'admin_rejected','qa-legacy','{}'::jsonb FROM generate_series(1,51);
  h:=public.finance_admin_draft_cancellation_history(d,50);
  IF (h->>'total')::int<>54 OR jsonb_array_length(h->'events')<>4 THEN RAISE EXCEPTION 'History pagination incorrect'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.finance_admin_draft_cancellation_history(d)->'events') e WHERE e->>'source'='unknown') THEN RAISE EXCEPTION 'Legacy source guessed'; END IF;
  FOREACH month IN ARRAY ARRAY['2026-08-01','2026-09-01','2026-10-01'] LOOP
    FOREACH kind IN ARRAY ARRAY['automation','admin','unknown'] LOOP
      SELECT count(*) INTO expected_count FROM public.qrpay_order_drafts q LEFT JOIN public.orders o ON o.id=q.order_id
        WHERE q.created_at>=(month::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
          AND q.created_at<((month::date+interval '1 month')::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
          AND (q.status='rejected' OR (q.order_id IS NOT NULL AND lower(o.status) IN ('cancelled','canceled','void','voided')))
          AND CASE WHEN q.status='rejected' AND q.cancel_source='automation' THEN 'automation' WHEN q.status='rejected' AND q.cancel_source='admin' THEN 'admin' ELSE 'unknown' END=kind;
      report:=public.finance_admin_draft_report(jsonb_build_object('date',month,'cancel_source',kind));
      IF (report#>>'{summary,total}')::bigint<>expected_count OR (report#>>'{summary,cancelled_all}')::bigint<>expected_count THEN RAISE EXCEPTION 'Cancellation source filter mismatch % %',month,kind; END IF;
      FOR item IN SELECT value FROM jsonb_array_elements(report->'drafts') LOOP
        IF item->>'cancellation_kind'<>kind OR item->>'outcome'<>'cancelled' THEN RAISE EXCEPTION 'Source filter returned wrong row'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF has_function_privilege('anon','public.finance_admin_draft_cancellation_history(uuid,integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.finance_admin_draft_cancellation_history(uuid,integer)','EXECUTE') THEN RAISE EXCEPTION 'Private history RPC publicly callable'; END IF;
END $$;
SELECT 'PASS: auto/manual/reopen/recancel/legacy/privacy/pagination/source filters' AS verification;
ROLLBACK;
