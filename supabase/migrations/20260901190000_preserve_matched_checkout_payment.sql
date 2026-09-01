-- A matched customer checkout is the source of truth.  Never let an admin
-- edit, flow reset, or "wrong customer" action turn it back into an unpaid
-- draft while its payment session remains matched.

create or replace function public.icetak_preserve_matched_checkout_payment()
returns trigger
language plpgsql
security definer
set search_path = 'public','pg_temp'
as $function$
declare
  v_session public.payment_sessions%rowtype;
  v_paid_at timestamptz;
  v_amount numeric;
begin
  select * into v_session
  from public.payment_sessions
  where draft_id = old.id
    and status = 'matched'
  order by matched_at desc nulls last, created_at desc
  limit 1;

  if not found then
    return new;
  end if;

  select pt.paid_at, pt.amount into v_paid_at, v_amount
  from public.payment_transactions pt
  where pt.payment_session_id = v_session.id
     or (v_session.transaction_id is not null and pt.transaction_id = v_session.transaction_id)
  order by pt.paid_at desc nulls last, pt.created_at desc
  limit 1;

  new.payment_session_id := v_session.id;
  new.transaction_id := coalesce(v_session.transaction_id, old.transaction_id, new.transaction_id);
  new.payment_amount := coalesce(v_amount, v_session.expected_amount, old.payment_amount, new.payment_amount);
  new.payment_received_at := coalesce(v_paid_at, v_session.matched_at, old.payment_received_at, new.payment_received_at);
  new.payment_status := 'paid';
  new.payment_required := true;

  -- Payment matching may have happened before an address correction.  Keep
  -- the approval/checkout milestones while allowing the address itself to be edited.
  new.admin_approved_at := coalesce(new.admin_approved_at, old.admin_approved_at);
  new.admin_approved_by := coalesce(new.admin_approved_by, old.admin_approved_by);
  new.customer_link_sent_at := coalesce(new.customer_link_sent_at, old.customer_link_sent_at);
  new.customer_confirmed_at := coalesce(new.customer_confirmed_at, old.customer_confirmed_at);
  if new.customer_confirmed_at is not null then
    new.customer_status := 'confirmed';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_icetak_preserve_matched_checkout_payment on public.qrpay_order_drafts;
create trigger trg_icetak_preserve_matched_checkout_payment
before update on public.qrpay_order_drafts
for each row execute function public.icetak_preserve_matched_checkout_payment();

create or replace function public.finance_admin_detach_qrpay_from_draft(p_draft_id uuid,p_actor text default 'admin1')
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare d public.qrpay_order_drafts%rowtype;v_transaction_id text;v_actor text:=coalesce(nullif(btrim(coalesce(p_actor,'')),''),'admin1');
begin
  perform pg_advisory_xact_lock(hashtextextended('draft-payment-detach:'||p_draft_id::text,0));
  select * into d from public.qrpay_order_drafts where id=p_draft_id for update;
  if not found then raise exception 'Draft not found';end if;
  if d.order_id is not null or d.status in ('confirmed','rejected') then raise exception 'Only an active draft can detach payment';end if;
  if exists (
    select 1 from public.payment_sessions ps
    where ps.draft_id=d.id and ps.status='matched'
  ) then
    raise exception 'Matched customer checkout payment cannot be detached. Complete or explicitly void the original checkout first.';
  end if;
  v_transaction_id:=nullif(btrim(coalesce(d.transaction_id,'')),'');
  if v_transaction_id is null then return jsonb_build_object('success',true,'duplicate',true,'draft_id',d.id,'transaction_id',null);end if;
  update public.qrpay_order_drafts set
    source_type=case when source_type='qrpay_payment' then 'chat_trigger' else source_type end,
    transaction_id=null,payment_amount=null,payment_received_at=null,payment_status='unpaid',payment_required=true,payment_session_id=null,
    admin_approved_at=null,customer_link_sent_at=null,customer_status='pending_admin',
    working_draft=(coalesce(working_draft,'{}'::jsonb)-'transaction_id'-'payment_amount'-'payment_received_at')
      ||jsonb_build_object('payment_detached',true,'payment_detached_at',now(),'payment_detached_by',v_actor),
    updated_at=now(),version=version+1 where id=d.id;
  update public.qrpay_ai_jobs set order_id=null,order_no=null,status='needs_review',completed_at=null,locked_at=null,
    match_reason='manual_admin_detached_wrong_draft',updated_at=now(),
    evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object('payment_detached_from_draft_id',d.id,'payment_detached_by',v_actor,'payment_detached_at',now())
    where transaction_id=v_transaction_id;
  update public.admin_order_reviews set order_id=null,order_no=null,status='pending_admin',approved_at=null,completed_at=null,
    evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object('payment_detached_from_draft_id',d.id,'payment_detached_by',v_actor,'payment_detached_at',now()),updated_at=now()
    where transaction_id=v_transaction_id;
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data,metadata)
    select d.id,'payment_detached_wrong_customer',v_actor,d.working_draft,q.working_draft,jsonb_build_object('transaction_id',v_transaction_id,'reason','wrong_customer')
    from public.qrpay_order_drafts q where q.id=d.id;
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
    values(d.id::text,'DRAFT:'||d.id::text,'detach_qrpay_from_draft',v_actor,jsonb_build_object('transaction_id',v_transaction_id,'reason','wrong_customer'));
  return jsonb_build_object('success',true,'duplicate',false,'draft_id',d.id,'transaction_id',v_transaction_id,
    'payment_returned_to_review',exists(select 1 from public.unmatched_payment_transactions u where u.transaction_id=v_transaction_id));
