-- Read-only order context for the authenticated Auto Draft bridge.
-- A draft still converts at order creation. Fulfillment owns the later chat window.
create function public.icetak_auto_draft_fulfillment_context(
  p_conversation_id uuid,
  p_customer_phone text,
  p_customer_master_id uuid,
  p_cutoff_at timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with identity as (
    select nullif(public.icetak_normalize_phone(p_customer_phone), '') as phone
  ), matched as (
    select s.order_id
    from public.order_sessions s
    where s.conversation_id = p_conversation_id and s.order_id is not null
    union
    select o.id
    from public.customers c
    join public.orders o on o.customer_id = c.id
    cross join identity i
    where (p_customer_master_id is not null and c.customer_master_id = p_customer_master_id)
       or (i.phone is not null and public.icetak_normalize_phone(c.phone) = i.phone)
  ), recent as (
    select o.*
    from matched m join public.orders o on o.id = m.order_id
    where o.created_at <= p_cutoff_at
      and o.created_at >= p_cutoff_at - interval '45 days'
    order by o.created_at desc, o.id desc
    limit 25
  ), fulfillment as (
    select o.id, o.order_no, o.created_at,
      case
        when o.pickup_ready_at is not null then o.pickup_ready_at
        when lower(o.fulfillment_stage) in ('ready_for_pickup','ready_to_collect') then o.updated_at
        when parcels.total > 0 and parcels.total = parcels.handed_over then parcels.last_handover
        when parcels.total = 0 and (
          lower(o.shipment_status_group) in ('picked_up','shipped','in_transit','out_for_delivery','delivered')
          or lower(o.fulfillment_stage) in ('shipped','in_transit','out_for_delivery','delivered')
          or lower(o.status::text) = 'shipped'
        ) then coalesce(o.shipment_updated_at, o.delivered_at, o.updated_at)
        when o.pickup_collected_at is not null then o.pickup_collected_at
        when lower(o.status::text) in ('cancelled','canceled') or lower(o.fulfillment_stage) = 'cancelled' then o.updated_at
      end as terminal_at
    from recent o
    cross join lateral (
      select count(*) as total, count(handover.at) as handed_over, max(handover.at) as last_handover
      from public.shipments s
      cross join lateral (
        select coalesce(
          s.shipped_at,
          case when lower(s.status_group) in ('picked_up','shipped','in_transit','out_for_delivery','delivered')
               then s.updated_at end
        ) as at
      ) handover
      where s.order_id = o.id and s.archived_at is null and s.cancelled_at is null
        and lower(coalesce(s.status_group,'')) not in ('cancelled','canceled')
    ) parcels
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', id, 'order_no', order_no, 'created_at', created_at, 'terminal_at', terminal_at
  ) order by created_at desc, id desc), '[]'::jsonb)
  from fulfillment;
$$;

revoke all on function public.icetak_auto_draft_fulfillment_context(uuid,text,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.icetak_auto_draft_fulfillment_context(uuid,text,uuid,timestamptz)
  to service_role;
