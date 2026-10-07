-- Notify customer cash pickup orders before approval, without waiting for ClickUp.
-- Reuse the unique auto_order_created job so approval does not send it twice.
create or replace function public.icetak_customer_cash_needs_review(p_order public.orders)
returns boolean
language sql
immutable
security invoker
set search_path to 'public','pg_temp'
as $$
  select lower(coalesce(p_order.source,''))='customer'
    and coalesce(p_order.customer_confirmed,false)
    and not coalesce(p_order.production_approved,false)
    and lower(coalesce(p_order.delivery_method,p_order.delivery,'')) like '%pickup%'
    and lower(coalesce(p_order.status,'')) not in ('cancelled','completed','delivered','customer collected')
    and lower(coalesce(p_order.fulfillment_stage,'')) not in ('cancelled','collected','delivered','completed')
    and lower(coalesce(p_order.admin_status,'')) not like '%cancel%'
    and lower(coalesce(p_order.payment_status,'')) not in ('paid','matched','payment_received','success','completed')
    and lower(coalesce(p_order.payment,''))<>'paid'
    and (
      lower(coalesce(p_order.payment_status,''))='cash_counter'
      or lower(coalesce(p_order.payment_method,p_order.payment,'')) in ('cash at counter','cash counter','cash','counter','pay at pickup')
    );
$$;
revoke all on function public.icetak_customer_cash_needs_review(public.orders) from public,anon,authenticated;
grant execute on function public.icetak_customer_cash_needs_review(public.orders) to service_role;

CREATE OR REPLACE FUNCTION public.icetak_kick_admin_order_notification(p_order_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_count integer := 0;
  v_key text;
  q record;
  v_ready boolean;
begin
  if p_order_id is null then return 0; end if;
  perform public.icetak_whatsapp_cancel_invalid_jobs();
  if public.icetak_order_is_cancelled(p_order_id) then return 0; end if;

  update public.admin_order_notification_queue
  set status='failed',
      locked_at=null,
      last_error=coalesce(last_error,'retry_limit_reached'),
      updated_at=now()
  where order_id=p_order_id
    and status in ('pending','retry','sending','dispatching')
    and coalesce(attempts,0)>=5;

  select setting_value into v_key
  from public.private_runtime_settings
  where setting_key='qrpay_ai_worker_token'
  limit 1;
  if nullif(v_key,'') is null then return 0; end if;

  for q in
    select id,event_type
    from public.admin_order_notification_queue
    where order_id=p_order_id
      and status in ('pending','retry')
      and coalesce(attempts,0)<5
      and scheduled_at<=now()
    order by created_at
    for update skip locked
  loop
    v_ready := q.event_type in ('ai_order_draft_created','ai_order_created')
      or (
        q.event_type='auto_order_created'
        and exists(select 1 from public.orders o
          where o.id=p_order_id and public.icetak_customer_cash_needs_review(o))
        and exists(select 1 from public.order_items where order_id=p_order_id)
      )
      or (
        exists(select 1 from public.production_components where order_id=p_order_id)
        and not exists(
          select 1 from public.production_components
          where order_id=p_order_id and clickup_task_id is null
        )
      );
    if not v_ready then continue; end if;

    update public.admin_order_notification_queue
    set status='sending',locked_at=now(),attempts=attempts+1,updated_at=now()
    where id=q.id and status in ('pending','retry');
    if not found then continue; end if;

    perform net.http_post(
      url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/admin-order-control',
      headers:=jsonb_build_object(
        'content-type','application/json',
        'x-admin-order-token',v_key
      ),
      body:=jsonb_build_object('action','send_final_notification','queue_id',q.id),
      timeout_milliseconds:=20000
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.icetak_admin_notification_from_order_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_source text := lower(coalesce(new.source, ''));
  v_source_key text;
begin
  -- Updates only kick the existing unique order-created job: never reset sent jobs.
  if tg_op='UPDATE' then
    if public.icetak_customer_cash_needs_review(new) then
      perform public.icetak_kick_admin_order_notification(new.id);
    end if;
    return new;
  end if;
  v_source_key := coalesce(
    nullif(new.external_order_id, ''),
    nullif(new.order_id, ''),
    nullif(new.order_no, ''),
    new.id::text
  );

  if v_source in ('qrpay_ai', 'pickup_ai') then
    perform public.icetak_enqueue_admin_order_notification(
      new.id,
      'ai_order_draft_created',
      v_source,
      v_source_key
    );
  else
    perform public.icetak_enqueue_admin_order_notification(
      new.id,
      'auto_order_created',
      coalesce(nullif(v_source, ''), 'unknown'),
      v_source_key
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_admin_notify_ai_order_insert on public.orders;
create trigger trg_admin_notify_ai_order_insert
after insert or update of customer_confirmed, payment_status, payment_method, delivery_method, source
on public.orders for each row execute function public.icetak_admin_notification_from_order_insert();
