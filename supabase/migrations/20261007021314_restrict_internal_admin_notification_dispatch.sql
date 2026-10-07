-- Notification dispatchers are internal trigger/worker operations, not public RPCs.
revoke execute on function public.icetak_kick_admin_order_notification(uuid) from public,anon,authenticated;
grant execute on function public.icetak_kick_admin_order_notification(uuid) to service_role;
revoke execute on function public.icetak_admin_notification_from_order_insert() from public,anon,authenticated;
grant execute on function public.icetak_admin_notification_from_order_insert() to service_role;
