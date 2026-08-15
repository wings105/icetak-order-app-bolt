create or replace function public.icetak_admin_confirm_paid_draft(
  p_review_token text,
  p_payment_method text,
  p_reference text default null,
  p_actor text default 'admin-link'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  d public.qrpay_order_drafts%rowtype;
  v_method_raw text:=lower(trim(coalesce(p_payment_method,'')));
  v_method text;
  v_provider text;
  v_txid text;
  v_result jsonb;
  v_order_id uuid;
  v_order_no text;
  v_outbox uuid;
begin
  select * into d from public.qrpay_order_drafts where review_token=p_review_token for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.status='confirmed' then
    return jsonb_build_object('success',true,'duplicate',true,'order_db_id',d.order_id,'order_id',d.order_no);
  end if;
  if d.status='rejected' then raise exception 'rejected_draft_cannot_be_confirmed'; end if;
  if d.source_type='qrpay_payment' then raise exception 'Use QRPay Confirm for QRPay payment draft'; end if;
  if d.payment_mode in ('cash_counter','cash_at_counter') then raise exception 'Use Confirm Pickup Order for cash pickup draft'; end if;

  v_method:=case
    when v_method_raw in ('qr_pay_manual','qr pay manual','qr_pay','qr pay','qrpay','manual_qrpay','manual qrpay') then 'QR Pay (Manual)'
    when v_method_raw in ('bank_transfer','bank transfer','duitnow','online_banking','online banking') then 'Bank Transfer'
    when v_method_raw in ('card','credit_card','debit_card','credit card','debit card') then 'Card'
    when v_method_raw in ('other','manual','lain') then 'Other'
    else null
  end;
  if v_method is null then raise exception 'Valid payment method required'; end if;

  if d.admin_approved_at is null then
    perform public.icetak_admin_approve_draft_for_customer(p_review_token,d.working_draft,p_actor);
    select * into d from public.qrpay_order_drafts where id=d.id for update;
  end if;
  if coalesce(d.draft_total,0)<=0 then raise exception 'Draft total must be more than RM0'; end if;

  update public.qrpay_order_drafts
  set payment_mode='already_paid',
      payment_status='paid',
      payment_required=true,
      payment_amount=draft_total,
      payment_received_at=coalesce(payment_received_at,now()),
      payment_difference=0,
      customer_status='admin_confirmed_paid',
      updated_at=now(),
      version=version+1
  where id=d.id
  returning * into d;

  v_result:=public.icetak_finalize_generic_order_draft(d.id,p_actor);
  v_order_id:=nullif(v_result->>'order_db_id','')::uuid;
  if v_order_id is null then select order_id into v_order_id from public.qrpay_order_drafts where id=d.id; end if;
  if v_order_id is null then raise exception 'order_creation_failed'; end if;
  select coalesce(order_no,order_id) into v_order_no from public.orders where id=v_order_id;

  v_provider:=case v_method
    when 'QR Pay (Manual)' then 'manual_qrpay'
    when 'Bank Transfer' then 'bank_transfer'
    when 'Card' then 'card_manual'
    else 'admin_manual'
  end;
  v_txid:='draft_manual:'||d.id::text;

  insert into public.payment_transactions(order_id,payment_session_id,provider,transaction_id,amount,paid_at,sender_name,raw_payload)
  values(
    v_order_id,null,v_provider,v_txid,d.draft_total,coalesce(d.payment_received_at,now()),coalesce(d.customer_name,'Customer'),
    jsonb_build_object('source','admin_draft_manual_paid','draft_id',d.id,'review_token_suffix',right(p_review_token,6),'verified_by',p_actor,'payment_method',v_method,'reference',nullif(trim(coalesce(p_reference,'')),''))
  )
  on conflict(transaction_id) do update set
    order_id=excluded.order_id,
    amount=excluded.amount,
    raw_payload=coalesce(public.payment_transactions.raw_payload,'{}'::jsonb)||excluded.raw_payload;

  update public.orders
  set payment='Paid',
      payment_status='paid',
      payment_method=v_method,
      payment_transaction_id=v_txid,
      payment_verified_at=coalesce(payment_verified_at,now()),
      payment_verified_by=coalesce(nullif(p_actor,''),'admin-link'),
      customer_confirmed=true,
      customer_confirmed_at=coalesce(customer_confirmed_at,now()),
      production_approved=true,
      status='Ready to Process',
      admin_status='Ready to Process',
      tab='progress',
      updated_at=now()
  where id=v_order_id;

  v_outbox:=public.enqueue_clickup_production_order(v_order_id);

  update public.qrpay_order_drafts
  set payment_status='paid',payment_mode='already_paid',payment_amount=draft_total,payment_difference=0,
      confirmed_by=coalesce(nullif(p_actor,''),'admin-link'),updated_at=now()
  where id=d.id;

  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,metadata)
  values(d.id,'admin_confirmed_paid',coalesce(nullif(p_actor,''),'admin-link'),jsonb_build_object('order_id',v_order_id,'order_no',v_order_no,'payment_method',v_method,'transaction_id',v_txid,'reference',nullif(trim(coalesce(p_reference,'')),''),'outbox_id',v_outbox));

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(v_order_id::text,v_order_no,'confirm_paid_draft',coalesce(nullif(p_actor,''),'admin-link'),jsonb_build_object('draft_id',d.id,'payment_method',v_method,'transaction_id',v_txid,'reference',nullif(trim(coalesce(p_reference,'')),''),'outbox_id',v_outbox));

  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object('success',true,'draft_id',d.id,'order_db_id',v_order_id,'order_id',v_order_no,'payment_method',v_method,'payment_transaction_id',v_txid,'outbox_id',v_outbox);
end
$function$;

revoke all on function public.icetak_admin_confirm_paid_draft(text,text,text,text) from public, anon, authenticated;
grant execute on function public.icetak_admin_confirm_paid_draft(text,text,text,text) to service_role;
