-- Fix the QRPay draft confirmation metadata re-apply ordering.
-- order_items has no created_at; canonical multi-item order is sort_index.
-- This migration patches the function emitted by the previous QRPay draft migration
-- while remaining safe to replay if the function is already fixed.

do $fix$
declare
  v_def text;
  v_old constant text := 'row_number() over(order by created_at,id)::int rn';
  v_new constant text := 'row_number() over(order by sort_index nulls last,updated_at,id)::int rn';
begin
  select pg_get_functiondef('public.icetak_confirm_qrpay_order_draft(text,jsonb,jsonb,jsonb,text)'::regprocedure)
    into v_def;

  if v_def is null then
    raise exception 'icetak_confirm_qrpay_order_draft not found';
  end if;

  if position(v_old in v_def) > 0 then
    v_def := replace(v_def, v_old, v_new);
  elsif position(v_new in v_def) = 0 then
    raise exception 'QRPay confirm function has an unexpected item-ordering definition';
  end if;

  execute v_def;
end
$fix$;

revoke all on function public.icetak_confirm_qrpay_order_draft(text,jsonb,jsonb,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.icetak_confirm_qrpay_order_draft(text,jsonb,jsonb,jsonb,text)
  to service_role;
