-- Unified Order Draft Engine V1 final hardening snapshot
-- Production hardening applied 2026-08-13.

create index if not exists fulfillment_group_orders_order_id_idx
  on public.fulfillment_group_orders(order_id);
create index if not exists fulfillment_groups_master_order_id_idx
  on public.fulfillment_groups(master_order_id);
create index if not exists order_sessions_order_id_idx
  on public.order_sessions(order_id);
create index if not exists order_sessions_parent_order_id_idx
  on public.order_sessions(parent_order_id);
create index if not exists qrpay_order_drafts_combine_with_order_id_idx
  on public.qrpay_order_drafts(combine_with_order_id);
create index if not exists qrpay_order_drafts_parent_order_id_idx
  on public.qrpay_order_drafts(parent_order_id);
create index if not exists payment_transactions_payment_session_id_idx
  on public.payment_transactions(payment_session_id);

alter table public.order_sessions enable row level security;
alter table public.fulfillment_groups enable row level security;
alter table public.fulfillment_group_orders enable row level security;

revoke all on function public.icetak_order_session_boundary(uuid,text) from public,anon,authenticated;
grant execute on function public.icetak_order_session_boundary(uuid,text) to service_role;

revoke all on function public.icetak_open_order_session(uuid,text,text,text,timestamptz,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_open_order_session(uuid,text,text,text,timestamptz,uuid,jsonb) to service_role;

revoke all on function public.icetak_create_generic_order_draft(text,uuid,text,text,jsonb,text,timestamptz,uuid,text,text) from public,anon,authenticated;
grant execute on function public.icetak_create_generic_order_draft(text,uuid,text,text,jsonb,text,timestamptz,uuid,text,text) to service_role;

revoke all on function public.icetak_prepare_draft_payment(text,boolean) from public,anon,authenticated;
grant execute on function public.icetak_prepare_draft_payment(text,boolean) to service_role;

revoke all on function public.icetak_finalize_generic_order_draft(uuid,text) from public,anon,authenticated;
grant execute on function public.icetak_finalize_generic_order_draft(uuid,text) to service_role;

revoke all on function public.icetak_admin_approve_draft_for_customer(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_admin_approve_draft_for_customer(text,jsonb,text) to service_role;

revoke all on function public.icetak_customer_confirm_draft(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_customer_confirm_draft(text,jsonb,text) to service_role;

revoke all on function public.icetak_customer_request_draft_change(text,text,text) from public,anon,authenticated;
grant execute on function public.icetak_customer_request_draft_change(text,text,text) to service_role;

revoke all on function public.icetak_record_generic_draft_learning(uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_record_generic_draft_learning(uuid,jsonb,jsonb,text) to service_role;
