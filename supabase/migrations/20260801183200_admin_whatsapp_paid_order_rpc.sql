create or replace function public.icetak_admin_create_whatsapp_paid_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_username text;
  v_request_id uuid;
  v_request_text text:=nullif(trim(coalesce(p_payload->>'client_request_id','')),'');
  v_transaction_id text:=nullif(trim(coalesce(p_payload#>>'{payment,transaction_id}','')),'');
  v_sender_name text:=nullif(trim(coalesce(p_payload#>>'{payment,sender_name}','')),'');
  v_paid_at timestamptz:=coalesce(nullif(p_payload#>>'{payment,paid_at}','')::timestamptz,now());
  v_items jsonb:=coalesce(p_payload->'items','[]'::jsonb);
  v_items_total numeric:=0;
  v_delivery_fee numeric:=greatest(0,coalesce(nullif(p_payload->>'delivery_fee','')::numeric,0));
  v_total numeric;
  v_amount numeric;
  v_payload jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_existing_order uuid;
  v_existing_payment_order uuid;
  v_address_id uuid;
  v_outbox_id uuid;
  v_payment_id uuid;
begin
  if not public.icetak_admin_has_permission('create_order') then raise exception 'Forbidden: create_order'; end if;
  if not public.icetak_admin_has_permission('verify_payments') then raise exception 'Forbidden: verify_payments'; end if;
  select username into v_username from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_username is null then raise exception 'Unauthorized'; end if;

  if v_request_text is null or v_request_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Valid client_request_id required';
  end if;
  v_request_id:=v_request_text::uuid;

  select id into v_existing_order from public.orders where manual_order_request_id=v_request_id limit 1;
  if v_existing_order is not null then
    return jsonb_build_object(
      'success',true,'duplicate',true,'reason','client_request_id',
      'order_id',(select coalesce(order_no,order_id) from public.orders where id=v_existing_order),
      'order_db_id',v_existing_order,
      'order_token',(select public_token from public.orders where id=v_existing_order),
      'customer_token',(select customer_token from public.orders where id=v_existing_order),
      'total',(select total from public.orders where id=v_existing_order),
      'links',public.icetak_order_links(v_existing_order),
      'clickup',jsonb_build_object('status','existing')
    );
  end if;

  if v_transaction_id is null then raise exception 'Payment transaction reference required'; end if;
  select order_id into v_existing_payment_order from public.payment_transactions where transaction_id=v_transaction_id limit 1;
  if v_existing_payment_order is not null then
    raise exception 'Payment transaction reference already used';
  end if;
  if jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items)=0 then raise exception 'Order items are required'; end if;

  select coalesce(sum(
    greatest(1,coalesce(nullif(item->>'qty','')::integer,1)) *
    greatest(0,coalesce(nullif(item->>'price','')::numeric,0))
  ),0) into v_items_total
  from jsonb_array_elements(v_items) item;
  v_total:=round(v_items_total+v_delivery_fee,2);
  v_amount:=round(coalesce(nullif(p_payload#>>'{payment,amount}','')::numeric,v_total),2);
  if abs(v_amount-v_total)>0.009 then
    raise exception 'Payment amount (%) must equal order total (%)',v_amount,v_total;
  end if;

  v_payload:=(coalesce(p_payload,'{}'::jsonb)-'payment'-'delivery_fee'-'client_request_id'-'session_token') || jsonb_build_object(
    'payment','Paid','total',v_total,'source','admin_whatsapp_qr','created_by',v_username,
    'notify_whatsapp',coalesce((p_payload->>'notify_whatsapp')::boolean,true),
    'external_order_id','waqr:'||v_request_id::text
  );
  v_result:=public.icetak_create_order(v_payload);
  v_order_id:=nullif(v_result->>'order_db_id','')::uuid;
  if v_order_id is null then raise exception 'Order creation returned no order_db_id'; end if;

  update public.orders set
    delivery_fee=v_delivery_fee,payment_method='Manual QR Pay',payment_transaction_id=v_transaction_id,
    payment_verified_at=now(),payment_verified_by=v_username,manual_order_request_id=v_request_id,
    customer_confirmed=true,customer_confirmed_at=coalesce(customer_confirmed_at,now()),
    payment='Paid',payment_status='paid',status='Ready to Process',admin_status='Ready to Process',tab='progress',
    updated_at=now()
  where id=v_order_id;

  if lower(coalesce(p_payload->>'delivery','pickup'))<>'pickup' then
    v_address_id:=public.icetak_upsert_admin_customer_address(v_order_id,coalesce(p_payload->'customer','{}'::jsonb));
  end if;

  insert into public.payment_transactions(
    order_id,payment_session_id,provider,transaction_id,amount,paid_at,sender_name,raw_payload
  ) values(
    v_order_id,null,'manual_qr',v_transaction_id,v_amount,v_paid_at,v_sender_name,
    jsonb_build_object(
      'manual_order_request_id',v_request_id,'verified_by',v_username,
      'receipt_note',coalesce(p_payload#>>'{payment,receipt_note}',''),
      'source','whatsapp','delivery_fee',v_delivery_fee,'items_total',v_items_total
    )
  ) returning id into v_payment_id;

  v_outbox_id:=public.enqueue_clickup_production_order(v_order_id);
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(v_order_id::text,v_result->>'order_id','verify_manual_qr_payment',v_username,
    jsonb_build_object('payment_transaction_id',v_transaction_id,'amount',v_amount,'payment_id',v_payment_id,'client_request_id',v_request_id));

  return v_result || jsonb_build_object(
    'success',true,'duplicate',false,'total',v_total,'items_total',v_items_total,'delivery_fee',v_delivery_fee,
    'delivery_address_id',v_address_id,
    'payment',jsonb_build_object('id',v_payment_id,'method','Manual QR Pay','transaction_id',v_transaction_id,'amount',v_amount,'paid_at',v_paid_at,'verified_by',v_username),
    'links',public.icetak_order_links(v_order_id),
    'clickup',jsonb_build_object('status',case when v_outbox_id is null then 'not_queued' else 'queued' end,'outbox_id',v_outbox_id)
  );
end;
$$;
