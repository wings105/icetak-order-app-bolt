-- Admin-selectable WhatsApp notification controls.

create or replace function public.icetak_admin_create_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  username_value text;
  payload_value jsonb;
  result_value jsonb;
  order_uuid uuid;
  computed_total numeric;
  notify_value boolean := coalesce((p_payload->>'notify_whatsapp')::boolean, true);
  notification_status_value text;
  delivery_fee_value numeric := greatest(0, coalesce(nullif(p_payload->>'delivery_fee','')::numeric, 0));
begin
  if not public.icetak_admin_has_permission('create_order') then
    raise exception 'Forbidden';
  end if;

  if lower(coalesce(p_payload->>'payment','')) = 'paid'
     and not public.icetak_admin_has_permission('verify_payments') then
    raise exception 'Forbidden: verify_payments';
  end if;

  select username
  into username_value
  from public.admin_users
  where auth_user_id = auth.uid()
    and is_active = true
  limit 1;

  select coalesce(
    sum(
      greatest(1, coalesce(nullif(item->>'qty','')::integer, 1))
      * greatest(0, coalesce(nullif(item->>'price','')::numeric, 0))
    ),
    0
  ) + delivery_fee_value
  into computed_total
  from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item;

  payload_value := coalesce(p_payload, '{}'::jsonb) - 'session_token';
  payload_value := payload_value || jsonb_build_object(
    'source', 'admin',
    'created_by', username_value,
    'notify_whatsapp', notify_value,
    'total', coalesce(nullif(p_payload->>'total','')::numeric, computed_total)
  );

  result_value := public.icetak_create_order(payload_value);
  order_uuid := nullif(result_value->>'order_db_id','')::uuid;

  if order_uuid is not null then
    update public.orders
    set delivery_fee = delivery_fee_value,
        whatsapp_opt_in = notify_value,
        updated_at = now()
    where id = order_uuid;

    perform public.enqueue_clickup_production_order(order_uuid);
  end if;

  notification_status_value := case
    when not notify_value then 'disabled'
    when exists (
      select 1
      from public.notification_queue
      where order_id = order_uuid
        and event_type = 'order_created'
    ) then 'queued'
    when exists (
      select 1
      from public.whatsapp_notification_rules
      where event_type = 'order_created'
        and enabled = false
    ) then 'rule_disabled'
    when exists (
      select 1
      from public.whatsapp_settings
      where key = 'enabled'
        and lower(coalesce(text_value, 'true')) not in ('true','1','yes','enabled')
    ) then 'global_disabled'
    else 'not_queued'
  end;

  return result_value || jsonb_build_object(
    'links', public.icetak_order_links(order_uuid),
    'notify_whatsapp', notify_value,
    'notification_status', notification_status_value
  );
end;
$function$;

create or replace function public.icetak_notification_outbox_queue_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  oid uuid;
  pay_status text;
  order_opt_in boolean;
