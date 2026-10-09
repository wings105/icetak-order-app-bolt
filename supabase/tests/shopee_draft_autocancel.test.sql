BEGIN;
DO $$
DECLARE
  did uuid; mid uuid; sid uuid; nid uuid; cmid uuid; mcid uuid;
  p text; r jsonb; i integer; blocked boolean; t text; matched_count integer;
BEGIN
  -- Synthetic identities only; all state is rolled back before queue dispatch.
  IF EXISTS(SELECT 1 FROM public.qrpay_order_drafts WHERE public.icetak_normalize_phone(customer_phone) LIKE '601000009%')
     OR EXISTS(SELECT 1 FROM public.customer_master WHERE primary_phone_normalized LIKE '601000009%') THEN
    RAISE EXCEPTION 'QA phone range already occupied';
  END IF;
  FOR i IN 1..16 LOOP
    p:='601000009'||lpad(i::text,2,'0');
    INSERT INTO public.qrpay_order_drafts(customer_phone,customer_name,source_type,status,working_draft,
      created_at,admin_approved_at,customer_link_sent_at,payment_mode,payment_status,payment_required)
    VALUES('0'||substr(p,3),'QA Shopee switch','manual_admin','awaiting_payment','{}',now()-interval '1 hour',
      now()-interval '55 minutes',now()-interval '50 minutes','prepaid','pending',true) RETURNING id,customer_review_token INTO did,t;
    INSERT INTO public.payment_sessions(draft_id,expected_amount,base_amount,status,expires_at)
      VALUES(did,9876+i,9876+i,'pending',now()+interval '10 minutes') RETURNING id INTO sid;
    UPDATE public.qrpay_order_drafts SET payment_session_id=sid WHERE id=did;
    INSERT INTO public.notification_queue(event_type,status,payload)
      VALUES('draft_followup_1','pending',jsonb_build_object('draft_id',did)) RETURNING id INTO nid;
    IF i=2 THEN
      INSERT INTO public.qrpay_order_drafts(customer_phone,source_type,status,created_at,customer_link_sent_at,payment_mode,payment_status)
        VALUES(p,'manual_admin','ready_customer',now()-interval '2 hours',now()-interval '90 minutes','prepaid','pending');
    ELSIF i=3 THEN UPDATE public.qrpay_order_drafts SET payment_status='paid',payment_received_at=now(),payment_amount=24 WHERE id=did;
    ELSIF i=4 THEN UPDATE public.payment_sessions SET status='receipt_submitted',submitted_at=now(),receipt_path='qa/receipt.png' WHERE id=sid;
    ELSIF i=5 THEN UPDATE public.qrpay_order_drafts SET created_at=now()-interval '20 days' WHERE id=did;
    ELSIF i=6 THEN UPDATE public.qrpay_order_drafts SET customer_link_sent_at=null WHERE id=did;
    ELSIF i=7 THEN UPDATE public.qrpay_order_drafts SET payment_mode='cash_counter' WHERE id=did;
    ELSIF i=13 THEN UPDATE public.qrpay_order_drafts SET created_at=now()+interval '1 hour' WHERE id=did;
    ELSIF i=15 THEN
      INSERT INTO public.customer_master(display_name,primary_phone_normalized) VALUES('QA conflicting identity A',p),('QA conflicting identity B',p);
    ELSIF i=16 THEN UPDATE public.qrpay_order_drafts SET payment_status='pending_review' WHERE id=did;
    END IF;
    INSERT INTO public.marketplace_orders(order_sn,payment_status,current_status,placed_at,raw_detail)
      VALUES('QA-SHOPEE-DRAFT-'||gen_random_uuid(),CASE WHEN i=8 THEN 'unpaid' ELSE 'paid' END,
        CASE WHEN i=8 THEN 'UNPAID' WHEN i=11 THEN 'CANCELLED' ELSE 'READY_TO_SHIP' END,now(),
        CASE WHEN i=9 THEN jsonb_build_object('recipient_address',jsonb_build_object('phone','60100****001'))
          WHEN i=10 THEN '{}'::jsonb WHEN i=14 THEN jsonb_build_object('recipient_address',jsonb_build_object('phone','60100000999'))
          ELSE jsonb_build_object('recipient_address',jsonb_build_object('phone','+'||p)) END)
      RETURNING id INTO mid;
    IF i=12 THEN UPDATE public.marketplace_orders SET created_at='2026-10-01 00:00:00+00' WHERE id=mid; END IF;
    -- Force the real deferred integration trigger (not only the helper RPC).
    SET CONSTRAINTS zz_shopee_draft_match_order IMMEDIATE;
    SET CONSTRAINTS zz_shopee_draft_match_order DEFERRED;
    IF i=10 THEN
      INSERT INTO public.customer_master(display_name) VALUES('QA delayed identity') RETURNING id INTO cmid;
      INSERT INTO public.marketplace_customers(region,provider_user_id,username,customer_master_id)
        VALUES('MY','qa:'||gen_random_uuid(),'qa-'||gen_random_uuid(),cmid) RETURNING id INTO mcid;
      UPDATE public.marketplace_orders SET buyer_customer_id=mcid WHERE id=mid;
      SET CONSTRAINTS zz_shopee_draft_match_order IMMEDIATE;
      SET CONSTRAINTS zz_shopee_draft_match_order DEFERRED;
      IF (SELECT status FROM public.qrpay_order_drafts WHERE id=did)='rejected' THEN RAISE EXCEPTION 'Cancelled without phone'; END IF;
      UPDATE public.customer_master SET primary_phone_normalized=p WHERE id=cmid;
      SET CONSTRAINTS zz_shopee_draft_match_master IMMEDIATE;
      SET CONSTRAINTS zz_shopee_draft_match_master DEFERRED;
    END IF;
    IF i IN (1,10) THEN
      IF NOT EXISTS(SELECT 1 FROM public.qrpay_order_drafts WHERE id=did AND status='rejected'
        AND cancel_reason_code='customer_order_shopee' AND NOT followup_enabled AND next_followup_at IS NULL
        AND evidence#>>'{shopee_match,status}'='cancelled') THEN RAISE EXCEPTION 'Auto cancel failed case %',i; END IF;
      IF (SELECT status FROM public.payment_sessions WHERE id=sid)<>'cancelled' THEN RAISE EXCEPTION 'Payment remains active'; END IF;
      IF (SELECT status FROM public.notification_queue WHERE id=nid)<>'cancelled' THEN RAISE EXCEPTION 'Followup remains active'; END IF;
      PERFORM public.icetak_match_shopee_draft(mid);
      SELECT count(*) INTO matched_count FROM public.qrpay_order_draft_events WHERE draft_id=did AND event_type='shopee_order_auto_cancelled';
      IF matched_count<>1 THEN RAISE EXCEPTION 'Duplicate cancellation audit'; END IF;
      blocked:=false;
      BEGIN PERFORM public.icetak_prepare_draft_payment(t); EXCEPTION WHEN OTHERS THEN blocked:=SQLERRM LIKE 'Draft telah dibatalkan%'; END;
      IF NOT blocked THEN RAISE EXCEPTION 'Old payment link not blocked'; END IF;
      blocked:=false;
      BEGIN PERFORM public.icetak_customer_confirm_draft(t); EXCEPTION WHEN OTHERS THEN blocked:=SQLERRM LIKE 'Draft telah dibatalkan%'; END;
      IF NOT blocked THEN RAISE EXCEPTION 'Old confirm link not blocked'; END IF;
      blocked:=false;
      BEGIN PERFORM public.icetak_customer_request_draft_change(t,'QA'); EXCEPTION WHEN OTHERS THEN blocked:=SQLERRM LIKE 'Draft telah dibatalkan%'; END;
      IF NOT blocked THEN RAISE EXCEPTION 'Old change link not blocked'; END IF;
      blocked:=false;
      BEGIN UPDATE public.qrpay_order_drafts SET status='awaiting_payment' WHERE id=did; EXCEPTION WHEN OTHERS THEN blocked:=SQLERRM LIKE 'Draft telah dibatalkan%'; END;
      IF NOT blocked THEN RAISE EXCEPTION 'Stale write not blocked'; END IF;
      blocked:=false;
      BEGIN UPDATE public.payment_sessions SET status='receipt_submitted',receipt_path='qa/late.png' WHERE id=sid; EXCEPTION WHEN OTHERS THEN blocked:=SQLERRM LIKE 'Draft telah dibatalkan%'; END;
      IF NOT blocked THEN RAISE EXCEPTION 'Late receipt not blocked'; END IF;
    ELSIF i IN (2,15) THEN
      IF (SELECT status FROM public.qrpay_order_drafts WHERE id=did)='rejected'
        OR (SELECT evidence#>>'{shopee_match,status}' FROM public.qrpay_order_drafts WHERE id=did)<>'needs_review'
        OR (SELECT followup_enabled FROM public.qrpay_order_drafts WHERE id=did) THEN RAISE EXCEPTION 'Ambiguity handling failed'; END IF;
    ELSE
      IF (SELECT status FROM public.qrpay_order_drafts WHERE id=did)='rejected' THEN RAISE EXCEPTION 'Protected case % cancelled',i; END IF;
    END IF;
  END LOOP;
END $$;
SELECT 'PASS: 16 real-trigger cases, payment/receipt protection, delayed CRM phone, identity conflicts, cancellation audit, stale checkout, late receipt and retry guards' AS result;
ROLLBACK;
