-- Private, read-only cohort report. Counts/charts are computed before pagination.
CREATE OR REPLACE FUNCTION public.finance_admin_draft_report(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  f jsonb:=coalesce(p_filter,'{}'::jsonb);
  period text:=coalesce(nullif(f->>'period',''),'month');
  basis text:=coalesce(nullif(f->>'date_basis',''),'created');
  anchor date:=coalesce(nullif(f->>'date','')::date,(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date);
  first_day date; last_day date; from_time timestamptz; to_time timestamptz;
  query text:=left(btrim(coalesce(f->>'query','')),200);
  state text:=coalesce(nullif(f->>'state',''),'all');
  sort_key text:=coalesce(nullif(f->>'sort',''),'newest');
  page_offset integer:=greatest(coalesce((f->>'offset')::integer,0),0);
  page_size integer:=least(greatest(coalesce((f->>'limit')::integer,50),1),100);
  result jsonb;
BEGIN
  IF period NOT IN ('day','week','month') OR basis NOT IN ('created','sent') THEN
    RAISE EXCEPTION 'Invalid draft reporting period/date basis';
  END IF;
  IF state NOT IN ('all','active','sent','unsent','closed','cancelled','order_unpaid','pending') THEN
    RAISE EXCEPTION 'Invalid draft reporting state';
  END IF;
  IF sort_key NOT IN ('newest','oldest','name','amount_desc','amount_asc') THEN
    RAISE EXCEPTION 'Invalid draft reporting sort';
  END IF;
  first_day:=CASE period WHEN 'day' THEN anchor WHEN 'week' THEN date_trunc('week',anchor::timestamp)::date ELSE date_trunc('month',anchor::timestamp)::date END;
  last_day:=CASE period WHEN 'day' THEN first_day WHEN 'week' THEN first_day+6 ELSE (first_day+interval '1 month'-interval '1 day')::date END;
  from_time:=first_day::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  to_time:=(last_day+1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  WITH base AS MATERIALIZED (
    SELECT d.*,o.status AS order_status,o.payment_status AS order_payment_status,
      coalesce(o.order_no,d.order_no) AS canonical_order_no,
      d.customer_link_sent_at IS NOT NULL AS sent,
      CASE WHEN d.status='rejected' THEN 'cancelled'
        WHEN d.order_id IS NOT NULL AND lower(coalesce(o.status,'')) IN ('cancelled','canceled','void','voided') THEN 'cancelled'
        WHEN d.order_id IS NOT NULL AND o.id IS NOT NULL AND lower(o.payment_status)='paid' THEN 'closed'
        WHEN d.order_id IS NOT NULL THEN 'order_unpaid'
        ELSE 'active' END AS outcome,
      CASE WHEN d.status='rejected' THEN coalesce(nullif(d.cancel_reason_code,''),'unknown')
        WHEN d.order_id IS NOT NULL AND lower(coalesce(o.status,'')) IN ('cancelled','canceled','void','voided') THEN 'order_cancelled'
        ELSE NULL END AS reason_code,
      CASE basis WHEN 'sent' THEN d.customer_link_sent_at ELSE d.created_at END AS cohort_at,
      coalesce(d.working_draft->>'delivery','unknown') AS delivery_code,
      coalesce(d.working_draft#>>'{whatsapp_identity,bsuid}',d.evidence#>>'{whatsapp_identity,bsuid}') AS bsuid,
      coalesce(d.working_draft#>>'{whatsapp_identity,username}',d.evidence#>>'{whatsapp_identity,username}') AS username
    FROM public.qrpay_order_drafts d LEFT JOIN public.orders o ON o.id=d.order_id
    WHERE (basis='created' AND d.created_at>=from_time AND d.created_at<to_time)
       OR (basis='sent' AND d.customer_link_sent_at>=from_time AND d.customer_link_sent_at<to_time)
  ), classified AS (
    SELECT b.*,CASE WHEN outcome<>'cancelled' THEN NULL
      WHEN status='rejected' AND cancel_source='automation' THEN 'automation'
      WHEN status='rejected' AND cancel_source='admin' THEN 'admin'
      ELSE 'unknown' END AS cancellation_kind FROM base b
  ), filtered AS MATERIALIZED (
    SELECT b.*,CASE WHEN reason_code='order_cancelled' THEN 'Order selepas conversion dibatalkan'
      ELSE coalesce(r.label,CASE WHEN reason_code='unknown' THEN 'Sebab tidak direkodkan' ELSE reason_code END) END AS reason_label
    FROM classified b LEFT JOIN public.draft_cancel_reasons r ON r.code=b.reason_code
    WHERE (state='all' OR (state='sent' AND sent) OR (state='unsent' AND NOT sent)
      OR (state='pending' AND sent AND outcome NOT IN ('closed','cancelled')) OR outcome=state)
      AND (coalesce(f->>'status','') IN ('','all') OR b.status=f->>'status')
      AND (coalesce(f->>'source','') IN ('','all') OR b.source_type=f->>'source')
      AND (coalesce(f->>'payment_mode','') IN ('','all') OR b.payment_mode=f->>'payment_mode')
      AND (coalesce(f->>'delivery','') IN ('','all') OR b.delivery_code=f->>'delivery')
      AND (coalesce(f->>'cancel_source','') IN ('','all') OR b.cancellation_kind=f->>'cancel_source')
      AND (coalesce(f->>'reason','') IN ('','all') OR b.reason_code=f->>'reason')
      AND (query='' OR concat_ws(' ',b.id::text,b.customer_name,b.customer_phone,b.username,b.bsuid,b.transaction_id,b.canonical_order_no) ILIKE '%'||query||'%'
        OR (regexp_replace(query,'[^0-9]','','g')<>'' AND b.customer_phone ILIKE '%'||regexp_replace(query,'[^0-9]','','g')||'%'))
  ), totals AS (
    SELECT count(*) AS total,count(*) FILTER(WHERE sent) AS sent,
      count(*) FILTER(WHERE sent AND outcome='closed') AS closed_sales,
      count(*) FILTER(WHERE sent AND outcome='cancelled') AS cancelled,
      count(*) FILTER(WHERE sent AND outcome NOT IN ('closed','cancelled')) AS pending,
      count(*) FILTER(WHERE NOT sent) AS unsent,
      count(*) FILTER(WHERE outcome='closed') AS closed_all,
      count(*) FILTER(WHERE outcome='cancelled') AS cancelled_all,
      count(*) FILTER(WHERE outcome='order_unpaid') AS order_unpaid_all,
      coalesce(sum(draft_total) FILTER(WHERE sent AND outcome='closed'),0) AS closed_value
    FROM filtered
  ), page AS (
    SELECT * FROM filtered ORDER BY
      CASE WHEN sort_key='newest' THEN cohort_at END DESC,
      CASE WHEN sort_key='oldest' THEN cohort_at END ASC,
      CASE WHEN sort_key='name' THEN lower(customer_name) END ASC NULLS LAST,
      CASE WHEN sort_key='amount_desc' THEN draft_total END DESC,
      CASE WHEN sort_key='amount_asc' THEN draft_total END ASC,id DESC
    LIMIT page_size OFFSET page_offset
  ), reason_counts AS (
    SELECT reason_code AS code,reason_label AS label,count(*) AS count,
      count(*) FILTER(WHERE sent) AS sent_count FROM filtered WHERE outcome='cancelled' GROUP BY 1,2
  ), source_counts AS (
    SELECT source_type AS source,count(*) AS total,count(*) FILTER(WHERE sent) AS sent,
      count(*) FILTER(WHERE sent AND outcome='closed') AS closed,
      count(*) FILTER(WHERE sent AND outcome='cancelled') AS cancelled FROM filtered GROUP BY 1
  ), buckets AS (
    SELECT generate_series(first_day::timestamp,(last_day+1)::timestamp-
      CASE WHEN period='day' THEN interval '1 hour' ELSE interval '1 day' END,
      CASE WHEN period='day' THEN interval '1 hour' ELSE interval '1 day' END) AS local_at
  ), trend_counts AS (
    SELECT date_trunc(CASE WHEN period='day' THEN 'hour' ELSE 'day' END,cohort_at AT TIME ZONE 'Asia/Kuala_Lumpur') AS local_at,
      count(*) AS total,count(*) FILTER(WHERE sent) AS sent,
      count(*) FILTER(WHERE sent AND outcome='closed') AS closed,
      count(*) FILTER(WHERE sent AND outcome='cancelled') AS cancelled,
      count(*) FILTER(WHERE sent AND outcome NOT IN ('closed','cancelled')) AS pending FROM filtered GROUP BY 1
  )
  SELECT jsonb_build_object(
    'period',jsonb_build_object('kind',period,'date',anchor,'from',first_day,'to',last_day,'date_basis',basis,'timezone','Asia/Kuala_Lumpur'),
    'summary',(SELECT to_jsonb(t)||jsonb_build_object('sent_pct',round(sent*100.0/nullif(total,0),1),
      'closed_pct',round(closed_sales*100.0/nullif(sent,0),1),'cancelled_pct',round(cancelled*100.0/nullif(sent,0),1),
      'pending_pct',round(pending*100.0/nullif(sent,0),1)) FROM totals t),
    'pagination',jsonb_build_object('offset',page_offset,'limit',page_size,'total',(SELECT total FROM totals)),
    'options',jsonb_build_object(
      'sources',(SELECT coalesce(jsonb_agg(x.source_type ORDER BY x.source_type),'[]'::jsonb) FROM (SELECT DISTINCT source_type FROM public.qrpay_order_drafts)x),
      'statuses',(SELECT coalesce(jsonb_agg(x.status ORDER BY x.status),'[]'::jsonb) FROM (SELECT DISTINCT status FROM public.qrpay_order_drafts)x)),
    'reasons',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.sort_order),'[]'::jsonb) FROM public.draft_cancel_reasons r WHERE r.enabled),
    'cancel_reasons',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('pct',round(count*100.0/nullif((SELECT cancelled_all FROM totals),0),1)) ORDER BY count DESC,code) FROM reason_counts r),'[]'::jsonb),
    'sources',coalesce((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('closed_pct',round(closed*100.0/nullif(sent,0),1)) ORDER BY total DESC,source) FROM source_counts s),'[]'::jsonb),
    'trend',(SELECT jsonb_agg(jsonb_build_object('at',to_char(b.local_at,'YYYY-MM-DD"T"HH24:MI:SS'),
      'label',to_char(b.local_at,CASE WHEN period='day' THEN 'HH24:MI' ELSE 'DD Mon' END),
      'total',coalesce(t.total,0),'sent',coalesce(t.sent,0),'closed',coalesce(t.closed,0),
      'cancelled',coalesce(t.cancelled,0),'pending',coalesce(t.pending,0)) ORDER BY b.local_at) FROM buckets b LEFT JOIN trend_counts t USING(local_at)),
    'drafts',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'status',status,'source_type',source_type,'customer_name',customer_name,'customer_phone',customer_phone,
      'customer_bsuid',bsuid,'customer_username',username,'conversation_id',conversation_id,
      'draft_total',draft_total,'payment_status',payment_status,'payment_required',payment_required,'payment_mode',payment_mode,
      'transaction_id',transaction_id,'payment_amount',payment_amount,'review_token',review_token,
      'admin_approved_at',admin_approved_at,'customer_confirmed_at',customer_confirmed_at,
      'customer_link_sent_at',customer_link_sent_at,'converted_at',converted_at,'cohort_at',cohort_at,
      'date_need',working_draft->>'date_need','delivery',delivery_code,
      'item_count',jsonb_array_length(coalesce(working_draft->'items','[]'::jsonb)),
      'created_at',created_at,'updated_at',updated_at,'rejected_at',rejected_at,'rejected_by',rejected_by,
      'cancel_reason_code',cancel_reason_code,'cancel_reason_label',reason_label,'cancel_reason_detail',cancel_reason_detail,
      'cancel_source',cancel_source,'cancellation_kind',cancellation_kind,'shopee_match',evidence->'shopee_match','followup_count',followup_count,
      'order_id',order_id,'order_no',canonical_order_no,'order_status',order_status,
      'order_payment_status',order_payment_status,'outcome',outcome,
      'payment_available',CASE WHEN transaction_id IS NULL THEN NULL ELSE EXISTS(SELECT 1 FROM public.unmatched_payment_transactions u WHERE u.transaction_id=page.transaction_id) END
    )) FROM page),'[]'::jsonb)) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.finance_admin_draft_report(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_admin_draft_report(jsonb) TO service_role;


-- Cancellation/reopen audit only; never return raw draft/payment snapshots or tokens.
CREATE OR REPLACE FUNCTION public.finance_admin_draft_cancellation_history(p_draft_id uuid,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.qrpay_order_drafts WHERE id=p_draft_id) THEN
    RAISE EXCEPTION 'draft_not_found';
  END IF;
  WITH events AS MATERIALIZED (
    SELECT e.id,e.created_at,e.event_type,e.actor,
      CASE WHEN e.event_type='draft_reopened' THEN 'admin'
        WHEN e.metadata->>'source' IN ('automation','admin') THEN e.metadata->>'source'
        ELSE 'unknown' END AS source,
      CASE WHEN e.event_type='draft_reopened' THEN e.metadata->>'previous_reason_code'
        ELSE e.metadata->>'reason_code' END AS reason_code,
      e.metadata->>'reason_label' AS recorded_label,e.metadata->>'reason_detail' AS reason_detail
    FROM public.qrpay_order_draft_events e WHERE e.draft_id=p_draft_id
      AND e.event_type IN ('admin_rejected','draft_reopened')
  ), page AS (
    SELECT e.*,coalesce(e.recorded_label,r.label,e.reason_code,'Sebab tidak direkodkan') AS reason_label
    FROM events e LEFT JOIN public.draft_cancel_reasons r ON r.code=e.reason_code
    ORDER BY e.created_at DESC,e.id DESC LIMIT 50 OFFSET greatest(coalesce(p_offset,0),0)
  )
  SELECT jsonb_build_object('draft_id',p_draft_id,
    'total',(SELECT count(*) FROM events),'offset',greatest(coalesce(p_offset,0),0),'limit',50,
    'events',coalesce((SELECT jsonb_agg(to_jsonb(p)-'recorded_label' ORDER BY p.created_at DESC,p.id DESC) FROM page p),'[]'::jsonb)) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.finance_admin_draft_cancellation_history(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_admin_draft_cancellation_history(uuid,integer) TO service_role;
