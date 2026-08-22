-- Keep the latest paid, not-yet-handed-over bundle discoverable after refresh.
-- This powers the staff-side Void / Undo action without exposing checkout tables.
create or replace function public.icetak_admin_pickup_latest_paid_checkout(p_customer_master_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_checkout public.pickup_checkouts%rowtype;
begin
  if not (
    public.icetak_admin_has_permission('view_customers')
    or public.icetak_admin_has_permission('verify_payments')
  ) then
    raise exception 'Forbidden';
  end if;

  select pc.* into v_checkout
  from public.pickup_checkouts pc
  where pc.customer_master_id=p_customer_master_id
    and pc.status='paid'
    and not exists (
      select 1 from public.pickup_handovers h where h.checkout_id=pc.id
    )
  order by pc.paid_at desc nulls last, pc.updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok',true,'checkout',null);
  end if;

  return jsonb_build_object(
    'ok',true,
    'checkout',jsonb_build_object(
      'ok',true,
      'paid',true,
      'checkoutId',v_checkout.id,
      'checkoutNo',v_checkout.checkout_no,
      'amount',v_checkout.total_amount,
      'transactionId',v_checkout.transaction_id,
      'paidAt',v_checkout.paid_at,
      'paymentMethod',v_checkout.payment_method,
      'status',v_checkout.status
    )
  );
end;
$$;

revoke execute on function public.icetak_admin_pickup_latest_paid_checkout(uuid) from public,anon;
grant execute on function public.icetak_admin_pickup_latest_paid_checkout(uuid) to authenticated,service_role;
