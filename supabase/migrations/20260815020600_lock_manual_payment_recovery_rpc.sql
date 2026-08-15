revoke all on function public.icetak_admin_payment_override_v1(jsonb) from public;
revoke all on function public.icetak_admin_payment_override_v1(jsonb) from anon;
grant execute on function public.icetak_admin_payment_override_v1(jsonb) to authenticated;
grant execute on function public.icetak_admin_payment_override_v1(jsonb) to service_role;
