-- No historical replay. Only Shopee records first captured after activation qualify.
CREATE OR REPLACE FUNCTION public.icetak_match_shopee_draft(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  m public.marketplace_orders%rowtype;
  d public.qrpay_order_drafts%rowtype;
  phones text[]; phone text; owners integer; ids uuid[]; result jsonb;
  raw_phone text; eligible boolean; already jsonb;
BEGIN
  SELECT * INTO m FROM public.marketplace_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR m.provider<>'shopee' OR m.created_at<'2026-10-09 05:13:02+00' THEN
    RETURN jsonb_build_object('status','out_of_scope');
  END IF;
  already:=m.metadata->'draft_match';
  IF already->>'status'='cancelled' THEN RETURN already; END IF;
  IF m.placed_at IS NULL OR m.placed_at>now()+interval '5 minutes'
     OR lower(m.payment_status)<>'paid'
     OR upper(m.current_status) NOT IN ('READY_TO_SHIP','PROCESSED','SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED') THEN
    RETURN jsonb_build_object('status','not_paid_active');
  END IF;
  -- An exact order/customer CRM mapping is authoritative. Raw recipient phones
  -- are usable only when complete (never strip masking characters into a match).
  raw_phone:=coalesce(nullif(m.raw_detail#>>'{recipient_address,phone}',''),
    nullif(m.raw_detail#>>'{response,order_list,0,recipient_address,phone}',''));
  SELECT array_agg(DISTINCT value) INTO phones FROM (
    SELECT cm.primary_phone_normalized value FROM public.marketplace_customers mc
      JOIN public.customer_master cm ON cm.id=mc.customer_master_id
      WHERE mc.id=m.buyer_customer_id AND cm.status='active'
    UNION
    SELECT i.normalized_value FROM public.marketplace_customers mc
      JOIN public.customer_master cm ON cm.id=mc.customer_master_id
      JOIN public.customer_identifiers_master i ON i.customer_master_id=cm.id
      WHERE mc.id=m.buyer_customer_id AND cm.status='active'
        AND i.identifier_type='phone' AND i.scope='global' AND i.is_verified
    UNION
    SELECT public.icetak_normalize_phone(raw_phone)
      WHERE raw_phone ~ '^\+?[0-9 ()-]+$'
  ) p WHERE value ~ '^601[0-9]{8,9}$';
  IF coalesce(cardinality(phones),0)=0 THEN RETURN jsonb_build_object('status','no_phone'); END IF;
  IF cardinality(phones)<>1 THEN
    result:=jsonb_build_object('status','identity_conflict','order_sn',m.order_sn);
    UPDATE public.marketplace_orders SET metadata=metadata||jsonb_build_object('draft_match',result) WHERE id=m.id;
    RETURN result;
  END IF;
  phone:=phones[1];
  PERFORM pg_advisory_xact_lock(hashtextextended('shopee_draft_phone:'||phone,0));
  SELECT count(DISTINCT id) INTO owners FROM (
    SELECT cm.id FROM public.customer_master cm WHERE cm.status='active' AND cm.primary_phone_normalized=phone
    UNION
    SELECT cm.id FROM public.customer_identifiers_master i JOIN public.customer_master cm ON cm.id=i.customer_master_id
      WHERE i.identifier_type='phone' AND i.scope='global' AND i.normalized_value=phone AND i.is_verified AND cm.status='active'
  ) x;
  -- Lock every active draft for the phone before deciding uniqueness. Paid or
  -- otherwise ineligible sibling drafts must not make an ambiguous match look unique.
  FOR d IN SELECT * FROM public.qrpay_order_drafts x
    WHERE public.icetak_normalize_phone(x.customer_phone)=phone
      AND x.order_id IS NULL AND x.status NOT IN ('confirmed','rejected')
      AND x.created_at<=m.placed_at AND x.created_at>=m.placed_at-interval '14 days'
    ORDER BY x.id FOR UPDATE
  LOOP
    ids:=array_append(ids,d.id);
  END LOOP;
  IF coalesce(cardinality(ids),0)=0 THEN RETURN jsonb_build_object('status','no_draft'); END IF;
  IF owners>1 OR cardinality(ids)>1 THEN
    IF already->>'status'='needs_review' AND already->'draft_ids'=to_jsonb(ids)
      AND already->>'reason'=(CASE WHEN owners>1 THEN 'identity_conflict' ELSE 'multiple_drafts' END) THEN RETURN already; END IF;
    result:=jsonb_build_object('status','needs_review','reason',CASE WHEN owners>1 THEN 'identity_conflict' ELSE 'multiple_drafts' END,
      'order_id',m.id,'order_sn',m.order_sn,'draft_ids',ids,'detected_at',now());
    UPDATE public.qrpay_order_drafts SET evidence=evidence||jsonb_build_object('shopee_match',result),
      followup_enabled=false,followup_paused_at=now(),next_followup_at=null,updated_at=now()
      WHERE id=ANY(ids) AND evidence->'shopee_match' IS DISTINCT FROM result;
    UPDATE public.notification_queue SET status='cancelled',processed_at=now(),locked_at=null,
      decision_reason='shopee_draft_match_review',last_error='Shopee match requires admin review'
      WHERE status IN ('pending','processing') AND event_type LIKE 'draft_followup_%'
        AND payload->>'draft_id'=ANY(SELECT unnest(ids)::text);
  ELSE
    SELECT * INTO d FROM public.qrpay_order_drafts WHERE id=ids[1];
    PERFORM 1 FROM public.payment_sessions WHERE draft_id=d.id ORDER BY id FOR UPDATE;
    eligible:=d.payment_mode='prepaid' AND d.source_type<>'qrpay_payment'
      AND d.customer_link_sent_at IS NOT NULL AND d.transaction_id IS NULL
      AND d.qrpay_job_id IS NULL AND d.unmatched_payment_id IS NULL
      AND d.payment_received_at IS NULL AND coalesce(d.payment_amount,0)=0
      AND d.payment_status IN ('pending','unpaid','not_required','expired')
      AND NOT EXISTS(SELECT 1 FROM public.payment_sessions s WHERE s.draft_id=d.id
        AND (s.transaction_id IS NOT NULL OR s.matched_at IS NOT NULL OR s.submitted_at IS NOT NULL
          OR s.receipt_path IS NOT NULL OR s.status IN ('matched','paid','submitted','receipt_submitted','pending_review')))
      AND NOT EXISTS(SELECT 1 FROM public.payment_transactions t JOIN public.payment_sessions s ON s.id=t.payment_session_id WHERE s.draft_id=d.id);
    IF NOT coalesce(eligible,false) THEN RETURN jsonb_build_object('status','protected_draft','draft_id',d.id); END IF;
    PERFORM public.icetak_admin_cancel_draft(d.review_token,'customer_order_shopee',
      'Customer order Shopee · Order ID: '||m.order_sn,'automation','automation');
    UPDATE public.payment_sessions SET status='cancelled',expires_at=least(coalesce(expires_at,now()),now())
      WHERE draft_id=d.id AND status IN ('pending','expired','superseded');
    result:=jsonb_build_object('status','cancelled','order_id',m.id,'order_sn',m.order_sn,'draft_ids',ids,
      'match_method','exact_normalized_phone','detected_at',now());
    UPDATE public.qrpay_order_drafts SET evidence=evidence||jsonb_build_object('shopee_match',result) WHERE id=d.id;
    INSERT INTO public.qrpay_order_draft_events(draft_id,event_type,actor,metadata)
      VALUES(d.id,'shopee_order_auto_cancelled','automation',result);
  END IF;
  UPDATE public.marketplace_orders SET metadata=metadata||jsonb_build_object('draft_match',result) WHERE id=m.id;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.icetak_match_shopee_draft(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.icetak_match_shopee_draft(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.icetak_shopee_draft_order_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.payment_status,NEW.current_status,NEW.buyer_customer_id,NEW.raw_detail,NEW.placed_at)
    IS NOT DISTINCT FROM (OLD.payment_status,OLD.current_status,OLD.buyer_customer_id,OLD.raw_detail,OLD.placed_at) THEN RETURN NEW; END IF;
  PERFORM public.icetak_match_shopee_draft(NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.icetak_shopee_draft_order_trigger() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.icetak_shopee_draft_order_trigger() TO service_role;
CREATE CONSTRAINT TRIGGER zz_shopee_draft_match_order
  AFTER INSERT OR UPDATE
  ON public.marketplace_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.icetak_shopee_draft_order_trigger();

CREATE OR REPLACE FUNCTION public.icetak_shopee_draft_identity_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE x record; master_id uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='customer_master' THEN
      IF NEW.primary_phone_normalized IS NOT DISTINCT FROM OLD.primary_phone_normalized THEN RETURN NEW; END IF;
    ELSIF TG_TABLE_NAME='marketplace_customers' THEN
      IF NEW.customer_master_id IS NOT DISTINCT FROM OLD.customer_master_id THEN RETURN NEW; END IF;
    ELSE
      IF (NEW.normalized_value,NEW.is_verified,NEW.customer_master_id) IS NOT DISTINCT FROM
        (OLD.normalized_value,OLD.is_verified,OLD.customer_master_id) THEN RETURN NEW; END IF;
    END IF;
  END IF;
  master_id:=CASE WHEN TG_TABLE_NAME='customer_master' THEN (to_jsonb(NEW)->>'id')::uuid ELSE (to_jsonb(NEW)->>'customer_master_id')::uuid END;
  FOR x IN SELECT m.id FROM public.marketplace_orders m JOIN public.marketplace_customers mc ON mc.id=m.buyer_customer_id
    WHERE mc.customer_master_id=master_id AND m.provider='shopee'
      AND m.created_at>='2026-10-09 05:13:02+00' AND m.placed_at>=now()-interval '14 days'
      AND coalesce(m.metadata#>>'{draft_match,status}','')<>'cancelled'
    ORDER BY m.placed_at DESC LIMIT 100
  LOOP PERFORM public.icetak_match_shopee_draft(x.id); END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.icetak_shopee_draft_identity_trigger() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.icetak_shopee_draft_identity_trigger() TO service_role;
CREATE CONSTRAINT TRIGGER zz_shopee_draft_match_master
  AFTER INSERT OR UPDATE ON public.customer_master
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.icetak_shopee_draft_identity_trigger();
CREATE CONSTRAINT TRIGGER zz_shopee_draft_match_customer
  AFTER INSERT OR UPDATE ON public.marketplace_customers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.icetak_shopee_draft_identity_trigger();
CREATE CONSTRAINT TRIGGER zz_shopee_draft_match_identifier
  AFTER INSERT OR UPDATE ON public.customer_identifiers_master
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.icetak_shopee_draft_identity_trigger();

-- Generic protection against stale customer/admin mutations resurrecting a
-- cancelled quote. Explicit admin Reopen clears the reason and remains allowed.
CREATE OR REPLACE FUNCTION public.icetak_guard_cancelled_draft_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF OLD.status='rejected' AND NEW.status<>'rejected' AND NEW.cancel_reason_code IS NOT NULL THEN
    RAISE EXCEPTION 'Draft telah dibatalkan. Sila hubungi admin.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.icetak_guard_cancelled_draft_transition() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.icetak_guard_cancelled_draft_transition() TO service_role;
CREATE TRIGGER aaa_guard_cancelled_draft_transition BEFORE UPDATE OF status ON public.qrpay_order_drafts
  FOR EACH ROW EXECUTE FUNCTION public.icetak_guard_cancelled_draft_transition();

CREATE OR REPLACE FUNCTION public.icetak_guard_cancelled_draft_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.draft_id IS NOT NULL AND NEW.status NOT IN ('cancelled','expired','superseded')
    AND EXISTS(SELECT 1 FROM public.qrpay_order_drafts WHERE id=NEW.draft_id AND status='rejected') THEN
    RAISE EXCEPTION 'Draft telah dibatalkan. Sila hubungi admin.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.icetak_guard_cancelled_draft_payment() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.icetak_guard_cancelled_draft_payment() TO service_role;
CREATE TRIGGER aaa_guard_cancelled_draft_payment BEFORE INSERT OR UPDATE ON public.payment_sessions
  FOR EACH ROW EXECUTE FUNCTION public.icetak_guard_cancelled_draft_payment();
CREATE OR REPLACE FUNCTION public.icetak_customer_confirm_draft_legacy_v17(p_customer_token text, p_customer jsonb DEFAULT '{}'::jsonb, p_actor text DEFAULT 'customer-link'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d public.qrpay_order_drafts%rowtype;
  work jsonb;
  r jsonb;
  v_delivery text;
  v_address text;
  v_postcode text;
  v_city text;
  v_state text;
  v_address_id uuid;
  v_phone text;
begin
  select * into d from public.qrpay_order_drafts where customer_review_token=p_customer_token for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.status='rejected' then raise exception 'Draft telah dibatalkan. Sila hubungi admin.'; end if;
  if d.admin_approved_at is null then raise exception 'draft_not_ready'; end if;
  if d.status='confirmed' then return jsonb_build_object('success',true,'already_confirmed',true,'order_id',d.order_no); end if;

  work:=d.working_draft;
  if coalesce(p_customer,'{}'::jsonb)<>'{}'::jsonb then
    if p_customer ? 'address_id' then
      if nullif(btrim(coalesce(p_customer->>'address_id','')),'') is null then
        work:=work-'address_id';
      else
        v_address_id:=(p_customer->>'address_id')::uuid;
        v_phone:=public.icetak_normalize_phone(coalesce(p_customer->>'phone',work#>>'{customer,phone}',d.customer_phone,''));
        if not exists(
          select 1
          from public.customer_addresses a
          where a.id=v_address_id
            and a.archived_at is null
            and (
              public.icetak_normalize_phone(a.phone)=v_phone
              or exists(select 1 from public.customers c where c.customer_master_id=a.customer_master_id and public.icetak_normalize_phone(c.phone)=v_phone)
              or exists(select 1 from public.customers c where c.id=a.customer_id and public.icetak_normalize_phone(c.phone)=v_phone)
            )
        ) then
          raise exception 'Saved address does not belong to this customer';
        end if;
        work:=jsonb_set(work,'{address_id}',to_jsonb(v_address_id::text),true);
      end if;
    end if;
    work=jsonb_set(work,'{customer}',coalesce(work->'customer','{}'::jsonb)||p_customer,true);
  end if;

  v_delivery:=lower(coalesce(work->>'delivery',''));
  v_address:=btrim(coalesce(work#>>'{customer,address_line1}',''));
  v_postcode:=regexp_replace(coalesce(work#>>'{customer,postcode}',''),'[^0-9]','','g');
  v_city:=btrim(coalesce(work#>>'{customer,city}',''));
  v_state:=btrim(coalesce(work#>>'{customer,state}',''));

  if v_delivery not in ('pickup','spx','jnt','ninja') then raise exception 'Shipping / Pickup required'; end if;
  if v_delivery<>'pickup' then
    v_phone:=public.icetak_normalize_phone(coalesce(work#>>'{customer,phone}',d.customer_phone,''));
    if v_phone !~ '^60[1-9][0-9]{7,10}$' then raise exception 'Valid recipient phone required for courier delivery'; end if;
    if length(regexp_replace(v_address,'[^[:alnum:]]','','g')) < 3
       or v_postcode !~ '^[0-9]{5}$'
       or length(regexp_replace(v_city,'[^[:alnum:]]','','g')) < 2
       or length(regexp_replace(v_state,'[^[:alnum:]]','','g')) < 2 then
      raise exception 'Complete valid delivery address required';
    end if;
  end if;

  update public.qrpay_order_drafts
  set working_draft=work,customer_status='confirmed',customer_confirmed_at=now(),status='customer_confirmed',updated_at=now(),version=version+1
  where id=d.id;
  update public.order_sessions set status='customer_confirmed',updated_at=now() where id=d.order_session_id;
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data)
  values(d.id,'customer_confirmed',p_actor,d.working_draft,work);

  if not d.payment_required then
    r:=public.icetak_finalize_generic_order_draft(d.id,p_actor);
    return jsonb_build_object('success',true,'payment_required',false,'order',r);
  end if;
  return jsonb_build_object('success',true,'payment_required',true,'draft_id',d.id,'customer_token',d.customer_review_token);
end
$function$
;

CREATE OR REPLACE FUNCTION public.icetak_prepare_draft_payment(p_customer_token text, p_force_new boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d public.qrpay_order_drafts%rowtype;
  sid uuid;
  exp timestamptz;
  selected numeric;
  off integer;
  selected_off integer:=0;
  found_slot boolean:=false;
  old public.payment_sessions%rowtype;
  snapshot jsonb;
  delivery_code text;
begin
  select * into d
  from public.qrpay_order_drafts
  where customer_review_token=p_customer_token
  for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.status='rejected' then raise exception 'Draft telah dibatalkan. Sila hubungi admin.'; end if;
  if d.admin_approved_at is null then raise exception 'draft_not_ready_for_customer'; end if;
  if d.customer_status not in ('confirmed','awaiting_payment') then raise exception 'customer_must_confirm_first'; end if;
  if not d.payment_required then return jsonb_build_object('payment_required',false,'status',d.payment_status); end if;
  if d.payment_status='paid' then
    return jsonb_build_object(
      'payment_required',true,'status','matched','draft_id',d.id,
      'baseAmount',d.draft_total,'expectedAmount',d.draft_total
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('icetak_payment_amount_allocator',0));

  update public.payment_sessions
  set status='expired'
  where draft_id=d.id and status='pending'
    and expires_at<=now()-make_interval(secs=>coalesce(reservation_grace_seconds,120));

  delivery_code:=lower(coalesce(d.working_draft->>'delivery',''));
  snapshot:=jsonb_build_object(
    'draft_version',d.version,
    'item_subtotal',d.item_subtotal,
    'shipping_fee',d.shipping_fee,
    'draft_total',d.draft_total,
    'delivery',delivery_code,
    'price_adjustments',coalesce(d.working_draft->'price_adjustments','{}'::jsonb)
  );

  if not p_force_new then
    select * into old
    from public.payment_sessions
    where draft_id=d.id
      and status in ('pending','submitted','receipt_submitted','pending_review')
      and expires_at>now()
    order by created_at desc
    limit 1;

    if found and (
      old.base_amount is distinct from d.draft_total
      or old.draft_version is distinct from d.version
      or coalesce(old.delivery_code,'') is distinct from delivery_code
    ) then
      update public.payment_sessions set status='superseded' where id=old.id;
      old:=null;
    end if;
  end if;

  if old.id is not null then
    sid:=old.id;
    exp:=old.expires_at;
    selected:=old.expected_amount;
    selected_off:=coalesce(old.amount_offset_cents,0);
  else
    for off in 0..50 loop
      selected:=round(d.draft_total-(off::numeric/100),2);
      if selected>0 and not exists(
        select 1
        from public.payment_sessions ps
        where ps.expected_amount=selected
          and ps.status in ('pending','submitted','receipt_submitted','pending_review')
          and ps.expires_at>now()-make_interval(secs=>coalesce(ps.reservation_grace_seconds,120))
      ) then
        found_slot:=true;
        selected_off:=off;
        exit;
      end if;
    end loop;
    if not found_slot then
      raise exception 'Payment amount slots are temporarily full. Please try again in 2 minutes.';
    end if;

    insert into public.payment_sessions(
      draft_id,purpose,base_amount,expected_amount,discount,amount_offset_cents,
      reservation_grace_seconds,status,expires_at,order_token,draft_version,
      pricing_snapshot,delivery_code,shipping_fee_snapshot
    ) values(
      d.id,'draft_checkout',d.draft_total,selected,round(d.draft_total-selected,2),selected_off,
      120,'pending',now()+interval '10 minutes',d.customer_review_token,d.version,
      snapshot,delivery_code,d.shipping_fee
    ) returning id,expires_at into sid,exp;
  end if;

  update public.qrpay_order_drafts
  set payment_session_id=sid,payment_status='pending',customer_status='awaiting_payment',
      status='awaiting_payment',updated_at=now()
  where id=d.id;
  update public.order_sessions
  set status='awaiting_payment',updated_at=now()
  where id=d.order_session_id;

  return jsonb_build_object(
    'id',sid,'draft_id',d.id,'baseAmount',d.draft_total,'expectedAmount',selected,
    'discount',round(d.draft_total-selected,2),'amountOffsetCents',selected_off,
    'expiresAt',extract(epoch from exp)*1000,'status','pending','draftVersion',d.version,
    'delivery',delivery_code,'shippingFee',d.shipping_fee
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.icetak_finalize_generic_order_draft(p_draft_id uuid, p_actor text DEFAULT 'draft-engine'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d public.qrpay_order_drafts%rowtype;
  normalized_draft jsonb;
  payload jsonb;
  r jsonb;
  oid uuid;
  ono text;
  outbox uuid;
  pm text;
  v_group_id uuid;
begin
  select * into d from public.qrpay_order_drafts where id=p_draft_id for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.status='rejected' then raise exception 'Draft telah dibatalkan. Sila hubungi admin.'; end if;
  if d.order_id is not null then return jsonb_build_object('success',true,'duplicate',true,'order_db_id',d.order_id,'order_id',d.order_no); end if;
  if d.admin_approved_at is null then raise exception 'admin_approval_required'; end if;
  if d.customer_confirmed_at is null and d.payment_mode not in ('prepaid_external','already_paid') then raise exception 'customer_confirmation_required'; end if;
  if d.payment_required and d.payment_status<>'paid' then raise exception 'payment_required'; end if;

  pm:=case when d.payment_mode in ('cash_counter','cash_at_counter') then 'Cash at Counter' else 'Paid' end;
  normalized_draft:=public.icetak_clean_draft_address_v14(coalesce(d.working_draft,'{}'::jsonb));

  update public.qrpay_order_drafts
    set working_draft=normalized_draft, updated_at=now()
    where id=d.id;

  payload:=normalized_draft||jsonb_build_object(
    'payment',pm,'total',d.draft_total,'delivery_fee',d.shipping_fee,'source','draft_engine',
    'created_by',p_actor,'notify_whatsapp',coalesce((normalized_draft->>'notify_whatsapp')::boolean,false),'external_order_id','draft:'||d.id::text
  );

  r:=public.icetak_create_order(payload);
  oid=nullif(r->>'order_db_id','')::uuid;
  if oid is null then select id into oid from public.orders where external_order_id='draft:'||d.id::text limit 1; end if;
  if oid is null then raise exception 'order_creation_failed'; end if;
  select coalesce(order_no,order_id) into ono from public.orders where id=oid;

  update public.orders set
    customer_confirmed=true,
    customer_confirmed_at=coalesce(customer_confirmed_at,now()),
    production_approved=true,
    payment_method=case when pm='Paid' then 'Draft Checkout QR Pay' else pm end,
    payment_status=case when pm='Paid' then 'paid' else 'cash_counter' end,
    payment=pm,
    status='Ready to Process',
    admin_status='Ready to Process',
    tab='progress',
    updated_at=now()
  where id=oid;

  if d.payment_session_id is not null then update public.payment_sessions set order_id=oid where id=d.payment_session_id; end if;
  update public.payment_transactions set order_id=oid where payment_session_id=d.payment_session_id and order_id is null;
  outbox:=public.enqueue_clickup_production_order(oid);

  update public.qrpay_order_drafts set
    status='confirmed',customer_status='confirmed',working_draft=normalized_draft,confirmed_draft=normalized_draft,
    confirmed_at=now(),confirmed_by=p_actor,converted_at=now(),order_id=oid,order_no=ono,last_error=null,
    version=version+1,updated_at=now()
  where id=d.id;

  update public.order_sessions set status='converted',closed_at=now(),closed_reason='order_created',order_id=oid,updated_at=now()
  where id=d.order_session_id;

  if d.combine_with_order_id is not null then
    select fgo.fulfillment_group_id into v_group_id
    from public.fulfillment_group_orders fgo
    join public.fulfillment_groups fg on fg.id=fgo.fulfillment_group_id
    where fgo.order_id=d.combine_with_order_id and fg.status in ('open','packing','awb_created')
    order by fg.created_at desc limit 1;
    if v_group_id is null then
      insert into public.fulfillment_groups(master_order_id,status,metadata)
      values(d.combine_with_order_id,'open',jsonb_build_object('source','draft_addon')) returning id into v_group_id;
      insert into public.fulfillment_group_orders(fulfillment_group_id,order_id,role)
      values(v_group_id,d.combine_with_order_id,'master') on conflict do nothing;
    end if;
    insert into public.fulfillment_group_orders(fulfillment_group_id,order_id,role)
    values(v_group_id,oid,'addon') on conflict do nothing;
  end if;

  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data,metadata)
  values(d.id,'draft_converted_to_order',p_actor,d.working_draft,normalized_draft,
    jsonb_build_object('order_id',oid,'order_no',ono,'outbox_id',outbox,'fulfillment_group_id',v_group_id));

  return r||jsonb_build_object('success',true,'draft_id',d.id,'order_db_id',oid,'order_id',ono,'outbox_id',outbox,'fulfillment_group_id',v_group_id);
end
$function$
;

CREATE OR REPLACE FUNCTION public.icetak_customer_request_draft_change(p_customer_token text, p_note text, p_actor text DEFAULT 'customer-link'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d public.qrpay_order_drafts%rowtype;
begin select * into d from public.qrpay_order_drafts where customer_review_token=p_customer_token for update; if not found then raise exception 'draft_not_found'; end if;
  if d.status='rejected' then raise exception 'Draft telah dibatalkan. Sila hubungi admin.'; end if; update public.qrpay_order_drafts set customer_status='change_requested',status='change_requested',customer_change_requested_at=now(),updated_at=now() where id=d.id; insert into public.qrpay_order_draft_events(draft_id,event_type,actor,metadata) values(d.id,'customer_change_requested',p_actor,jsonb_build_object('note',left(coalesce(p_note,''),1000))); return jsonb_build_object('success',true,'status','change_requested'); end $function$
;

CREATE OR REPLACE FUNCTION public.finance_admin_draft_orders(p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with rows as materialized (
 select * from public.qrpay_order_drafts d where d.order_id is null
 and ((p_status='rejected' and d.status='rejected') or (coalesce(p_status,'')<>'rejected' and d.status not in ('confirmed','rejected') and (nullif(btrim(coalesce(p_status,'')),'') is null or d.status=p_status)))
 and (nullif(btrim(coalesce(p_query,'')),'') is null or d.id::text ilike '%'||btrim(p_query)||'%' or coalesce(d.customer_name,'') ilike '%'||btrim(p_query)||'%' or (regexp_replace(p_query,'[^0-9]','','g')<>'' and coalesce(d.customer_phone,'') ilike '%'||regexp_replace(p_query,'[^0-9]','','g')||'%') or coalesce(d.transaction_id,'') ilike '%'||btrim(p_query)||'%')
 order by coalesce(d.rejected_at,d.updated_at) desc limit least(greatest(coalesce(p_limit,100),1),300)
)
select jsonb_build_object('counts',jsonb_build_object(
 'all',(select count(*) from public.qrpay_order_drafts d where d.order_id is null and d.status not in ('confirmed','rejected')),
 'linked',(select count(*) from public.qrpay_order_drafts d where d.order_id is null and d.status not in ('confirmed','rejected') and d.transaction_id is not null),
 'unlinked',(select count(*) from public.qrpay_order_drafts d where d.order_id is null and d.status not in ('confirmed','rejected') and d.transaction_id is null),
 'cancelled',(select count(*) from public.qrpay_order_drafts d where d.order_id is null and d.status='rejected')),
 'reasons',(select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order),'[]'::jsonb) from public.draft_cancel_reasons r where r.enabled),
 'drafts',coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'source_type',source_type,'customer_name',customer_name,'customer_phone',customer_phone,'customer_bsuid',coalesce(working_draft#>>'{whatsapp_identity,bsuid}',evidence#>>'{whatsapp_identity,bsuid}'),'customer_username',coalesce(working_draft#>>'{whatsapp_identity,username}',evidence#>>'{whatsapp_identity,username}'),'conversation_id',conversation_id,'draft_total',draft_total,'payment_status',payment_status,'payment_required',payment_required,'payment_mode',payment_mode,'transaction_id',transaction_id,'payment_amount',payment_amount,'review_token',review_token,'admin_approved_at',admin_approved_at,'customer_confirmed_at',customer_confirmed_at,'date_need',working_draft->>'date_need','delivery',working_draft->>'delivery','item_count',jsonb_array_length(coalesce(working_draft->'items','[]'::jsonb)),'created_at',created_at,'updated_at',updated_at,'rejected_at',rejected_at,'rejected_by',rejected_by,'cancel_reason_code',cancel_reason_code,'cancel_reason_detail',cancel_reason_detail,'cancel_source',cancel_source,'shopee_match',evidence->'shopee_match','followup_count',followup_count,'payment_available',case when transaction_id is null then null else exists(select 1 from public.unmatched_payment_transactions u where u.transaction_id=rows.transaction_id) end) order by coalesce(rejected_at,updated_at) desc),'[]'::jsonb)) from rows;
$function$
;
