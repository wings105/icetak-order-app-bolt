-- Cash checkout requests admin approval even before customer link confirmation.
-- Reuses the existing unique notification job and authenticated Confirm Production override.
create or replace function public.icetak_customer_cash_needs_review(p_order public.orders)
returns boolean language sql immutable security invoker
set search_path to 'public','pg_temp'
as $$
  select lower(coalesce(p_order.source,'')) in ('customer','customer_portal')
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
