revoke execute on function public.icetak_admin_customer_lookup(text) from anon;
revoke execute on function public.icetak_admin_create_whatsapp_paid_order(jsonb) from anon;
revoke execute on function public.icetak_admin_order_sync_status(uuid) from anon;
grant execute on function public.icetak_admin_customer_lookup(text) to authenticated,service_role;
grant execute on function public.icetak_admin_create_whatsapp_paid_order(jsonb) to authenticated,service_role;
grant execute on function public.icetak_admin_order_sync_status(uuid) to authenticated,service_role;
