create or replace function public.icetak_order_is_production_ready(p_order public.orders)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    lower(coalesce(p_order.status,'')) not in ('cancelled','completed','delivered','customer collected')
    and lower(coalesce(p_order.fulfillment_stage,'')) not in ('cancelled','collected','delivered','completed')
    and (
      p_order.customer_confirm_token is null
      or coalesce(p_order.customer_confirmed,false)
      or coalesce(p_order.production_approved,false)
    )
    and (lower(coalesce(p_order.source,'')) not in ('qrpay_ai','pickup_ai') or coalesce(p_order.production_approved,false))
    and (
      lower(coalesce(p_order.payment_status,'')) in ('paid','matched','payment_received','success','completed')
      or lower(coalesce(p_order.payment,''))='paid'
      or (
        lower(coalesce(p_order.delivery_method,p_order.delivery,'')) like '%pickup%'
        and coalesce(p_order.production_approved,false)
        and (
          lower(coalesce(p_order.payment_status,''))='cash_counter'
          or lower(coalesce(p_order.payment_method,p_order.payment,'')) in ('cash at counter','cash counter','cash','counter','pay at pickup')
        )
      )
    );
$$;

create or replace function public.icetak_admin_confirm_production(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_order public.orders%rowtype;
  v_username text;
  v_payment text;
  v_delivery text;
  v_paid boolean;
  v_cash_pickup boolean;
  v_outbox uuid;
  v_already_approved boolean;
  v_blockers jsonb:='[]'::jsonb;
  v_blocker_text text;
  v_saved_approved boolean;
begin
  if p_order_id is null then raise exception 'Order ID required'; end if;
  if not public.icetak_admin_has_permission('approve_production') then raise exception 'Forbidden'; end if;

  select username into v_username
  from public.admin_users
  where auth_user_id=auth.uid() and is_active=true
  limit 1;
  if v_username is null then raise exception 'Unauthorized'; end if;

  select * into v_order
  from public.orders
  where id=p_order_id
  for update;
  if v_order.id is null then raise exception 'Order not found'; end if;

  if lower(coalesce(v_order.status,'')) in ('cancelled','completed','delivered','customer collected')
     or lower(coalesce(v_order.fulfillment_stage,'')) in ('cancelled','collected','delivered','completed') then
    raise exception 'Order sudah terminal / tidak boleh masuk production';
  end if;

  if lower(coalesce(v_order.source,'')) in ('qrpay_ai','pickup_ai') then
    v_blockers:=public.finance_admin_qrpay_order_blockers(v_order.id);
    if jsonb_array_length(v_blockers)>0 then
      select string_agg(value,'; ') into v_blocker_text from jsonb_array_elements_text(v_blockers);
      raise exception 'Order belum lengkap: %',v_blocker_text;
    end if;
  end if;

  v_payment:=lower(coalesce(v_order.payment_status,v_order.payment,''));
  v_delivery:=lower(coalesce(v_order.delivery_method,v_order.delivery,''));
  v_paid:=v_payment in ('paid','matched','payment_received','success','completed') or lower(coalesce(v_order.payment,''))='paid';
  v_cash_pickup:=v_delivery like '%pickup%'
    and (
      lower(coalesce(v_order.payment_status,''))='cash_counter'
      or lower(coalesce(v_order.payment_method,v_order.payment,'')) in ('cash at counter','cash counter','cash','counter','pay at pickup')
    );

  if not (v_paid or v_cash_pickup) then
    raise exception 'Payment belum diterima. Admin hanya boleh override order Paid atau Pickup Cash at Counter.';
  end if;

  v_already_approved:=coalesce(v_order.production_approved,false);

  if not v_already_approved then
    update public.orders
    set production_approved=true,
        admin_status='Ready to Process',
        status='Production Started',
        tab='progress',
        fulfillment_stage='production',
        updated_at=now()
    where id=v_order.id;
  end if;

  select coalesce(production_approved,false) into v_saved_approved
  from public.orders where id=v_order.id;
  if not v_saved_approved then
    raise exception 'Production approval tidak disimpan. Semak item / variation order.';
  end if;

  v_outbox:=public.enqueue_clickup_production_order(v_order.id);

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(
    v_order.id::text,
    coalesce(v_order.order_id,v_order.order_no),
    'confirm_production_admin_override',
    v_username,
    jsonb_build_object(
      'customer_confirmed',coalesce(v_order.customer_confirmed,false),
      'customer_confirmation_overridden',not coalesce(v_order.customer_confirmed,false),
      'cash_at_counter',v_cash_pickup,
      'already_approved',v_already_approved,
      'outbox_id',v_outbox
    )
  );

  return jsonb_build_object(
    'ok',true,
    'order_db_id',v_order.id,
    'order_id',coalesce(v_order.order_id,v_order.order_no),
    'production_approved',true,
    'customer_confirmed',coalesce(v_order.customer_confirmed,false),
    'admin_override',not coalesce(v_order.customer_confirmed,false),
    'already_approved',v_already_approved,
    'outbox_id',v_outbox
  );
end;
$$;

revoke all on function public.icetak_admin_confirm_production(uuid) from public;
revoke all on function public.icetak_admin_confirm_production(uuid) from anon;
grant execute on function public.icetak_admin_confirm_production(uuid) to authenticated;
