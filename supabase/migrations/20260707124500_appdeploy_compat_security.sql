-- Security hardening for AppDeploy compatibility tables.
-- These compatibility tables are accessed through service-role Edge Functions, not directly by anon clients.

alter table public.notification_outbox enable row level security;
alter table public.admin_audit enable row level security;
alter table public.login_tokens enable row level security;
alter table public.entity_subscriptions enable row level security;

alter function public.icetak_table_counts() set search_path = public;
