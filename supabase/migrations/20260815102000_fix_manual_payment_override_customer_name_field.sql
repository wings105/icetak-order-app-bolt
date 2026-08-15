do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.icetak_admin_payment_override_v1(jsonb)'::regprocedure) into v_def;
  v_def := replace(
    v_def,
    'coalesce(v_order.delivery_name,v_order.customer_name,''Customer'')',
    'coalesce(v_order.delivery_name,''Customer'')'
  );
  execute v_def;
end $$;

revoke all on function public.icetak_admin_payment_override_v1(jsonb) from public, anon;
grant execute on function public.icetak_admin_payment_override_v1(jsonb) to authenticated, service_role;
