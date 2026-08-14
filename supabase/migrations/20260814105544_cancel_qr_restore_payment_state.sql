alter table public.payment_sessions
  add column if not exists origin_payment_state jsonb;

create or replace function public.icetak_capture_payment_origin_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
begin
  if new.order_id is null or coalesce(new.purpose,'order_payment') <> 'order_payment' then
    return new;
  end if;

  if new.origin_payment_state is not null and new.origin_payment_state <> '{}'::jsonb then
    return new;
  end if;

  select * into o from public.orders where id = new.order_id;
  if o.id is null then
    return new;
  end if;

  new.origin_payment_state := jsonb_build_object(
    'payment', o.payment,
    'payment_status', o.payment_status,
    'payment_method', o.payment_method,
    'status', o.status,
    'admin_status', o.admin_status,
    'tab', o.tab,
    'fulfillment_stage', o.fulfillment_stage,
    'production_approved', coalesce(o.production_approved,false),
    'captured_at', now()
  );
  return new;
end;
$$;

drop trigger if exists trg_icetak_capture_payment_origin_state on public.payment_sessions;
create trigger trg_icetak_capture_payment_origin_state
before insert on public.payment_sessions
for each row execute function public.icetak_capture_payment_origin_state();

create or replace function public.icetak_cancel_payment(
  p_order_token text,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  s public.payment_sessions%rowtype;
  origin jsonb;
  restored_payment text;
  restored_payment_status text;
  restored_payment_method text;
  next_status text;
  next_admin_status text;
  next_tab text;
  stage_key text;
  has_other_active boolean := false;
begin
  select * into o
  from public.orders
  where public_token = p_order_token
  limit 1
  for update;

  if o.id is null then
    raise exception 'Order not found';
  end if;

  if lower(coalesce(o.payment_status,'')) in ('paid','matched','payment_received')
     or lower(coalesce(o.payment,'')) = 'paid' then
    return jsonb_build_object(
      'ok', true,
      'already_paid', true,
      'orderId', coalesce(o.order_no,o.order_id),
      'payment', o.payment,
      'paymentStatus', o.payment_status,
      'tab', o.tab
    );
  end if;

  if p_session_id is not null then
    select * into s
    from public.payment_sessions
    where id = p_session_id and order_id = o.id
    limit 1
    for update;
  else
    select * into s
    from public.payment_sessions
    where order_id = o.id
      and status in ('pending','expired')
    order by created_at desc
    limit 1
    for update;
  end if;

  if s.id is null then
    return jsonb_build_object(
      'ok', true,
      'no_active_session', true,
      'orderId', coalesce(o.order_no,o.order_id),
      'payment', o.payment,
      'paymentStatus', o.payment_status,
      'tab', o.tab
    );
  end if;

  if lower(coalesce(s.status,'')) = 'matched' or s.transaction_id is not null or s.matched_at is not null then
    return jsonb_build_object(
      'ok', true,
      'already_paid', true,
      'orderId', coalesce(o.order_no,o.order_id),
      'sessionId', s.id,
      'status', s.status
    );
  end if;

  if lower(coalesce(s.status,'')) not in ('pending','expired') then
    return jsonb_build_object(
      'ok', false,
      'cannot_cancel', true,
      'orderId', coalesce(o.order_no,o.order_id),
      'sessionId', s.id,
      'status', s.status,
      'error', 'Payment session can no longer be cancelled safely'
    );
  end if;

  select exists(
    select 1
    from public.payment_sessions ps
    where ps.order_id = o.id
      and ps.id <> s.id
      and ps.status in ('pending','submitted','receipt_submitted','pending_review','matched')
  ) into has_other_active;

  if has_other_active then
    return jsonb_build_object(
      'ok', false,
      'cannot_cancel', true,
      'orderId', coalesce(o.order_no,o.order_id),
      'sessionId', s.id,
      'error', 'A newer or active payment session exists'
    );
  end if;

  origin := s.origin_payment_state;
  if origin is null or origin = '{}'::jsonb then
    return jsonb_build_object(
      'ok', false,
      'origin_missing', true,
      'orderId', coalesce(o.order_no,o.order_id),
      'sessionId', s.id,
      'error', 'Original payment state is unavailable'
    );
  end if;

  update public.payment_sessions
  set status = 'cancelled'
  where id = s.id;

  restored_payment := coalesce(nullif(origin->>'payment',''), o.payment);
  restored_payment_status := coalesce(nullif(origin->>'payment_status',''), o.payment_status);
  restored_payment_method := coalesce(nullif(origin->>'payment_method',''), restored_payment, o.payment_method);
  stage_key := lower(coalesce(o.fulfillment_stage,''));

  next_status := case
    when coalesce(o.production_approved,false)
      or stage_key in ('production','ready_for_pickup','ready_to_ship','in_transit','delivery_issue','collected','delivered','completed')
      then o.status
    when lower(coalesce(o.status,'')) in ('waiting payment','payment pending','qr payment pending')
      then coalesce(nullif(origin->>'status',''), o.status)
    else o.status
  end;

  next_admin_status := case
    when lower(coalesce(o.admin_status,'')) in ('qr payment pending','payment pending','waiting payment')
      then coalesce(nullif(origin->>'admin_status',''), o.admin_status)
    else o.admin_status
  end;

  next_tab := case
    when o.pickup_collected_at is not null or stage_key in ('collected','delivered','completed') then 'completed'
    when o.pickup_ready_at is not null or stage_key = 'ready_for_pickup' then 'receive'
    when coalesce(o.production_approved,false)
      or stage_key in ('production','ready_to_ship','in_transit','delivery_issue') then 'progress'
    else coalesce(nullif(origin->>'tab',''), o.tab, 'progress')
  end;

  update public.orders
  set payment = restored_payment,
      payment_status = restored_payment_status,
      payment_method = restored_payment_method,
      status = next_status,
      admin_status = next_admin_status,
      tab = next_tab,
      updated_at = now()
  where id = o.id;

  return jsonb_build_object(
    'ok', true,
    'cancelled', true,
    'orderId', coalesce(o.order_no,o.order_id),
    'sessionId', s.id,
    'payment', restored_payment,
    'paymentStatus', restored_payment_status,
    'paymentMethod', restored_payment_method,
    'status', next_status,
    'adminStatus', next_admin_status,
    'tab', next_tab
  );
end;
$$;

revoke all on function public.icetak_cancel_payment(text,uuid) from public, anon, authenticated;
grant execute on function public.icetak_cancel_payment(text,uuid) to service_role;