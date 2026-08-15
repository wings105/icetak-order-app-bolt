create or replace function public.icetak_admin_payment_override_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_order public.orders%rowtype;
  v_order_uuid uuid;
  v_order_no text := nullif(trim(coalesce(p_payload->>'order_id', p_payload->>'order_no', '')), '');
  v_action text := lower(trim(coalesce(p_payload->>'action','')));
  v_method_raw text := lower(trim(coalesce(p_payload->>'payment_method','')));
  v_method text;
  v_provider text;
  v_username text;
  v_transaction_id text;
  v_outbox uuid;
  v_paid boolean;
begin
  begin
    v_order_uuid := nullif(p_payload->>'order_db_id','')::uuid;
  exception when invalid_text_representation then
    v_order_uuid := null;
  end;

  if v_order_uuid is null and v_order_no is not null then
    select id into v_order_uuid
    from public.orders
    where order_id = v_order_no or order_no = v_order_no
    order by created_at desc
    limit 1;
  end if;

  if v_order_uuid is null then raise exception 'order_db_id or order_id required'; end if;

  select * into v_order from public.orders where id = v_order_uuid for update;
  if v_order.id is null then raise exception 'Order not found'; end if;

  select username into v_username
  from public.admin_users
  where auth_user_id = auth.uid() and is_active = true
  limit 1;

  if v_username is null or not public.icetak_admin_has_permission('verify_payments') then
    raise exception 'Forbidden';
  end if;

  if lower(coalesce(v_order.status,'')) = 'cancelled' or lower(coalesce(v_order.fulfillment_stage,'')) = 'cancelled' then
    raise exception 'Order cancelled';
  end if;

  v_method := case
    when v_method_raw in ('qr_pay_manual','qr pay manual','qr_pay','qr pay','qrpay','manual_qrpay','manual qrpay') then 'QR Pay (Manual)'
    when v_method_raw in ('bank_transfer','bank transfer','duitnow','online_banking','online banking') then 'Bank Transfer'
    when v_method_raw in ('cash_at_counter','cash at counter','cash counter','cash','counter','pay at pickup') then 'Cash at Counter'
    when v_method_raw in ('card','credit_card','debit_card','credit card','debit card') then 'Card'
    when v_method_raw in ('other','manual','lain') then 'Other'
    else null
  end;

  if v_method is null then raise exception 'Valid payment_method required'; end if;
  if v_action not in ('set_method','confirm_paid') then raise exception 'Unsupported action'; end if;

  v_paid := lower(coalesce(v_order.payment_status,'')) in ('paid','matched','payment_received','success','completed')
            or lower(coalesce(v_order.payment,'')) = 'paid';

  if v_action = 'set_method' then
    update public.orders
    set payment_method = v_method,
        payment = case
          when v_paid then 'Paid'
          when v_method = 'Cash at Counter' and lower(coalesce(delivery_method,delivery,'')) like '%pickup%' then 'Cash at Counter'
          when lower(coalesce(payment_status,'')) = 'cash_counter' and v_method <> 'Cash at Counter' then 'Pending Payment'
          else payment
        end,
        payment_status = case
          when v_paid then payment_status
          when v_method = 'Cash at Counter' and lower(coalesce(delivery_method,delivery,'')) like '%pickup%' then 'cash_counter'
          when lower(coalesce(payment_status,'')) = 'cash_counter' and v_method <> 'Cash at Counter' then 'pending'
          else payment_status
        end,
        updated_at = now()
    where id = v_order_uuid;

    insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
    values(
      v_order_uuid::text,
      coalesce(v_order.order_id,v_order.order_no),
      'manual_payment_method_changed',
      v_username,
      jsonb_build_object('payment_method',v_method,'reference',nullif(trim(coalesce(p_payload->>'reference','')),''))
    );

    return jsonb_build_object('ok',true,'action','set_method','order_db_id',v_order_uuid,'order_id',coalesce(v_order.order_id,v_order.order_no),'payment_method',v_method);
  end if;

  if v_paid then
    update public.orders set payment_method = v_method, updated_at = now() where id = v_order_uuid;
    insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
    values(v_order_uuid::text,coalesce(v_order.order_id,v_order.order_no),'manual_payment_already_paid',v_username,jsonb_build_object('payment_method',v_method));
    return jsonb_build_object('ok',true,'already_paid',true,'order_db_id',v_order_uuid,'order_id',coalesce(v_order.order_id,v_order.order_no),'payment_method',v_method);
  end if;

  v_provider := case v_method
    when 'QR Pay (Manual)' then 'manual_qrpay'
    when 'Bank Transfer' then 'bank_transfer'
    when 'Cash at Counter' then 'cash_counter'
    when 'Card' then 'card_manual'
    else 'admin_manual'
  end;

  v_transaction_id := 'admin_manual:' || v_order_uuid::text || ':' || gen_random_uuid()::text;

  update public.payment_sessions
  set status = case when status in ('pending','submitted','receipt_submitted','pending_review') then 'superseded' else status end
  where order_id = v_order_uuid;

  insert into public.payment_transactions(order_id,payment_session_id,provider,transaction_id,amount,paid_at,sender_name,raw_payload)
  values(
    v_order_uuid,
    null,
    v_provider,
    v_transaction_id,
    coalesce(v_order.total,0),
    now(),
    coalesce(v_order.delivery_name,v_order.customer_name,'Customer'),
    jsonb_build_object(
      'source','admin_manual_payment_recovery',
      'verified_by',v_username,
      'payment_method',v_method,
      'reference',nullif(trim(coalesce(p_payload->>'reference','')),''),
      'order_no',coalesce(v_order.order_no,v_order.order_id)
    )
  );

  update public.orders
  set payment = 'Paid',
      payment_status = 'paid',
      payment_method = v_method,
      payment_transaction_id = v_transaction_id,
      payment_verified_at = now(),
      payment_verified_by = v_username,
      status = case
        when pickup_collected_at is not null or delivered_at is not null or lower(coalesce(status,'')) in ('completed','customer collected','delivered') then status
        when customer_confirm_token is not null and coalesce(customer_confirmed,false) = false then 'Waiting Customer Confirmation'
        else 'Payment Received'
      end,
      admin_status = case
        when pickup_collected_at is not null then 'Customer Collected'
        when delivered_at is not null then 'Delivered'
        when pickup_ready_at is not null or lower(coalesce(status,'')) like '%ready%pickup%' then 'Ready for Pickup'
        when customer_confirm_token is not null and coalesce(customer_confirmed,false) = false then 'Awaiting Customer Confirmation'
        else 'Ready to Process'
      end,
      tab = case
        when pickup_collected_at is not null or delivered_at is not null then 'completed'
        when pickup_ready_at is not null or lower(coalesce(status,'')) like '%ready%pickup%' then 'receive'
        else 'progress'
      end,
      updated_at = now()
  where id = v_order_uuid;

  v_outbox := public.enqueue_clickup_production_order(v_order_uuid);

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(
    v_order_uuid::text,
    coalesce(v_order.order_id,v_order.order_no),
    'manual_payment_confirmed',
    v_username,
    jsonb_build_object('payment_method',v_method,'provider',v_provider,'payment_transaction_id',v_transaction_id,'outbox_id',v_outbox,'reference',nullif(trim(coalesce(p_payload->>'reference','')),''))
  );

  return jsonb_build_object(
    'ok',true,
    'action','confirm_paid',
    'order_db_id',v_order_uuid,
    'order_id',coalesce(v_order.order_id,v_order.order_no),
    'payment_method',v_method,
    'payment_transaction_id',v_transaction_id,
    'outbox_id',v_outbox
  );
end;
$$;

revoke all on function public.icetak_admin_payment_override_v1(jsonb) from public;
grant execute on function public.icetak_admin_payment_override_v1(jsonb) to authenticated;
