-- Preserve the admin's per-draft WhatsApp choice when a reviewed draft is
-- converted into an order. Paid drafts are created directly in the paid
-- state, so the normal unpaid -> paid order trigger cannot emit this event.

create or replace function public.icetak_sync_draft_whatsapp_opt_in_to_order()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_notify boolean := coalesce(
    nullif(coalesce(new.confirmed_draft, new.working_draft)->>'notify_whatsapp', '')::boolean,
    false
  );
  v_paid boolean;
begin
  if new.order_id is null then
    return new;
  end if;

  update public.orders
     set whatsapp_opt_in = v_notify,
         updated_at = now()
   where id = new.order_id
     and whatsapp_opt_in is distinct from v_notify;

  select public.icetak_payment_state_is_paid(o.payment_status, o.payment)
    into v_paid
    from public.orders o
   where o.id = new.order_id;

  if v_notify and coalesce(v_paid, false) then
    perform public.icetak_enqueue_whatsapp_event(
      'payment_received',
      new.order_id,
      jsonb_strip_nulls(jsonb_build_object(
        'transaction_id', nullif(new.transaction_id, ''),
        'paid_amount', new.payment_amount
      )),
      'draft_conversion',
      now()
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists zz_icetak_sync_draft_whatsapp_opt_in_to_order_trg
  on public.qrpay_order_drafts;

create trigger zz_icetak_sync_draft_whatsapp_opt_in_to_order_trg
after update of order_id on public.qrpay_order_drafts
for each row
when (old.order_id is null and new.order_id is not null)
execute function public.icetak_sync_draft_whatsapp_opt_in_to_order();

revoke all on function public.icetak_sync_draft_whatsapp_opt_in_to_order() from public, anon, authenticated;
grant execute on function public.icetak_sync_draft_whatsapp_opt_in_to_order() to service_role;

comment on function public.icetak_sync_draft_whatsapp_opt_in_to_order()
is 'Copies draft notify_whatsapp to orders.whatsapp_opt_in and enqueues payment_received for paid draft conversions.';
