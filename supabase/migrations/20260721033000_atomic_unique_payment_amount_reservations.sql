-- One exact DuitNow amount may belong to only one matchable payment session.
-- Customer-visible window: 10 minutes. Internal webhook grace: 120 seconds.

alter table public.payment_sessions
  add column if not exists amount_offset_cents integer not null default 0,
  add column if not exists reservation_grace_seconds integer not null default 120;

update public.payment_sessions
set amount_offset_cents = greatest(0, round(coalesce(discount,0) * 100)::integer)
where amount_offset_cents = 0 and coalesce(discount,0) > 0;

create or replace function public.icetak_guard_payment_amount_reservation()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.expected_amount is not null then new.expected_amount := round(new.expected_amount,2); end if;
  if new.base_amount is not null then new.base_amount := round(new.base_amount,2); end if;
  if new.discount is not null then new.discount := round(new.discount,2); end if;

  if new.expected_amount is not null
     and new.status in ('pending','submitted','receipt_submitted','pending_review')
     and new.expires_at is not null
     and new.expires_at > now() - make_interval(secs => coalesce(new.reservation_grace_seconds,120)) then
    perform pg_advisory_xact_lock(hashtextextended('icetak_payment_amount_allocator',0));

    if exists (
      select 1 from public.payment_sessions ps
      where ps.id is distinct from new.id
        and ps.expected_amount = new.expected_amount
        and ps.status in ('pending','submitted','receipt_submitted','pending_review')
        and ps.expires_at is not null
        and ps.expires_at > now() - make_interval(secs => coalesce(ps.reservation_grace_seconds,120))
    ) then
      raise exception using errcode='23505', message='payment_amount_in_use',
        detail=format('RM%s is reserved by another matchable payment session',new.expected_amount);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payment_sessions_unique_matchable_amount on public.payment_sessions;
create trigger trg_payment_sessions_unique_matchable_amount
before insert or update of expected_amount,status,expires_at,order_id,reservation_grace_seconds
on public.payment_sessions
for each row execute function public.icetak_guard_payment_amount_reservation();

