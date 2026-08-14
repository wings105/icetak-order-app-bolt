create or replace function public.icetak_preserve_cash_counter_during_qr_intent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(old.payment_status,'')) = 'cash_counter'
     and lower(coalesce(new.payment_status,'')) in ('pending','unpaid','waiting_payment')
     and lower(coalesce(new.payment_method,'')) = 'qr pay'
     and lower(coalesce(old.payment,'')) <> 'paid' then
    new.payment := old.payment;
    new.payment_status := old.payment_status;
    new.payment_method := old.payment_method;

    if lower(coalesce(new.admin_status,'')) in ('qr payment pending','payment pending','waiting payment') then
      new.admin_status := old.admin_status;
    end if;

    if lower(coalesce(new.status,'')) in ('waiting payment','payment pending','qr payment pending') then
      new.status := old.status;
    end if;

    if lower(coalesce(new.tab,'')) = 'to_pay' then
      new.tab := old.tab;
    end if;
  end if;

  if coalesce(old.production_approved,false)
     and lower(coalesce(new.tab,'')) = 'to_pay'
     and lower(coalesce(old.tab,'')) in ('progress','receive') then
    new.tab := old.tab;
  end if;

  if coalesce(old.production_approved,false)
     and lower(coalesce(new.status,'')) in ('waiting payment','payment pending','qr payment pending')
     and lower(coalesce(old.status,'')) not like '%cancel%' then
    new.status := old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_icetak_preserve_cash_counter_during_qr_intent on public.orders;
create trigger trg_icetak_preserve_cash_counter_during_qr_intent
before update on public.orders
for each row execute function public.icetak_preserve_cash_counter_during_qr_intent();

revoke all on function public.icetak_preserve_cash_counter_during_qr_intent() from public, anon, authenticated;

-- The public order token is already the capability used by the customer order page.
-- This RPC can only cancel an unmatched session belonging to that token and cannot mark anything paid.
grant execute on function public.icetak_cancel_payment(text,uuid) to anon, authenticated, service_role;