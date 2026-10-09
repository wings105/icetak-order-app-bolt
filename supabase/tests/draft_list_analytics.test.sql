BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  f jsonb;r jsonb;s jsonb;expected record;ids uuid[];page_ids uuid[];page_offset integer;
  from_time timestamptz;to_time timestamptz;n integer:=0;cases jsonb;
BEGIN
  cases:='[
    {"period":"day","date":"2026-10-09"},{"period":"week","date":"2026-10-09"},
    {"period":"month","date":"2026-10-09"},{"period":"month","date":"2026-09-15"},
    {"period":"month","date":"2026-08-15"},{"period":"day","date":"2026-09-01"},
    {"period":"day","date":"2026-08-13"},{"period":"month","date":"2100-01-01"},
    {"period":"month","date":"2028-02-01"},{"period":"week","date":"2026-09-01"},
    {"period":"month","date":"2026-09-01","date_basis":"sent"},
    {"period":"week","date":"2026-10-09","date_basis":"sent"},
    {"period":"day","date":"2026-10-09","date_basis":"sent"},
    {"period":"month","date":"2026-09-01","state":"closed"},
    {"period":"month","date":"2026-09-01","state":"cancelled"},
    {"period":"month","date":"2026-09-01","state":"sent"},
    {"period":"month","date":"2026-09-01","state":"unsent"},
    {"period":"month","date":"2026-10-01","state":"pending"},
    {"period":"month","date":"2026-09-01","state":"order_unpaid"},
    {"period":"month","date":"2026-09-01","state":"active"},
    {"period":"month","date":"2026-09-01","source":"qrpay_payment"},
    {"period":"month","date":"2026-09-01","source":"chat_trigger","payment_mode":"prepaid"},
    {"period":"month","date":"2026-09-01","reason":"customer_order_shopee"},
    {"period":"month","date":"2026-09-01","reason":"order_cancelled"},
    {"period":"month","date":"2026-09-01","status":"confirmed","delivery":"pickup"},
    {"period":"month","date":"2026-09-01","query":"NO_MATCH_RANDOM_20261009"}
  ]'::jsonb;
  FOR f IN SELECT value FROM jsonb_array_elements(cases) LOOP
    r:=public.finance_admin_draft_report(f);s:=r->'summary';
    from_time:=(r#>>'{period,from}')::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
    to_time:=((r#>>'{period,to}')::date+1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
    WITH expected_rows AS (
      SELECT d.*,d.customer_link_sent_at IS NOT NULL AS sent,
        CASE WHEN d.status='rejected' OR (d.order_id IS NOT NULL AND lower(coalesce(o.status,'')) IN ('cancelled','canceled','void','voided')) THEN 'cancelled'
          WHEN d.order_id IS NOT NULL AND o.id IS NOT NULL AND lower(o.payment_status)='paid' THEN 'closed'
          WHEN d.order_id IS NOT NULL THEN 'order_unpaid' ELSE 'active' END AS outcome,
        CASE WHEN d.status='rejected' THEN coalesce(nullif(d.cancel_reason_code,''),'unknown')
          WHEN d.order_id IS NOT NULL AND lower(coalesce(o.status,'')) IN ('cancelled','canceled','void','voided') THEN 'order_cancelled' END AS reason
      FROM public.qrpay_order_drafts d LEFT JOIN public.orders o ON o.id=d.order_id
      WHERE (CASE WHEN f->>'date_basis'='sent' THEN d.customer_link_sent_at ELSE d.created_at END)>=from_time
        AND (CASE WHEN f->>'date_basis'='sent' THEN d.customer_link_sent_at ELSE d.created_at END)<to_time
    ), filtered AS (
      SELECT * FROM expected_rows d WHERE (coalesce(f->>'state','all')='all' OR f->>'state'=outcome
        OR (f->>'state'='sent' AND sent) OR (f->>'state'='unsent' AND NOT sent)
        OR (f->>'state'='pending' AND sent AND outcome NOT IN ('closed','cancelled')))
        AND (NOT f?'source' OR source_type=f->>'source') AND (NOT f?'payment_mode' OR payment_mode=f->>'payment_mode')
        AND (NOT f?'status' OR status=f->>'status') AND (NOT f?'delivery' OR coalesce(working_draft->>'delivery','unknown')=f->>'delivery')
        AND (NOT f?'reason' OR reason=f->>'reason')
        AND (NOT f?'query' OR concat_ws(' ',id::text,customer_name,customer_phone,transaction_id,order_no) ILIKE '%'||(f->>'query')||'%')
    ) SELECT count(*) AS total,count(*) FILTER(WHERE sent) AS sent,
      count(*) FILTER(WHERE sent AND outcome='closed') AS closed,
      count(*) FILTER(WHERE sent AND outcome='cancelled') AS cancelled,
      count(*) FILTER(WHERE outcome='cancelled') AS cancelled_all,
      coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) AS ids INTO expected FROM filtered;
    ASSERT (s->>'total')::integer=expected.total,'Total mismatch: '||f::text;
    ASSERT (s->>'sent')::integer=expected.sent,'Sent mismatch: '||f::text;
    ASSERT (s->>'closed_sales')::integer=expected.closed,'Paid/valid closed mismatch: '||f::text;
    ASSERT (s->>'cancelled')::integer=expected.cancelled,'Cancelled sent mismatch: '||f::text;
    ASSERT (s->>'cancelled_all')::integer=expected.cancelled_all,'All cancelled mismatch: '||f::text;
    ASSERT (s->>'closed_sales')::integer+(s->>'cancelled')::integer+(s->>'pending')::integer=expected.sent,'Outcome partition mismatch';
    ASSERT (SELECT coalesce(sum((value->>'sent')::integer),0) FROM jsonb_array_elements(r->'trend'))=expected.sent,'Trend sent mismatch';
    ASSERT (SELECT coalesce(sum((value->>'total')::integer),0) FROM jsonb_array_elements(r->'trend'))=expected.total,'Trend total mismatch';
    ASSERT (SELECT coalesce(sum((value->>'count')::integer),0) FROM jsonb_array_elements(r->'cancel_reasons'))=expected.cancelled_all,'Reason total mismatch';
    ASSERT (SELECT coalesce(sum((value->>'total')::integer),0) FROM jsonb_array_elements(r->'sources'))=expected.total,'Source total mismatch';
    IF expected.sent=0 THEN ASSERT s->'closed_pct'='null'::jsonb AND s->'cancelled_pct'='null'::jsonb,'Zero denominator must remain unknown';
    ELSE ASSERT (s->>'closed_pct')::numeric=round(expected.closed*100.0/expected.sent,1),'Percentage mismatch';END IF;
    ids:='{}'::uuid[];page_offset:=0;
    LOOP
      r:=public.finance_admin_draft_report(f||jsonb_build_object('offset',page_offset,'limit',17));
      SELECT coalesce(array_agg((x->>'id')::uuid),'{}'::uuid[]) INTO page_ids FROM jsonb_array_elements(r->'drafts')x;
      ids:=ids||page_ids;
      EXIT WHEN cardinality(page_ids)<17;
      page_offset:=page_offset+17;
    END LOOP;
    ASSERT (SELECT coalesce(array_agg(x ORDER BY x),'{}'::uuid[]) FROM unnest(ids)x)=expected.ids,'Pagination coverage/duplicate mismatch: '||f::text;
    n:=n+1;
  END LOOP;
  r:=public.finance_admin_draft_report('{"period":"week","date":"2026-09-01"}');
  ASSERT r#>>'{period,from}'='2026-08-31' AND r#>>'{period,to}'='2026-09-06','ISO Monday week boundary mismatch';
  ASSERT jsonb_array_length(public.finance_admin_draft_report('{"period":"day"}')->'trend')=24,'Hourly bucket mismatch';
  ASSERT jsonb_array_length(public.finance_admin_draft_report('{"period":"month","date":"2028-02-01"}')->'trend')=29,'Leap month mismatch';
  ASSERT NOT has_function_privilege('anon','public.finance_admin_draft_report(jsonb)','execute'),'Anon access';
  ASSERT NOT has_function_privilege('authenticated','public.finance_admin_draft_report(jsonb)','execute'),'Authenticated direct access';
  RAISE NOTICE 'PASS: % read-only production cohorts, pagination, MYT boundaries, percentages, charts, private grants',n;
END $$;
SELECT 'PASS: 26 read-only cohorts, complete pagination, MYT boundaries, percentages, charts and private grants' AS verification;
ROLLBACK;
