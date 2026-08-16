-- Payment webhook hardening, 2026-08-17
-- 1) Normalize Malaysian state names before order finalization.
-- 2) Persist matched payment even when downstream order creation fails.
-- 3) Return a successful webhook acknowledgement for recorded payments instead of propagating order errors.

create or replace function public.icetak_clean_draft_address_v14(p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $function$
declare
  v jsonb:=coalesce(p_payload,'{}'::jsonb);
  raw text:=btrim(coalesce(v#>>'{customer,address_line1}',''));
  clean text:='';
  line text;
  digits text;
  pc text:='';
  city text:=btrim(coalesce(v#>>'{customer,city}',''));
  state text:=btrim(coalesce(v#>>'{customer,state}',''));
  state_key text;
  m text[];
begin
  state:=btrim(regexp_replace(state,'[[:space:][:punct:]]+$','','g'));
  state_key:=lower(regexp_replace(state,'\s+',' ','g'));
  state:=case state_key
    when 'johor' then 'Johor'
    when 'kedah' then 'Kedah'
    when 'kelantan' then 'Kelantan'
    when 'melaka' then 'Melaka'
    when 'malacca' then 'Melaka'
    when 'negeri sembilan' then 'Negeri Sembilan'
    when 'pahang' then 'Pahang'
    when 'perak' then 'Perak'
    when 'perlis' then 'Perlis'
    when 'pulau pinang' then 'Pulau Pinang'
    when 'penang' then 'Pulau Pinang'
    when 'sabah' then 'Sabah'
    when 'sarawak' then 'Sarawak'
    when 'selangor' then 'Selangor'
    when 'terengganu' then 'Terengganu'
    when 'kuala lumpur' then 'Kuala Lumpur'
    when 'wilayah persekutuan kuala lumpur' then 'Kuala Lumpur'
    when 'labuan' then 'Labuan'
    when 'wilayah persekutuan labuan' then 'Labuan'
    when 'putrajaya' then 'Putrajaya'
    when 'wilayah persekutuan putrajaya' then 'Putrajaya'
    else state
  end;

  if raw='' then
    v:=jsonb_set(v,'{customer}',coalesce(v->'customer','{}'::jsonb)||jsonb_build_object('state',state),true);
    return v;
  end if;

  for line in select btrim(x) from regexp_split_to_table(raw,E'\n+') x loop
    if line='' then continue; end if;
    digits:=regexp_replace(line,'[^0-9]','','g');
    if digits ~ '^(?:60)?1[0-9]{8,9}$' or digits ~ '^01[0-9]{8,9}$' then continue; end if;
    clean:=concat_ws(E'\n',clean,line);
  end loop;
  clean:=btrim(clean);

  select (regexp_match(clean,'(^|[^0-9])([0-9]{5})([^0-9]|$)'))[2] into pc;
  pc:=coalesce(pc,'');

  if pc<>'' then
    m:=regexp_match(clean,pc||'[[:space:]]+([^,\n]{2,50})','i');
    if m is not null then city:=initcap(btrim(m[1])); end if;
    if state<>'' then city:=btrim(regexp_replace(city,'(?i)[[:space:]]*'||state||'[[:space:]]*$','','g')); end if;
  else
    city:='';
  end if;

  v:=jsonb_set(v,'{customer}',coalesce(v->'customer','{}'::jsonb)||jsonb_build_object(
    'address_line1',clean,'postcode',pc,'city',city,'state',state
  ),true);
  return v;
end
$function$;

create or replace function public.icetak_finalize_generic_order_draft(p_draft_id uuid, p_actor text default 'draft-engine'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
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
  if d.order_id is not null then return jsonb_build_object('success',true,'duplicate',true,'order_db_id',d.order_id,'order_id',d.order_no); end if;
  if d.admin_approved_at is null then raise exception 'admin_approval_required'; end if;
  if d.customer_confirmed_at is null and d.payment_mode not in ('prepaid_external','already_paid') then raise exception 'customer_confirmation_required'; end if;
  if d.payment_required and d.payment_status<>'paid' then raise exception 'payment_required'; end if;

  pm:=case when d.payment_mode in ('cash_counter','cash_at_counter') then 'Cash at Counter' else 'Paid' end;
  normalized_draft:=public.icetak_clean_draft_address_v14(coalesce(d.working_draft,'{}'::jsonb));

  update public.qrpay_order_drafts set working_draft=normalized_draft,updated_at=now() where id=d.id;

  payload:=normalized_draft||jsonb_build_object(
    'payment',pm,'total',d.draft_total,'delivery_fee',d.shipping_fee,'source','draft_engine',
    'created_by',p_actor,'notify_whatsapp',false,'external_order_id','draft:'||d.id::text
  );

  r:=public.icetak_create_order(payload);
  oid=nullif(r->>'order_db_id','')::uuid;
  if oid is null then select id into oid from public.orders where external_order_id='draft:'||d.id::text limit 1; end if;
  if oid is null then raise exception 'order_creation_failed'; end if;
  select coalesce(order_no,order_id) into ono from public.orders where id=oid;

  update public.orders set
    customer_confirmed=true,customer_confirmed_at=coalesce(customer_confirmed_at,now()),production_approved=true,
    payment_method=case when pm='Paid' then 'Draft Checkout QR Pay' else pm end,
    payment_status=case when pm='Paid' then 'paid' else 'cash_counter' end,
    payment=pm,status='Ready to Process',admin_status='Ready to Process',tab='progress',updated_at=now()
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
$function$;

create or replace function public.icetak_payment_webhook(p_payload jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  a numeric; tx text; sid uuid; oid uuid; did uuid; ono text; tok text;
  candidate_count integer:=0; existing_sid uuid; existing_oid uuid; existing_did uuid;
  v_order public.orders%rowtype; v_draft public.qrpay_order_drafts%rowtype;
  v_has_linked boolean:=false; v_final jsonb; v_paid_at timestamptz:=now();
  v_finalize_error text; v_order_created boolean:=false;
begin
  begin a:=round((p_payload->>'amount')::numeric,2);
  exception when others then return jsonb_build_object('success',false,'matched',false,'reason','invalid_amount'); end;
  if a is null or a<=0 then return jsonb_build_object('success',false,'matched',false,'reason','invalid_amount'); end if;
  tx:=coalesce(nullif(btrim(p_payload->>'transaction_id'),''),'payload_'||md5(p_payload::text));
  begin v_paid_at:=coalesce(nullif(p_payload->>'paid_at','')::timestamptz,now()); exception when others then v_paid_at:=now(); end;

  select ps.id,ps.order_id,ps.draft_id into existing_sid,existing_oid,existing_did
  from public.payment_sessions ps where ps.transaction_id=tx and ps.status='matched' limit 1;
  if existing_sid is not null then
    if existing_oid is not null then
      select order_no,public_token into ono,tok from public.orders where id=existing_oid;
      return jsonb_build_object('success',true,'matched',true,'already_processed',true,'order_id',ono,'order_token',tok,'amount',a,'transaction_id',tx);
    end if;
    if existing_did is not null then
      select order_no into ono from public.qrpay_order_drafts where id=existing_did;
      return jsonb_build_object('success',true,'matched',true,'already_processed',true,'draft_id',existing_did,'order_id',ono,'amount',a,'transaction_id',tx);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('icetak_payment_amount_allocator',0));
  select count(*),
         (array_agg(ps.id order by ps.expires_at desc,ps.created_at desc))[1],
         (array_agg(ps.order_id order by ps.expires_at desc,ps.created_at desc))[1],
         (array_agg(ps.draft_id order by ps.expires_at desc,ps.created_at desc))[1]
  into candidate_count,sid,oid,did
  from public.payment_sessions ps
  where ps.expected_amount=a
    and ps.status in ('pending','submitted','receipt_submitted','pending_review')
    and ps.expires_at is not null
    and ps.expires_at>now()-make_interval(secs=>coalesce(ps.reservation_grace_seconds,120));

  if candidate_count=0 then
    if not exists(select 1 from public.unmatched_payment_transactions where transaction_id=tx) then
      insert into public.unmatched_payment_transactions(provider,transaction_id,amount,paid_at,sender_name,raw_payload)
      values(coalesce(p_payload->>'provider','webhook'),tx,a,v_paid_at,coalesce(p_payload->>'sender_name',''),p_payload||jsonb_build_object('_match_reason','no_pending_session'));
    end if;
    return jsonb_build_object('success',true,'matched',false,'reason','no_pending_session','amount',a,'transaction_id',tx,'payment_recorded',true);
  end if;

  if candidate_count>1 then
    if not exists(select 1 from public.unmatched_payment_transactions where transaction_id=tx) then
      insert into public.unmatched_payment_transactions(provider,transaction_id,amount,paid_at,sender_name,raw_payload)
      values(coalesce(p_payload->>'provider','webhook'),tx,a,v_paid_at,coalesce(p_payload->>'sender_name',''),p_payload||jsonb_build_object('_match_reason','ambiguous_amount','candidate_count',candidate_count));
    end if;
    return jsonb_build_object('success',true,'matched',false,'reason','ambiguous_amount','candidate_count',candidate_count,'amount',a,'transaction_id',tx,'payment_recorded',true);
  end if;

  if did is not null and oid is null then
    select * into v_draft from public.qrpay_order_drafts where id=did for update;
    if not found then
      if not exists(select 1 from public.unmatched_payment_transactions where transaction_id=tx) then
        insert into public.unmatched_payment_transactions(provider,transaction_id,amount,paid_at,sender_name,raw_payload)
        values(coalesce(p_payload->>'provider','webhook'),tx,a,v_paid_at,coalesce(p_payload->>'sender_name',''),p_payload||jsonb_build_object('_match_reason','draft_missing'));
      end if;
      return jsonb_build_object('success',true,'matched',false,'reason','draft_missing','amount',a,'transaction_id',tx,'payment_recorded',true);
    end if;

    update public.payment_sessions set status='matched',transaction_id=tx,matched_at=now() where id=sid;
    insert into public.payment_transactions(order_id,payment_session_id,provider,transaction_id,amount,paid_at,sender_name,raw_payload)
    values(null,sid,coalesce(p_payload->>'provider','webhook'),tx,a,v_paid_at,coalesce(p_payload->>'sender_name',''),p_payload||jsonb_build_object('draft_id',did,'direct_draft_match',true))
    on conflict(transaction_id) do nothing;
    update public.qrpay_order_drafts
      set transaction_id=tx,provider=coalesce(p_payload->>'provider','webhook'),payment_amount=a,payment_received_at=v_paid_at,
          payment_snapshot=coalesce(payment_snapshot,'{}'::jsonb)||p_payload,payment_status='paid',status='paid',last_error=null,updated_at=now()
      where id=did;
    update public.order_sessions set status='paid',updated_at=now() where id=v_draft.order_session_id;
    insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data,metadata)
    values(did,'payment_matched','payment_webhook',v_draft.working_draft,v_draft.working_draft,
      jsonb_build_object('payment_session_id',sid,'transaction_id',tx,'amount',a,'base_amount',v_draft.draft_total));

    if v_draft.admin_approved_at is not null and v_draft.customer_confirmed_at is not null then
      begin
        v_final:=public.icetak_finalize_generic_order_draft(did,'payment_webhook');
        ono:=v_final->>'order_id';
        v_order_created:=coalesce((v_final->>'success')::boolean,false);
      exception when others then
        v_finalize_error:=sqlerrm;
        update public.qrpay_order_drafts set last_error=v_finalize_error,updated_at=now() where id=did;
        insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data,metadata)
        values(did,'order_finalize_failed','payment_webhook',v_draft.working_draft,v_draft.working_draft,
          jsonb_build_object('payment_session_id',sid,'transaction_id',tx,'amount',a,'error',v_finalize_error));
      end;
    end if;

    return jsonb_build_object('success',true,'matched',true,'draft_match',true,'draft_id',did,'order_id',ono,
      'amount',a,'transaction_id',tx,'payment_session_id',sid,'payment_recorded',true,
      'order_created',v_order_created,'finalize_error',v_finalize_error);
  end if;

  select * into v_order from public.orders where id=oid for update;
  select exists(select 1 from public.production_components pc where pc.order_id=oid and pc.clickup_task_id is not null) into v_has_linked;
  ono:=coalesce(v_order.order_no,v_order.order_id); tok:=v_order.public_token;
  update public.payment_sessions set status='matched',transaction_id=tx,matched_at=now() where id=sid;
  insert into public.payment_transactions(order_id,payment_session_id,provider,transaction_id,amount,paid_at,sender_name,raw_payload)
  values(oid,sid,coalesce(p_payload->>'provider','webhook'),tx,a,v_paid_at,coalesce(p_payload->>'sender_name',''),p_payload)
  on conflict(transaction_id) do nothing;
  update public.orders set payment_status='paid',payment='Paid',payment_method='QR Pay',payment_transaction_id=tx,
    payment_verified_at=coalesce(payment_verified_at,now()),payment_verified_by=coalesce(nullif(p_payload->>'provider',''),'payment_webhook'),
    status=case when coalesce(v_order.production_approved,false) or v_has_linked or lower(coalesce(v_order.fulfillment_stage,'')) in ('production','ready_for_pickup','ready_to_ship','in_transit','delivery_issue','collected','delivered','completed') or lower(coalesce(v_order.status,'')) in ('completed','delivered','customer collected') or lower(coalesce(v_order.status,'')) like '%ready%pickup%' then v_order.status else 'Payment Received' end,
    admin_status=case when v_order.pickup_collected_at is not null then 'Customer Collected' when v_order.pickup_ready_at is not null or lower(coalesce(v_order.fulfillment_stage,''))='ready_for_pickup' then 'Ready for Pickup' else 'Ready to Process' end,
    tab=case when v_order.pickup_collected_at is not null or lower(coalesce(v_order.fulfillment_stage,'')) in ('collected','delivered','completed') then 'completed' when v_order.pickup_ready_at is not null or lower(coalesce(v_order.fulfillment_stage,''))='ready_for_pickup' then 'receive' else 'progress' end,
    updated_at=now() where id=oid;
  return jsonb_build_object('success',true,'matched',true,'order_id',ono,'order_token',tok,'amount',a,'transaction_id',tx,'payment_session_id',sid,'payment_recorded',true,'order_created',true);
end
$function$;
