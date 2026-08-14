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

  select lower(coalesce(payment,'')),
         lower(coalesce(payment_status,'')),
         lower(coalesce(payment_method,''))
  into v_order_payment,v_order_payment_status,v_order_payment_method
  from public.orders
  where id=v_order_id;

  -- A session lifecycle update must never downgrade an order already verified as paid.
  if v_order_payment='paid' or v_order_payment_status in ('paid','matched','payment_received') then
    return new;
  end if;

  select
    count(*) filter (
      where status in ('submitted','receipt_submitted','pending_review','matched')
         or (status='pending' and (expires_at is null or expires_at>now()-make_interval(secs=>coalesce(reservation_grace_seconds,120))))
    ),
    count(*) filter (where status='matched')
  into v_active,v_matched
  from public.payment_sessions
  where order_id=v_order_id;

  if coalesce(v_active,0)=0 then
    return new;
  end if;

  if v_matched=v_active and v_matched>0 then
    v_new_status:='paid';
  elsif v_matched>0 then
    v_new_status:='partial';
  elsif v_order_payment_status='cash_counter'
     or v_order_payment in ('cash at counter','cash counter','pay at pickup')
     or v_order_payment_method in ('cash at counter','cash counter','pay at pickup') then
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

create or replace function public.icetak_mark_pay_at_pickup_admin_queue()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_delivery text:=lower(coalesce(new.delivery_method,new.delivery,''));
  v_payment text:=lower(coalesce(new.payment_method,new.payment,new.payment_status,''));
  v_paid boolean:=lower(coalesce(new.payment_status,''))='paid' or lower(coalesce(new.payment,''))='paid';
  v_terminal boolean:=new.pickup_collected_at is not null
    or lower(coalesce(new.fulfillment_stage,'')) in ('ready_for_pickup','collected','completed','cancelled')
    or lower(coalesce(new.status,'')) like '%ready%pickup%'
    or lower(coalesce(new.status,'')) in ('completed','cancelled','customer collected');
begin
  if lower(coalesce(new.payment_status,''))='cash_counter'
     and nullif(trim(coalesce(new.payment_method,'')),'') is null then
    new.payment_method:='Cash at Counter';
  end if;

  if v_delivery like '%pickup%'
     and coalesce(new.customer_confirmed,false)
     and not v_paid
     and not v_terminal
     and (
       lower(coalesce(new.payment_status,''))='cash_counter'
       or v_payment in ('cash at counter','cash counter','pay at pickup')
     ) then
    new.admin_status:='Pending Cash Approval';
    new.status:=case when lower(coalesce(new.status,'')) like '%waiting%payment%' then 'Ready to Process' else new.status end;
    new.tab:='progress';
  end if;
  return new;
end;
$$;

update public.orders
set payment_method='Cash at Counter', updated_at=now()
where lower(coalesce(payment_status,''))='cash_counter'
  and nullif(trim(coalesce(payment_method,'')),'') is null
  and lower(coalesce(status,'')) not like '%cancel%';

create or replace function public.icetak_expire_stale_payment_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer:=0;
begin
  update public.payment_sessions
  set status='expired'
  where status='pending'
    and expires_at is not null
    and expires_at<=now()-make_interval(secs=>coalesce(reservation_grace_seconds,120));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.icetak_expire_stale_payment_sessions() from public, anon, authenticated;

select public.icetak_expire_stale_payment_sessions();

do $$
begin
  if exists(select 1 from cron.job where jobname='icetak-expire-stale-payment-sessions') then
    perform cron.unschedule('icetak-expire-stale-payment-sessions');
  end if;
  perform cron.schedule(
    'icetak-expire-stale-payment-sessions',
    '*/5 * * * *',
    'select public.icetak_expire_stale_payment_sessions();'
  );
end;
$$;