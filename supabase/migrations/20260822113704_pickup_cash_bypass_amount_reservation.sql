-- Cash is confirmed synchronously and must not reserve a QR amount. Keeping its
-- session matched from insertion avoids collisions with an unrelated live QR
-- checkout that happens to have the same total.
create or replace function public.icetak_create_pickup_checkout_internal(
  p_customer_master_id uuid,
  p_order_ids uuid[],
  p_method text,
  p_source text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_master uuid;
  v_checkout_id uuid:=gen_random_uuid();
  v_checkout_no text:='PC'||to_char(now() at time zone 'Asia/Kuala_Lumpur','YYMMDD')
    ||'-'||upper(substr(replace(v_checkout_id::text,'-',''),1,6));
  v_session_id uuid:=gen_random_uuid();
  v_session_token text:='pb_'||encode(extensions.gen_random_bytes(16),'hex');
  v_total numeric;
  v_count integer;
  v_expires timestamptz:=now()+interval '30 minutes';
  v_result jsonb;
begin
  if p_method not in ('cash','qrpay') then raise exception 'invalid_payment_method'; end if;
  if coalesce(cardinality(p_order_ids),0)=0 then raise exception 'select_at_least_one_order'; end if;
  if cardinality(p_order_ids)<>cardinality(array(select distinct unnest(p_order_ids))) then
    raise exception 'duplicate_order_selection';
  end if;
  select coalesce(m.merged_into_id,m.id) into v_master
  from public.customer_master m where m.id=p_customer_master_id;
  if v_master is null then raise exception 'customer_not_found'; end if;

  update public.pickup_checkouts
  set status='expired',updated_at=now()
  where status='awaiting_payment' and expires_at<now();
  update public.pickup_checkout_orders po
  set status='released',active_reservation=false
  where po.active_reservation
    and exists(select 1 from public.pickup_checkouts pc
      where pc.id=po.checkout_id and pc.status in ('expired','cancelled'));

  perform 1
  from public.orders o
  where o.id=any(p_order_ids)
  order by o.id for update;

  select count(*),round(sum(coalesce(o.total,0)),2)
  into v_count,v_total
  from public.orders o
  join public.customers c on c.id=o.customer_id
  join public.customer_master m on m.id=c.customer_master_id
  where o.id=any(p_order_ids)
    and coalesce(m.merged_into_id,m.id)=v_master
    and (
      lower(coalesce(o.delivery_method,'')) like '%pickup%'
      or lower(coalesce(o.delivery,'')) like '%pickup%'
      or o.pickup_ready_at is not null
    )
    and o.pickup_collected_at is null
    and lower(coalesce(o.status,'')) not in ('cancelled','canceled')
    and lower(coalesce(o.payment_status,'')) not in ('paid','matched','payment_received')
    and lower(coalesce(o.payment,''))<>'paid';
  if v_count<>cardinality(p_order_ids) then
    raise exception 'invalid_paid_or_foreign_order_selection';
  end if;
  if coalesce(v_total,0)<=0 then raise exception 'invalid_checkout_total'; end if;

  insert into public.payment_sessions(
    id,order_id,expected_amount,status,base_amount,discount,expires_at,
    order_token,purpose,pricing_snapshot,reservation_grace_seconds
  ) values(
    v_session_id,null,v_total,
    case when p_method='cash' then 'matched' else 'pending' end,
    v_total,0,v_expires,v_session_token,'pickup_bundle',
    jsonb_build_object('pickup_checkout_id',v_checkout_id,'pickup_checkout_no',v_checkout_no,
      'customer_master_id',v_master,'order_ids',to_jsonb(p_order_ids),'source',p_source,
      'payment_method',p_method),
    120
  );

  insert into public.pickup_checkouts(
    id,checkout_no,customer_master_id,customer_id,source,status,payment_method,
    total_amount,payment_session_id,expires_at,created_by
  )
  select v_checkout_id,v_checkout_no,v_master,
    (select c.id from public.customers c where c.customer_master_id=v_master
      order by c.created_at desc limit 1),
    case when p_source in ('counter','customer_portal','whatsapp','admin_crm')
      then p_source else 'counter' end,
    'awaiting_payment',p_method,v_total,v_session_id,v_expires,
    coalesce(nullif(p_actor,''),'pickup_checkout');

  insert into public.pickup_checkout_orders(
    checkout_id,order_id,amount,ready_at_creation,item_snapshot
  )
  select v_checkout_id,o.id,round(coalesce(o.total,0),2),
    public.icetak_pickup_is_ready(o.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'title',coalesce(i.title,i.product_type,'Item'),
        'qty',coalesce(i.qty,1),'price',coalesce(i.price,0),
        'size',i.size,'wording',coalesce(i.custom_text,i.wording),
        'previewUrl',i.design_preview_url
      ) order by coalesce(i.sort_index,0),i.id)
      from public.order_items i where i.order_id=o.id
    ),'[]'::jsonb)
  from public.orders o where o.id=any(p_order_ids);

  if p_method='cash' then
    v_result:=public.icetak_finalize_pickup_checkout(
      v_checkout_id,'CASH-'||v_checkout_no,v_total,'cash_counter','',
      coalesce(nullif(p_actor,''),'pickup_counter'),
      jsonb_build_object('source','pickup_counter','paid_at',now())
    );
  else
    v_result:=jsonb_build_object(
      'ok',true,'paid',false,'checkoutId',v_checkout_id,'checkoutNo',v_checkout_no,
      'amount',v_total,'paymentSessionId',v_session_id,'expiresAt',v_expires
    );
  end if;
  return v_result;
end;
$$;

revoke execute on function public.icetak_create_pickup_checkout_internal(uuid,uuid[],text,text,text)
  from public,anon,authenticated;
grant execute on function public.icetak_create_pickup_checkout_internal(uuid,uuid[],text,text,text)
  to service_role;
