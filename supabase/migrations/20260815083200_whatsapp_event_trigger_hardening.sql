-- Harden the event-source triggers that feed WhatsApp automation.
-- This migration is intentionally activation-neutral: it never turns any WhatsApp switch ON.

create or replace function public.icetak_payment_state_is_paid(
  p_payment_status text,
  p_payment text
)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select
    lower(btrim(coalesce(p_payment_status,''))) in (
      'paid','matched','payment_received','payment received','received',
      'verified','success','successful','fully_paid','fully paid'
    )
    or lower(btrim(coalesce(p_payment,''))) in (
      'paid','matched','payment_received','payment received','received',
      'verified','success','successful','fully_paid','fully paid'
    );
$function$;

create or replace function public.icetak_order_is_paid(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select public.icetak_payment_state_is_paid(o.payment_status,o.payment)
    from public.orders o
    where o.id=p_order_id
  ),false);
$function$;

create or replace function public.icetak_orders_whatsapp_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  old_paid boolean;
  new_paid boolean;
  old_cancel boolean;
  new_cancel boolean;
  old_ready_pickup boolean;
  new_ready_pickup boolean;
  old_status_text text;
  new_status_text text;
begin
  if tg_op='INSERT' then return new; end if;

  old_paid:=public.icetak_payment_state_is_paid(old.payment_status,old.payment);
  new_paid:=public.icetak_payment_state_is_paid(new.payment_status,new.payment);
  if not old_paid and new_paid then
    perform public.icetak_enqueue_whatsapp_event('payment_received',new.id,'{}'::jsonb,null,now());
  end if;

  if coalesce(old.production_approved,false)=false
     and coalesce(new.production_approved,false)=true then
    perform public.icetak_enqueue_whatsapp_event('production_started',new.id,'{}'::jsonb,null,now());
  end if;

  old_cancel:=lower(concat_ws(' ',old.status,old.admin_status,old.fulfillment_stage)) like '%cancel%';
  new_cancel:=lower(concat_ws(' ',new.status,new.admin_status,new.fulfillment_stage)) like '%cancel%';
  if not old_cancel and new_cancel then
    perform public.icetak_enqueue_whatsapp_event('order_cancelled',new.id,'{}'::jsonb,null,now());
  end if;

  old_status_text:=lower(trim(coalesce(old.status,'')));
  new_status_text:=lower(trim(coalesce(new.status,'')));
  old_ready_pickup:=
    old_status_text in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup')
    or lower(trim(coalesce(old.admin_status,''))) in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup');
  new_ready_pickup:=
    new_status_text in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup')
    or lower(trim(coalesce(new.admin_status,''))) in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup');

  if not old_ready_pickup
     and new_ready_pickup
     and lower(coalesce(new.delivery_method,new.delivery,'')) like '%pickup%' then
    perform public.icetak_enqueue_auto_pickup_ready(new.id,new.pickup_ready_at);
  end if;

  return new;
end;
$function$;

drop trigger if exists icetak_orders_whatsapp_trg on public.orders;
create trigger icetak_orders_whatsapp_trg
after insert or update on public.orders
for each row execute function public.icetak_orders_whatsapp_trigger();

create or replace function public.icetak_whatsapp_global_disable_queue_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  enabled_value boolean;
  lifecycle_events text[]:=array[
    'order_created','payment_pending','payment_received','production_started',
    'review_ready','order_ready_pickup','order_shipped','order_delivered','order_cancelled'
  ];
begin
  if new.key<>'enabled' then return new; end if;

  enabled_value:=lower(coalesce(new.text_value,'true')) in ('true','1','yes','enabled','on');
  if not enabled_value then
    update public.notification_queue
    set status='skipped',
        processed_at=now(),
        locked_at=null,
        decision_mode='skipped',
        decision_reason='global_notifications_disabled',
        last_error=null
    where status='pending'
      and event_type=any(lifecycle_events);
  end if;

  return new;
end;
$function$;

drop trigger if exists icetak_whatsapp_global_disable_queue_trg on public.whatsapp_settings;
create trigger icetak_whatsapp_global_disable_queue_trg
after insert or update on public.whatsapp_settings
for each row execute function public.icetak_whatsapp_global_disable_queue_trigger();

create or replace function public.icetak_notification_outbox_queue_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  oid uuid;
  pay_status text;
  pay_value text;
  order_opt_in boolean;
begin
  if coalesce(new.channel,'whatsapp')='whatsapp'
     and coalesce(new.status,'pending')='pending' then
    select id,
           lower(trim(coalesce(payment_status,''))),
           lower(trim(coalesce(payment,''))),
           coalesce(whatsapp_opt_in,false)
    into oid,pay_status,pay_value,order_opt_in
    from public.orders
    where public_token=new.order_token
       or order_no=new.order_id
       or order_id=new.order_id
    limit 1;

    if oid is not null then
      -- Never mutate whatsapp_opt_in here. The customer's current opt-in state is authoritative.
      if coalesce(order_opt_in,false) then
        perform public.icetak_enqueue_whatsapp_event(
          new.event_type,
          oid,
          jsonb_strip_nulls(jsonb_build_object(
            'confirm_token',new.confirm_token,
            'transaction_id',new.transaction_id,
            'paid_amount',new.amount
          )),
          null,
          now()
        );

        if new.event_type='order_created'
           and (
             pay_status in ('unpaid','pending','to_pay','to pay')
             or (pay_status='' and pay_value in ('unpaid','pending','to_pay','to pay'))
           ) then
          perform public.icetak_enqueue_whatsapp_event(
            'payment_pending',
            oid,
            '{}'::jsonb,
            'initial_reminder',
            now()+interval '60 minutes'
          );
        end if;
      else
        update public.notification_outbox
        set status='skipped',
            error_code='order_whatsapp_disabled',
            error_message='WhatsApp disabled for this order'
        where id=new.id;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists icetak_notification_outbox_queue_trg on public.notification_outbox;
create trigger icetak_notification_outbox_queue_trg
after insert on public.notification_outbox
for each row execute function public.icetak_notification_outbox_queue_trigger();

revoke all on function public.icetak_payment_state_is_paid(text,text) from public;
grant execute on function public.icetak_payment_state_is_paid(text,text) to service_role;

comment on function public.icetak_payment_state_is_paid(text,text)
is 'Exact payment-state classifier used by WhatsApp triggers; deliberately avoids matching unpaid as paid.';
