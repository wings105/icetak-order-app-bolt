-- Keep worker-only operational data inaccessible to browser-facing API roles.
-- Existing Edge Functions use service_role, which retains its current access.
set local lock_timeout = '2s';
set local statement_timeout = '15s';

alter table public.wasapflow_maintenance_audit enable row level security;
alter table public.admin_order_reply_poll_state enable row level security;

revoke all on table public.wasapflow_maintenance_audit
  from public, anon, authenticated;
revoke all on table public.admin_order_reply_poll_state
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.wasapflow_maintenance_audit
  to service_role;
grant select, insert, update, delete
  on table public.admin_order_reply_poll_state
  to service_role;
