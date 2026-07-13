create or replace function public.icetak_orders_whatsapp_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  old_paid boolean;
  new_paid boolean;
  old_cancel boolean;
  new_cancel boolean;
  old_ready_pickup boolean;
  new_ready_pickup boolean;
  old_ship text;
  new_ship text;
  old_status_text text;
  new_status_text text;
begin
  if tg_op='INSERT' then return new; end if;

  old_paid := lower(coalesce(old.payment_status,old.payment,'')) similar to '%(paid|matched|payment_received)%';
  new_paid := lower(coalesce(new.payment_status,new.payment,'')) similar to '%(paid|matched|payment_received)%';
  if not old_paid and new_paid then
    perform public.icetak_enqueue_whatsapp_event('payment_received',new.id,'{}'::jsonb,null,now());
  end if;

  if coalesce(old.production_approved,false)=false and coalesce(new.production_approved,false)=true then
    perform public.icetak_enqueue_whatsapp_event('production_started',new.id,'{}'::jsonb,null,now());
  end if;

  old_cancel := lower(coalesce(old.status,'')||' '||coalesce(old.admin_status,'')) like '%cancel%';
  new_cancel := lower(coalesce(new.status,'')||' '||coalesce(new.admin_status,'')) like '%cancel%';
  if not old_cancel and new_cancel then
    perform public.icetak_enqueue_whatsapp_event('order_cancelled',new.id,'{}'::jsonb,null,now());
  end if;

  old_status_text := lower(trim(coalesce(old.status,'')));
  new_status_text := lower(trim(coalesce(new.status,'')));
  old_ready_pickup := old_status_text in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup')
    or lower(trim(coalesce(old.admin_status,''))) in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup');
  new_ready_pickup := new_status_text in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup')
    or lower(trim(coalesce(new.admin_status,''))) in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup');

  if not old_ready_pickup
     and new_ready_pickup
     and coalesce(new.production_approved,false)=true
     and lower(coalesce(new.delivery_method,new.delivery,'')) like '%pickup%'
  then
    perform public.icetak_enqueue_whatsapp_event('order_ready_pickup',new.id,'{}'::jsonb,null,now());
  end if;

  old_ship := lower(coalesce(old.shipment_status_group,old.shipment_status,''));
  new_ship := lower(coalesce(new.shipment_status_group,new.shipment_status,''));
  if old_ship is distinct from new_ship then
    if new_ship like '%deliver%' then
      perform public.icetak_enqueue_whatsapp_event('order_delivered',new.id,'{}'::jsonb,null,now());
    elsif new_ship like '%ship%' or new_ship like '%transit%' or new_ship like '%out_for_delivery%' then
      perform public.icetak_enqueue_whatsapp_event('order_shipped',new.id,'{}'::jsonb,null,now());
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.icetak_admin_order_action(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  order_value public.orders%rowtype;
  action_value text := lower(coalesce(p_payload->>'action',''));
  order_uuid uuid := nullif(p_payload->>'order_db_id','')::uuid;
  username_value text;
  payment_value text;
  delivery_value text;
begin
  if order_uuid is null then raise exception 'order_db_id required'; end if;
  select * into order_value from public.orders where id=order_uuid;
  if order_value.id is null then raise exception 'Order not found'; end if;
  select username into username_value from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  if username_value is null then raise exception 'Unauthorized'; end if;

  if action_value='approve_production' then
    if not public.icetak_admin_has_permission('approve_production') then raise exception 'Forbidden'; end if;
    if order_value.customer_confirm_token is not null and coalesce(order_value.customer_confirmed,false)=false then raise exception 'Customer belum confirm order'; end if;
    payment_value := lower(coalesce(order_value.payment,order_value.payment_status,''));
    if payment_value like '%unpaid%' or payment_value like '%pending%' or payment_value like '%to_pay%' then raise exception 'Payment belum diterima'; end if;
    update public.orders set production_approved=true,admin_status='Ready to Process',status='Production Started',tab='progress',updated_at=now() where id=order_uuid;

  elsif action_value='ready_pickup' then
    if not public.icetak_admin_has_permission('approve_production') then raise exception 'Forbidden'; end if;
    delivery_value := lower(coalesce(order_value.delivery_method,order_value.delivery,''));
    if delivery_value not like '%pickup%' then raise exception 'Order bukan pickup'; end if;
    if coalesce(order_value.production_approved,false)=false then raise exception 'Production belum approved'; end if;
    payment_value := lower(coalesce(order_value.payment_status,order_value.payment,''));
    if payment_value not similar to '%(paid|matched|payment_received)%' then raise exception 'Payment belum diterima'; end if;
    update public.orders set admin_status='Ready for Pickup',status='Ready for Pickup',tab='receive',updated_at=now() where id=order_uuid;

  elsif action_value='cancel' then
    if not public.icetak_admin_has_permission('cancel_order') then raise exception 'Forbidden'; end if;
    update public.orders set status='Cancelled',admin_status='Cancelled',tab='completed',updated_at=now() where id=order_uuid;
  else
    raise exception 'Unsupported action';
  end if;

  insert into public.admin_audit(order_db_id,order_id,action,actor)
  values(order_uuid::text,coalesce(order_value.order_id,order_value.order_no),action_value,username_value);
  return jsonb_build_object('ok',true,'action',action_value,'order_db_id',order_uuid);
end;
$$;

create or replace function public.icetak_keep_paid_orders()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.status='payment_received' then
    new.payment_status:='paid';
    new.payment:='Paid';
    new.tab:='progress';
  end if;
  return new;
end;
$$;

create or replace function public.sync_order_payment_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id uuid;
  v_total integer;
  v_matched integer;
  v_new_status text;
begin
  v_order_id:=new.order_id;
  select count(*),count(*) filter(where status='matched') into v_total,v_matched
  from public.payment_sessions where order_id=v_order_id;

  if v_total=0 then v_new_status:='unpaid';
  elsif v_matched=v_total then v_new_status:='paid';
  elsif v_matched>0 then v_new_status:='partial';
  else v_new_status:='unpaid'; end if;

  update public.orders
  set payment_status=v_new_status,
      payment=case when v_new_status='paid' then 'Paid' when v_new_status='partial' then 'Partial' else payment end,
      updated_at=now()
  where id=v_order_id
    and (payment_status is distinct from v_new_status
      or (v_new_status='paid' and payment is distinct from 'Paid')
      or (v_new_status='partial' and payment is distinct from 'Partial'));
  return new;
end;
$$;

update public.orders set payment='Paid',updated_at=now()
where lower(coalesce(payment_status,''))='paid' and payment is distinct from 'Paid';