create or replace function public.icetak_prepare_payment(p_order_token text,p_force_new boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  oid uuid; ono text; tok text; amt numeric; pstat text;
  sid uuid; exp timestamptz; st text; tx text; rn text; rp text; ma timestamptz; sub_at timestamptz;
  selected numeric; current_expected numeric; current_discount numeric;
  offset_cents integer; slot_found boolean := false;
begin
  select id,order_no,public_token,round(coalesce(total,0),2),coalesce(payment_status,'pending')
  into oid,ono,tok,amt,pstat
  from public.orders where public_token=p_order_token limit 1;

  if oid is null then raise exception 'Order not found'; end if;
  if amt <= 0 then raise exception 'Invalid order total'; end if;

  select id,expires_at,status,transaction_id,receipt_name,receipt_path,matched_at,
         expected_amount,coalesce(discount,0),submitted_at
  into sid,exp,st,tx,rn,rp,ma,current_expected,current_discount,sub_at
  from public.payment_sessions
  where order_id=oid and status='matched'
  order by created_at desc limit 1;

  if sid is not null or lower(pstat)='paid' then
    update public.orders set payment_status='paid',payment='Paid',status='payment_received',tab='progress' where id=oid;
    return jsonb_build_object(
      'id',coalesce(sid,oid),'orderToken',tok,'orderId',ono,'baseAmount',amt,
      'expectedAmount',coalesce(current_expected,amt),'discount',coalesce(current_discount,0),
      'expiresAt',extract(epoch from coalesce(exp,now()))*1000,'status','matched',
      'transactionId',coalesce(tx,''),'receiptName',coalesce(rn,''),'receiptUrl',coalesce(rp,''),
      'submittedAt',coalesce(extract(epoch from sub_at)*1000,0),
      'matchedAt',coalesce(extract(epoch from ma)*1000,extract(epoch from now())*1000)
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('icetak_payment_amount_allocator',0));

  update public.payment_sessions set status='expired'
  where order_id=oid and status='pending'
    and expires_at <= now()-make_interval(secs=>coalesce(reservation_grace_seconds,120));

  -- A submitted receipt is never replaced by another QR session.
  select id,expires_at,status,transaction_id,receipt_name,receipt_path,matched_at,
         expected_amount,coalesce(discount,0),submitted_at
  into sid,exp,st,tx,rn,rp,ma,current_expected,current_discount,sub_at
  from public.payment_sessions
  where order_id=oid and status in ('submitted','receipt_submitted','pending_review')
  order by created_at desc limit 1;

  if sid is null then
    if p_force_new then
      update public.payment_sessions set status='superseded'
      where order_id=oid and status='pending';
    else
      select id,expires_at,status,transaction_id,receipt_name,receipt_path,matched_at,
             expected_amount,coalesce(discount,0),submitted_at
      into sid,exp,st,tx,rn,rp,ma,current_expected,current_discount,sub_at
      from public.payment_sessions
      where order_id=oid and status='pending' and expires_at>now()
      order by created_at desc limit 1;
    end if;
  end if;

  if sid is null then
    for offset_cents in 0..50 loop
      selected := round(amt-(offset_cents::numeric/100),2);
      if selected>0 and not exists (
        select 1 from public.payment_sessions ps
        where ps.expected_amount=selected
          and ps.status in ('pending','submitted','receipt_submitted','pending_review')
          and ps.expires_at is not null
          and ps.expires_at > now()-make_interval(secs=>coalesce(ps.reservation_grace_seconds,120))
      ) then
        slot_found := true;
        exit;
      end if;
    end loop;

    if not slot_found then
      raise exception 'Payment amount slots are temporarily full. Please try again in 2 minutes.';
    end if;

    insert into public.payment_sessions(
      order_id,order_token,base_amount,expected_amount,discount,
      amount_offset_cents,reservation_grace_seconds,status,expires_at
    ) values (
      oid,tok,amt,selected,round(amt-selected,2),offset_cents,120,'pending',now()+interval '10 minutes'
    ) returning id,expires_at,status,expected_amount,discount
      into sid,exp,st,current_expected,current_discount;
  end if;

  update public.orders set payment_status='pending',tab='to_pay',updated_at=now()
  where id=oid and coalesce(payment_status,'')<>'paid';

  return jsonb_build_object(
    'id',sid,'orderToken',tok,'orderId',ono,'baseAmount',amt,
    'expectedAmount',current_expected,'discount',coalesce(current_discount,0),
    'expiresAt',extract(epoch from exp)*1000,'status',st,'transactionId',coalesce(tx,''),
    'receiptName',coalesce(rn,''),'receiptUrl',coalesce(rp,''),
    'submittedAt',coalesce(extract(epoch from sub_at)*1000,0),
    'matchedAt',coalesce(extract(epoch from ma)*1000,0)
  );
end;
$$;

create or replace function public.icetak_payment_webhook(p_payload jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  a numeric; tx text; sid uuid; oid uuid; ono text; tok text;
  candidate_count integer := 0; existing_sid uuid; existing_oid uuid;
begin
  begin
    a := round((p_payload->>'amount')::numeric,2);
  exception when others then
    return jsonb_build_object('success',false,'matched',false,'reason','invalid_amount');
  end;
  if a is null or a<=0 then return jsonb_build_object('success',false,'matched',false,'reason','invalid_amount'); end if;

  tx := coalesce(nullif(btrim(p_payload->>'transaction_id'),''),'payload_'||md5(p_payload::text));

  select id,order_id into existing_sid,existing_oid
  from public.payment_sessions where transaction_id=tx and status='matched' limit 1;
  if existing_sid is not null then
    select order_no,public_token into ono,tok from public.orders where id=existing_oid;
    return jsonb_build_object('success',true,'matched',true,'already_processed',true,
      'order_id',ono,'order_token',tok,'amount',a,'transaction_id',tx);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('icetak_payment_amount_allocator',0));

  select count(*),
         (array_agg(ps.id order by ps.expires_at desc,ps.created_at desc))[1],
         (array_agg(ps.order_id order by ps.expires_at desc,ps.created_at desc))[1]
  into candidate_count,sid,oid
  from public.payment_sessions ps
  where ps.expected_amount=a
    and ps.status in ('pending','submitted','receipt_submitted','pending_review')
    and ps.expires_at is not null
    and ps.expires_at > now()-make_interval(secs=>coalesce(ps.reservation_grace_seconds,120));

  if candidate_count=0 then
    if not exists(select 1 from public.unmatched_payment_transactions where transaction_id=tx) then
      insert into public.unmatched_payment_transactions(provider,transaction_id,amount,paid_at,sender_name,raw_payload)
      values(coalesce(p_payload->>'provider','webhook'),tx,a,now(),coalesce(p_payload->>'sender_name',''),
        p_payload||jsonb_build_object('_match_reason','no_pending_session'));
    end if;
    return jsonb_build_object('success',true,'matched',false,'reason','no_pending_session','amount',a,'transaction_id',tx);
  end if;

  if candidate_count>1 then
    if not exists(select 1 from public.unmatched_payment_transactions where transaction_id=tx) then
      insert into public.unmatched_payment_transactions(provider,transaction_id,amount,paid_at,sender_name,raw_payload)
      values(coalesce(p_payload->>'provider','webhook'),tx,a,now(),coalesce(p_payload->>'sender_name',''),
        p_payload||jsonb_build_object('_match_reason','ambiguous_amount','candidate_count',candidate_count));
    end if;
    return jsonb_build_object('success',true,'matched',false,'reason','ambiguous_amount',
      'candidate_count',candidate_count,'amount',a,'transaction_id',tx);
  end if;

  select order_no,public_token into ono,tok from public.orders where id=oid;
  update public.payment_sessions set status='matched',transaction_id=tx,matched_at=now() where id=sid;
  update public.orders set payment_status='paid',payment='Paid',status='payment_received',tab='progress',
    admin_status='Ready to Process',updated_at=now() where id=oid;

  return jsonb_build_object('success',true,'matched',true,'order_id',ono,'order_token',tok,
    'amount',a,'transaction_id',tx,'payment_session_id',sid);
end;
$$;

-- Repair any duplicate sessions that were already active when this migration ran.
do $$
declare r record; candidate numeric; cents integer; found_slot boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('icetak_payment_amount_allocator',0));
  for r in
    select id,round(base_amount,2) base_amount
    from (
      select ps.*,row_number() over(partition by expected_amount order by created_at,id) rn
      from public.payment_sessions ps
      where ps.status in ('pending','submitted','receipt_submitted','pending_review')
        and ps.expires_at is not null
        and ps.expires_at > now()-make_interval(secs=>coalesce(ps.reservation_grace_seconds,120))
    ) ranked where rn>1 order by created_at,id
  loop
    found_slot := false;
    for cents in 0..50 loop
      candidate := round(r.base_amount-(cents::numeric/100),2);
      if candidate>0 and not exists(
        select 1 from public.payment_sessions ps
        where ps.id<>r.id and ps.expected_amount=candidate
          and ps.status in ('pending','submitted','receipt_submitted','pending_review')
          and ps.expires_at is not null
          and ps.expires_at > now()-make_interval(secs=>coalesce(ps.reservation_grace_seconds,120))
      ) then
        update public.payment_sessions
        set expected_amount=candidate,discount=round(r.base_amount-candidate,2),
          amount_offset_cents=cents,reservation_grace_seconds=120
        where id=r.id;
        found_slot := true;
        exit;
      end if;
    end loop;
    if not found_slot then raise exception 'Unable to rebalance duplicate active payment session %',r.id; end if;
  end loop;
end;
$$;