end;
$function$;

create or replace function public.icetak_admin_set_draft_flow(
  p_review_token text,
  p_delivery text,
  p_payment_mode text,
  p_actor text default 'admin-v2'
)
returns jsonb language plpgsql security definer set search_path = 'public','pg_temp'
as $function$
declare d public.qrpay_order_drafts%rowtype; v_delivery text := lower(btrim(coalesce(p_delivery,''))); v_mode text := lower(btrim(coalesce(p_payment_mode,''))); v_work jsonb; v_fee numeric := 0; v_totals jsonb;
begin
  select * into d from public.qrpay_order_drafts where review_token=p_review_token for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.status in ('confirmed','rejected') or d.order_id is not null then raise exception 'draft_locked'; end if;
  if d.source_type='qrpay_payment' then raise exception 'QRPay payment draft flow cannot be changed'; end if;
  if exists(select 1 from public.payment_sessions ps where ps.draft_id=d.id and ps.status='matched') then raise exception 'Matched checkout flow cannot be changed'; end if;
  if v_delivery not in ('pickup','spx','jnt','ninja') then raise exception 'Shipping / Pickup required'; end if;
  if v_mode in ('cash_at_counter','cash') then v_mode:='cash_counter'; end if;
  if v_mode not in ('prepaid','cash_counter') then raise exception 'Invalid payment mode'; end if;
  if v_mode='cash_counter' and v_delivery<>'pickup' then raise exception 'Cash at Counter is only available for Pickup'; end if;
  if d.payment_status='paid' or d.transaction_id is not null then raise exception 'Paid/linked draft flow cannot be changed'; end if;
  v_fee:=case v_delivery when 'spx' then 4.50 when 'jnt' then 5.90 when 'ninja' then 6.90 else 0 end;
  v_work:=coalesce(d.working_draft,'{}'::jsonb)||jsonb_build_object('delivery',v_delivery,'delivery_fee',v_fee,'payment_mode',v_mode);
  v_totals:=public.icetak_qrpay_draft_totals(v_work);
  v_work:=v_work||jsonb_build_object('total',(v_totals->>'draft_total')::numeric,'draft_total',(v_totals->>'draft_total')::numeric,'pricing_totals',v_totals);
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,after_data,metadata) values(d.id,'admin_flow_changed',coalesce(nullif(p_actor,''),'admin-v2'),d.working_draft,v_work,jsonb_build_object('from_payment_mode',d.payment_mode,'to_payment_mode',v_mode,'delivery',v_delivery));
  update public.qrpay_order_drafts set working_draft=v_work,item_subtotal=(v_totals->>'item_subtotal')::numeric,shipping_fee=(v_totals->>'shipping_fee')::numeric,draft_total=(v_totals->>'draft_total')::numeric,payment_difference=case when payment_amount is null then 0 else round((v_totals->>'draft_total')::numeric-payment_amount,2) end,payment_mode=v_mode,payment_required=(v_mode='prepaid'),payment_status=case when v_mode='cash_counter' then 'not_required' else 'unpaid' end,admin_approved_at=null,admin_approved_by=null,customer_link_sent_at=null,customer_confirmed_at=null,customer_status='not_sent',status='pending_admin',updated_at=now(),version=version+1,last_error=null where id=d.id returning * into d;
  return to_jsonb(d);
end;
$function$;

revoke all on function public.finance_admin_detach_qrpay_from_draft(uuid,text) from public,anon,authenticated;
grant execute on function public.finance_admin_detach_qrpay_from_draft(uuid,text) to service_role;
revoke all on function public.icetak_admin_set_draft_flow(text,text,text,text) from public,anon,authenticated;
grant execute on function public.icetak_admin_set_draft_flow(text,text,text,text) to service_role;
