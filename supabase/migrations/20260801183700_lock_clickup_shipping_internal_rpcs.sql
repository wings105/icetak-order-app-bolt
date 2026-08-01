-- Internal ClickUp/shipping RPCs are callable only by trusted server-side code.
revoke all on function public.icetak_public_app_base_url() from public,anon,authenticated;
revoke all on function public.icetak_order_links(uuid) from public,anon,authenticated;
revoke all on function public.icetak_upsert_admin_customer_address(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.enqueue_clickup_production_order(uuid) from public,anon,authenticated;
revoke all on function public.claim_clickup_production_outbox(integer) from public,anon,authenticated;
revoke all on function public.enqueue_clickup_shipping_update(uuid) from public,anon,authenticated;
revoke all on function public.claim_clickup_shipping_outbox(integer) from public,anon,authenticated;
revoke all on function public.link_clickup_production_task(text,uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.replay_clickup_events_for_task(text) from public,anon,authenticated;
revoke all on function public.reconcile_shipments_for_reference(text) from public,anon,authenticated;
revoke all on function public.resolve_shipping_order_reference(text) from public,anon,authenticated;
revoke all on function public.ingest_clickup_event(jsonb) from public,anon,authenticated;
revoke all on function public.process_clickup_task_events(text) from public,anon,authenticated;
revoke all on function public.process_clickup_sync_queue(integer) from public,anon,authenticated;
revoke all on function public.production_components_enqueue_clickup_after_insert() from public,anon,authenticated;
revoke all on function public.shipments_enqueue_clickup_update() from public,anon,authenticated;
revoke all on function public.clickup_tasks_enqueue_existing_shipping() from public,anon,authenticated;
revoke all on function public.orders_enqueue_clickup_after_ready() from public,anon,authenticated;
revoke all on function public.clickup_mapping_reconcile_shipments() from public,anon,authenticated;
revoke all on function public.shipment_resolve_order_before_write() from public,anon,authenticated;
revoke all on function public.shipment_sync_order_after_write() from public,anon,authenticated;

grant execute on function public.icetak_public_app_base_url() to service_role;
grant execute on function public.icetak_order_links(uuid) to service_role;
grant execute on function public.icetak_upsert_admin_customer_address(uuid,jsonb) to service_role;
grant execute on function public.enqueue_clickup_production_order(uuid) to service_role;
grant execute on function public.claim_clickup_production_outbox(integer) to service_role;
grant execute on function public.enqueue_clickup_shipping_update(uuid) to service_role;
grant execute on function public.claim_clickup_shipping_outbox(integer) to service_role;
grant execute on function public.link_clickup_production_task(text,uuid,text,text,text,text) to service_role;
grant execute on function public.replay_clickup_events_for_task(text) to service_role;
grant execute on function public.reconcile_shipments_for_reference(text) to service_role;
grant execute on function public.resolve_shipping_order_reference(text) to service_role;
grant execute on function public.ingest_clickup_event(jsonb) to service_role;
grant execute on function public.process_clickup_task_events(text) to service_role;
grant execute on function public.process_clickup_sync_queue(integer) to service_role;

-- Trigger functions are not public RPC endpoints.
grant execute on function public.production_components_enqueue_clickup_after_insert() to service_role;
grant execute on function public.shipments_enqueue_clickup_update() to service_role;
grant execute on function public.clickup_tasks_enqueue_existing_shipping() to service_role;
grant execute on function public.orders_enqueue_clickup_after_ready() to service_role;
grant execute on function public.clickup_mapping_reconcile_shipments() to service_role;
grant execute on function public.shipment_resolve_order_before_write() to service_role;
grant execute on function public.shipment_sync_order_after_write() to service_role;

-- Admin RPCs are available to signed-in users only; each function also performs its own admin/permission check.
revoke all on function public.icetak_admin_dashboard_for_current_user() from public,anon;
revoke all on function public.icetak_admin_create_order(jsonb) from public,anon;
revoke all on function public.icetak_admin_create_whatsapp_paid_order(jsonb) from public,anon;
revoke all on function public.icetak_admin_customer_lookup(text) from public,anon;
revoke all on function public.icetak_admin_order_action(jsonb) from public,anon;
revoke all on function public.icetak_admin_order_update(jsonb) from public,anon;
revoke all on function public.icetak_admin_order_sync_status(uuid) from public,anon;
revoke all on function public.icetak_admin_save_permissions(jsonb) from public,anon;
revoke all on function public.icetak_admin_export_data() from public,anon;
revoke all on function public.icetak_admin_has_permission(text) from public,anon;

grant execute on function public.icetak_admin_dashboard_for_current_user() to authenticated,service_role;
grant execute on function public.icetak_admin_create_order(jsonb) to authenticated,service_role;
grant execute on function public.icetak_admin_create_whatsapp_paid_order(jsonb) to authenticated,service_role;
grant execute on function public.icetak_admin_customer_lookup(text) to authenticated,service_role;
grant execute on function public.icetak_admin_order_action(jsonb) to authenticated,service_role;
grant execute on function public.icetak_admin_order_update(jsonb) to authenticated,service_role;
grant execute on function public.icetak_admin_order_sync_status(uuid) to authenticated,service_role;
grant execute on function public.icetak_admin_save_permissions(jsonb) to authenticated,service_role;
grant execute on function public.icetak_admin_export_data() to authenticated,service_role;
grant execute on function public.icetak_admin_has_permission(text) to authenticated,service_role;