begin
  if coalesce(new.channel, 'whatsapp') = 'whatsapp'
     and coalesce(new.status, 'pending') = 'pending' then
    select id,
           lower(coalesce(payment_status, payment, '')),
           coalesce(whatsapp_opt_in, false)
    into oid, pay_status, order_opt_in
    from public.orders
    where public_token = new.order_token
       or order_no = new.order_id
       or order_id = new.order_id
    limit 1;

    if oid is not null then
      -- The initial order-created outbox row only exists when the creator opted in.
      -- Later events must never silently re-enable a disabled order.
      if new.event_type = 'order_created' then
        update public.orders
        set whatsapp_opt_in = true,
            updated_at = now()
        where id = oid
        returning whatsapp_opt_in into order_opt_in;
      end if;

      if coalesce(order_opt_in, false) then
        perform public.icetak_enqueue_whatsapp_event(
          new.event_type,
          oid,
          jsonb_strip_nulls(jsonb_build_object(
            'confirm_token', new.confirm_token,
            'transaction_id', new.transaction_id,
            'paid_amount', new.amount
          )),
          null,
          now()
        );

        if new.event_type = 'order_created'
           and pay_status in ('unpaid','pending','to_pay') then
          perform public.icetak_enqueue_whatsapp_event(
            'payment_pending',
            oid,
            '{}'::jsonb,
            'initial_reminder',
            now() + interval '60 minutes'
          );
        end if;
      else
        update public.notification_outbox
        set status = 'skipped',
            error_code = 'order_whatsapp_disabled',
            error_message = 'WhatsApp disabled for this order'
        where id = new.id;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.icetak_admin_order_notification_states(p_order_nos text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  result_value jsonb;
begin
  if not (
    public.icetak_admin_has_permission('view_orders')
    or public.icetak_admin_can_manage_whatsapp()
  ) then
    raise exception 'Forbidden';
  end if;

  select coalesce(
    jsonb_object_agg(
      coalesce(nullif(order_no, ''), order_id),
      coalesce(whatsapp_opt_in, false)
    ),
    '{}'::jsonb
  )
  into result_value
  from public.orders
  where coalesce(nullif(order_no, ''), order_id) = any(coalesce(p_order_nos, array[]::text[]));

  return result_value;
end;
$function$;

create or replace function public.icetak_admin_set_order_whatsapp(
  p_order_no text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  order_row public.orders%rowtype;
  cancelled_queue integer := 0;
  cancelled_outbox integer := 0;
  actor_value text;
begin
  if not (
    public.icetak_admin_has_permission('edit_order')
    or public.icetak_admin_can_manage_whatsapp()
  ) then
    raise exception 'Forbidden';
  end if;

  select *
  into order_row
  from public.orders
  where order_no = p_order_no
     or order_id = p_order_no
  limit 1
  for update;

  if order_row.id is null then
    raise exception 'Order not found';
  end if;

  update public.orders
  set whatsapp_opt_in = coalesce(p_enabled, false),
      updated_at = now()
  where id = order_row.id;

  if not coalesce(p_enabled, false) then
    update public.notification_queue
    set status = 'skipped',
        processed_at = now(),
        locked_at = null,
        decision_mode = 'skipped',
        decision_reason = 'order_disabled_by_admin',
        last_error = null
    where order_id = order_row.id
      and status = 'pending';
    get diagnostics cancelled_queue = row_count;

    update public.notification_outbox
    set status = 'skipped',
        error_code = 'order_whatsapp_disabled',
        error_message = 'Disabled by admin'
    where (order_id = order_row.order_no
       or order_id = order_row.order_id
       or order_token = order_row.public_token)
      and status = 'pending';
    get diagnostics cancelled_outbox = row_count;
  end if;

  select username
  into actor_value
  from public.admin_users
  where auth_user_id = auth.uid()
  limit 1;

  insert into public.admin_audit(order_db_id, order_id, action, actor, payload)
  values (
    order_row.id::text,
    coalesce(order_row.order_no, order_row.order_id),
    case when coalesce(p_enabled, false)
      then 'whatsapp_enabled'
      else 'whatsapp_disabled'
    end,
    coalesce(actor_value, 'admin'),
    jsonb_build_object(
      'enabled', coalesce(p_enabled, false),
      'cancelled_queue', cancelled_queue,
      'cancelled_outbox', cancelled_outbox
    )
  );

  return jsonb_build_object(
    'order_no', coalesce(order_row.order_no, order_row.order_id),
    'enabled', coalesce(p_enabled, false),
    'cancelled_pending', cancelled_queue + cancelled_outbox
  );
end;
$function$;

create or replace function public.icetak_admin_notification_control_summary()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  global_enabled_value boolean;
begin
  if not (
    public.icetak_admin_has_permission('view_orders')
    or public.icetak_admin_can_manage_whatsapp()
  ) then
    raise exception 'Forbidden';
  end if;

  select lower(coalesce(text_value, 'true')) in ('true','1','yes','enabled')
  into global_enabled_value
  from public.whatsapp_settings
  where key = 'enabled'
  limit 1;

  return jsonb_build_object(
    'global_enabled', coalesce(global_enabled_value, true),
    'enabled_count', (select count(*) from public.whatsapp_notification_rules where enabled = true),
    'total_count', (select count(*) from public.whatsapp_notification_rules),
    'enabled_events', coalesce((
      select jsonb_agg(event_type order by sort_order, event_type)
      from public.whatsapp_notification_rules
      where enabled = true
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.icetak_whatsapp_rule_disable_queue_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.enabled is distinct from new.enabled
     and new.enabled = false then
    update public.notification_queue
    set status = 'skipped',
        processed_at = now(),
        locked_at = null,
        decision_mode = 'skipped',
        decision_reason = 'event_rule_disabled',
        last_error = null
    where event_type = new.event_type
      and status = 'pending';
  end if;

  return new;
end;
$function$;

drop trigger if exists icetak_whatsapp_rule_disable_queue_trg
on public.whatsapp_notification_rules;

create trigger icetak_whatsapp_rule_disable_queue_trg
after update of enabled on public.whatsapp_notification_rules
for each row
execute function public.icetak_whatsapp_rule_disable_queue_trigger();

create or replace function public.icetak_whatsapp_global_disable_queue_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  enabled_value boolean;
begin
  if new.key <> 'enabled' then
    return new;
  end if;

  enabled_value := lower(coalesce(new.text_value, 'true')) in ('true','1','yes','enabled');

  if not enabled_value then
    update public.notification_queue
    set status = 'skipped',
        processed_at = now(),
        locked_at = null,
        decision_mode = 'skipped',
        decision_reason = 'global_notifications_disabled',
        last_error = null
    where status = 'pending';
  end if;

  return new;
end;
$function$;

drop trigger if exists icetak_whatsapp_global_disable_queue_trg
on public.whatsapp_settings;

create trigger icetak_whatsapp_global_disable_queue_trg
after insert or update on public.whatsapp_settings
for each row
execute function public.icetak_whatsapp_global_disable_queue_trigger();

create index if not exists notification_queue_pending_event_order_idx
on public.notification_queue(event_type, order_id)
where status = 'pending';

revoke all on function public.icetak_admin_order_notification_states(text[]) from public;
revoke all on function public.icetak_admin_set_order_whatsapp(text, boolean) from public;
revoke all on function public.icetak_admin_notification_control_summary() from public;

grant execute on function public.icetak_admin_order_notification_states(text[]) to authenticated, service_role;
grant execute on function public.icetak_admin_set_order_whatsapp(text, boolean) to authenticated, service_role;
grant execute on function public.icetak_admin_notification_control_summary() to authenticated, service_role;

comment on function public.icetak_admin_set_order_whatsapp(text, boolean)
is 'Admin order-level WhatsApp switch. Disabling cancels unsent pending notifications; enabling applies to future events only.';
