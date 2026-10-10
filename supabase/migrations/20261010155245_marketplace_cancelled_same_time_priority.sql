-- Order System only. Provider time remains authoritative; final cancellation wins ties.
-- CREATE OR REPLACE preserves the existing service_role-only EXECUTE grants.
CREATE OR REPLACE FUNCTION public.reconcile_marketplace_order_status(p_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_occurred_at timestamptz;
begin
  -- Serialize reconciliation with webhook ingestion's canonical-order upsert.
  perform 1 from public.marketplace_orders where id = p_order_id for update;

  select h.status, h.occurred_at
    into v_status, v_occurred_at
  from public.marketplace_order_status_history h
  where h.order_id = p_order_id
    and h.event_kind = 'order_status'
    and nullif(h.status,'') is not null
  order by h.occurred_at desc nulls last,
    case when h.status = 'CANCELLED' then 1 else 0 end desc,
    h.created_at desc, h.id desc
  limit 1;

  if v_status is null then
    return null;
  end if;

  update public.marketplace_orders
     set current_status = v_status,
         payment_status = case
           when v_status = 'UNPAID' then 'unpaid'
           when v_status in ('READY_TO_SHIP','PROCESSED','SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','IN_CANCEL') then 'paid'
           else payment_status
         end,
         latest_provider_update_at = greatest(
           coalesce(latest_provider_update_at, '-infinity'::timestamptz),
           coalesce(v_occurred_at, '-infinity'::timestamptz)
         ),
         updated_at = now()
   where id = p_order_id
     and (
       current_status is distinct from v_status
       or payment_status is distinct from case
         when v_status = 'UNPAID' then 'unpaid'
         when v_status in ('READY_TO_SHIP','PROCESSED','SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','IN_CANCEL') then 'paid'
         else payment_status
       end
     );

  return v_status;
end;
$function$
