-- Keep the inbox conversation status separate from the order-extraction
-- session. Only the internal service-role bridge can read this batched view.
create or replace function public.icetak_order_session_status_batch(
  p_conversations jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
begin
  if jsonb_typeof(p_conversations) <> 'array' then
    raise exception 'Conversation list must be an array';
  end if;

  if jsonb_array_length(p_conversations) > 1000 then
    raise exception 'A maximum of 1000 conversations is allowed per batch';
  end if;

  with raw_requests as (
    select
      entry->>'conversation_id' as conversation_id,
      regexp_replace(coalesce(entry->>'phone', ''), '[^0-9]', '', 'g') as phone
    from jsonb_array_elements(p_conversations) entry
    where jsonb_typeof(entry) = 'object'
      and coalesce(entry->>'conversation_id', '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), requested as (
    select distinct on (conversation_id)
      conversation_id::uuid as conversation_id,
      case
        when left(phone, 1) = '0' then '6' || phone
        when left(phone, 1) = '1' then '60' || phone
        else phone
      end as customer_phone
    from raw_requests
    order by conversation_id, phone desc
  )
  select coalesce(
    jsonb_object_agg(
      requested.conversation_id::text,
      case
        when session.id is null then jsonb_build_object('state', 'none')
        else jsonb_build_object(
          'state', case when session.is_active then 'active' else 'closed' end,
          'session_id', session.id,
          'session_status', session.status,
          'opened_at', session.opened_at,
          'closed_at', session.closed_at,
          'closed_reason', session.closed_reason,
          'order_no', session.order_no
        )
      end
    ),
    '{}'::jsonb
  )
  into v_result
  from requested
  left join lateral (
    select
      s.id,
      s.status,
      s.opened_at,
      s.closed_at,
      s.closed_reason,
      o.order_no,
      (
        s.closed_at is null
        and s.status in (
          'open', 'draft_created', 'ready_customer',
          'customer_confirmed', 'awaiting_payment', 'paid'
        )
      ) as is_active
    from public.order_sessions s
    left join public.orders o on o.id = s.order_id
    where s.conversation_id = requested.conversation_id
      or (
        requested.customer_phone <> ''
        and s.customer_phone = requested.customer_phone
      )
    order by
      (
        s.closed_at is null
        and s.status in (
          'open', 'draft_created', 'ready_customer',
          'customer_confirmed', 'awaiting_payment', 'paid'
        )
      ) desc,
      coalesce(s.closed_at, s.opened_at) desc,
      s.created_at desc
    limit 1
  ) session on true;

  return v_result;
end;
$function$;

revoke all on function public.icetak_order_session_status_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.icetak_order_session_status_batch(jsonb)
  to service_role;
