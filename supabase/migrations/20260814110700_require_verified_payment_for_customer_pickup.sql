create or replace function public.icetak_customer_confirm_pickup(p_order_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_delivery text;
  v_payment text;
  v_component_count integer := 0;
  v_incomplete_count integer := 0;
  v_now timestamptz := now();
begin
  if nullif(btrim(coalesce(p_order_token, '')), '') is null then
    raise exception 'Order token diperlukan';
  end if;

  select * into v_order
  from public.orders
  where public_token = p_order_token
  for update;

  if v_order.id is null then
    raise exception 'Order tidak ditemui';
  end if;

  v_delivery := lower(coalesce(v_order.delivery_method, v_order.delivery, ''));
  if v_delivery not like '%pickup%' then
    raise exception 'Order ini bukan pickup';
  end if;

  if v_order.pickup_collected_at is not null
     or lower(coalesce(v_order.status, '')) in ('completed', 'customer collected')
     or lower(coalesce(v_order.fulfillment_stage, '')) in ('collected', 'completed') then
    return jsonb_build_object(
      'ok', true,
      'already_collected', true,
      'order_id', coalesce(v_order.order_id, v_order.order_no),
      'status', 'Completed',
      'tab', 'completed'
    );
  end if;

  v_payment := lower(coalesce(v_order.payment_status, v_order.payment, ''));
  if v_payment not in ('paid', 'matched', 'payment_received')
     and lower(coalesce(v_order.payment,'')) <> 'paid' then
    raise exception 'Bayaran belum disahkan';
  end if;

  if lower(coalesce(v_order.fulfillment_stage, '')) <> 'ready_for_pickup'
     and lower(coalesce(v_order.status, '')) not like '%ready%pickup%' then
    raise exception 'Order belum Ready for Pickup';
  end if;

  select count(*),
         count(*) filter (where coalesce(progress_percent, 0) < 100)
  into v_component_count, v_incomplete_count
  from public.production_components
  where order_id = v_order.id;

  if v_component_count = 0 or v_incomplete_count > 0 then
    raise exception 'Production order belum lengkap';
  end if;

  update public.orders
  set status = 'Completed',
      admin_status = 'Customer Collected',
      tab = 'completed',
      fulfillment_stage = 'collected',
      production_completed_at = coalesce(production_completed_at, v_now),
      pickup_ready_at = coalesce(pickup_ready_at, v_now),
      pickup_collected_at = v_now,
      updated_at = v_now
  where id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'already_collected', false,
    'order_id', coalesce(v_order.order_id, v_order.order_no),
    'status', 'Completed',
    'tab', 'completed',
    'pickup_collected_at', v_now
  );
end;
$$;