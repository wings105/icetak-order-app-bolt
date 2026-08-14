create or replace function public.sync_order_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_active integer;
  v_matched integer;
  v_new_status text;
  v_order_payment text;
  v_order_payment_status text;
  v_order_payment_method text;
begin
  v_order_id := new.order_id;

  select
    count(*) filter (where status in ('pending','submitted','receipt_submitted','pending_review','matched')),
    count(*) filter (where status='matched')
  into v_active,v_matched
  from public.payment_sessions
  where order_id=v_order_id;

  -- cancelled, superseded and expired sessions are historical and must not
  -- downgrade the canonical order payment state.
  if coalesce(v_active,0)=0 then
    return new;
  end if;

  select lower(coalesce(payment,'')),
         lower(coalesce(payment_status,'')),
         lower(coalesce(payment_method,''))
  into v_order_payment,v_order_payment_status,v_order_payment_method
  from public.orders
  where id=v_order_id;

  if v_matched=v_active and v_matched>0 then
    v_new_status:='paid';
  elsif v_matched>0 then
    v_new_status:='partial';
  elsif v_order_payment_status='cash_counter'
     or v_order_payment in ('cash at counter','cash counter','pay at pickup')
     or v_order_payment_method in ('cash at counter','cash counter','pay at pickup') then
    -- Creating a QR intent is not itself a payment-state transition.
    -- Keep Pay at Counter as the canonical fallback until QR is actually matched.
    return new;
  else
    v_new_status:='unpaid';
  end if;

  update public.orders
  set payment_status=v_new_status,
      payment=case
        when v_new_status='paid' then 'Paid'
        when v_new_status='partial' then 'Partial'
        else payment
      end,
      updated_at=now()
  where id=v_order_id
    and (payment_status is distinct from v_new_status
      or (v_new_status='paid' and payment is distinct from 'Paid')
      or (v_new_status='partial' and payment is distinct from 'Partial'));

  return new;
end;
$$;