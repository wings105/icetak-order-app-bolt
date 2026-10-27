# Shopee / ClickUp audit every six hours

Production scheduler: Supabase project buivecgahhmrhlmfujgt. Source reads: uujcqcsfghqkukaydruc.

- Cron: `0 */6 * * *` UTC, or 02:00, 08:00, 14:00, 20:00 Asia/Kuala_Lumpur.
- Delivery retry and worker-timeout recovery: every 15 minutes.
- Main worker: `shopee-clickup-audit`; provider bridge: `shopee-order-audit-source`.
- Tables: `public.shopee_clickup_audit_runs` and `public.shopee_clickup_audit_issues`.
- Admin alerts appear in the existing Marketplace Operations alerts feed.
- Notification recipient is resolved from `whatsapp_settings.admin_order_notify_phone`, without a hardcoded fallback.

The source reads official Shopee get_order_list and get_order_detail for MY and SG, covering READY_TO_SHIP and PROCESSED within 90 days in 15-day windows. Pagination is exhausted; incomplete, failed, or rate-limited reads produce an audit-error alert, never a false healthy result. Credentials stay inside server-side workers.

ClickUp reads ORDER LIST and the completed-order archive with closed tasks included. Exact lookups recover reused older tasks. The audit checks order presence, item coverage, extra tasks, repeated sets, ambiguous item matches and explicit quantity prefixes. Dimension names (5 × 5 inch, 6 x 6 inch) are not quantities. A ten-minute grace period allows newly created orders to propagate. Multiple items combined in one task are accepted only when distinct item evidence exists in comments or description. It does not create, delete, merge, complete or update ClickUp tasks.

A unique six-hour run key and a single active-run guard prevent duplicate scheduled executions. Each completed run preserves an order/task mapping and summary. A later complete audit resolves older alerts; API failures preserve unresolved findings. Issues queue one WhatsApp message per run, using the existing whatsapp-send transport and idempotency key. When WhatsApp needs an approved template and none is configured, the alert remains visible and pending, with a retry every 15 minutes. An uncertain provider result is held for review instead of blindly retried. Healthy runs send no routine message.

Security: service-only tables/RPC with RLS enabled and no public policies; scheduler token in Vault; both edge endpoints authenticate requests internally. Public/unauthenticated calls return 401.

Validation: `node --experimental-strip-types supabase/functions/shopee-clickup-audit/compare.test.mjs`; SQL lifecycle regression test uses a rolled-back transaction and never sends a test alert. Live comparison verified 27 orders, 29 item rows, 29 tasks. An initial quantity-parser regression mistook dimensions for quantities; its three false alerts were resolved after correcting the parser and notifying the admin.

