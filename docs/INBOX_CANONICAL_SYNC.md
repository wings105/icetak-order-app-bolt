# Unified Inbox data and sending

The main source for orders, payment, and production is `icetak-order-system`
(`buivecgahhmrhlmfujgt`). `icetak-unified-inbox` (`uujcqcsfghqkukaydruc`)
retains messages and an order cache. Frontend source is `apps/inbox` and is
published by the existing shop build at `/inbox/`. Live Cloudflare hosting follows
`production`; `main` builds a preview. Only this inbox release was carried onto
production, preserving its separate admin changes.

## Order sync

Apply `backend/inbox/order-sync-queue.sql`, then `order-sync-followup.sql` to
main, and `order-auto-link.sql` to Inbox. These have already been applied in
production. `inbox_sync.jobs` is private; Cron runs `inbox_sync.run()` every
minute. Order, item, shipment, and customer phone changes enqueue updates.
Changes during a request remain pending after its response. Failed requests
retry up to eight attempts with exponential backoff; missing responses recover
after three minutes. Non-JSON responses cannot stop the worker.

Deploy main `order-inbox-sync-worker`, `sync-marketplace-orders-to-inbox`, and
`sync-active-orders-to-inbox` with their `_shared` dependency. The existing
`admin_window_bridge_token` already matches in both projects. It stays in
private runtime settings. New custom-auth receivers require this token;
legacy main sync endpoints require their own service credential. No service
key is sent to the browser. Inbox receiver is `inbox-order-sync`.

Shopee auto-link requires buyer ID and seller shop ID. Phone links require
one verified WhatsApp customer identity. Phone links do not become primary
context; when multiple orders apply, staff must confirm which order is being
discussed. Shopee usernames alone are suggestions. A customer confirmation is
shown separately from Shopee's API `detail_complete` field.

All source orders were backfilled on 10 October 2026. During rollout a trigger
referenced incompatible order ID fields; it was corrected and all 16 retained
failed marketplace events were reprocessed successfully. The affected chat
identity was also resynchronized. SQL rollback verification now covers updates
to both main order tables and changes during an in-flight request.

## Shopee send adapter

Apply `backend/inbox/shopee-send-audit.sql` to Inbox. Inbox and AI Dashboard
share `_shared/shopee-send.ts`. An approved manual send gets a request UUID,
atomic pending message and audit attempt. Retries of the same UUID never send
again. A provider message ID is required to mark it sent. API errors inside
HTTP 200, missing IDs, and uncertain network results are handled separately.
No real customer messages were sent during validation.

The existing adapter is not configured. Its two private Inbox settings are
`shopee_chat_send_endpoint` (HTTPS) and `shopee_chat_send_token`. This requires
an authenticated Shopee Chat adapter with the shop's Chat API permission;
the existing financial broker is not assumed to support chat.

Adapter input: `action=send_message`, `provider=shopee`, `request_id`, local
`conversation_id`, `provider_conversation_id`, `shop_id`, `buyer_user_id`,
`buyer_shop_id`, optional `order_sn`, `message_type=text`, and `text`.
It receives `Idempotency-Key` and Bearer authentication. Success must return
`message_id` or `provider_message_id` (also supported under `data` or
`response`). It must retain the idempotency result for retries. Media and a
first conversation without an existing chat are still unsupported.

## UI and AI

White is default. Black/White is stored in `icetak-inbox-theme-v1`.
Desktop opens the workspace with a selected chat. Sending state is visible;
clicking Send does not clear customer work before provider confirmation.

Existing AI is `gte-small` with rules, not a GPT reply generator. Payment
matching now compares whole statuses so `unpaid` cannot match `paid`. Two
active linked orders require an explicit reference or confirmed primary order.
OpenAI reply generation remains gated on the user's key reuse/new-key decision.

Validation: inbox TypeScript, full shop+inbox production build, eleven focused
Node tests, SQL rollback tests, queue/cache checks. Local visual browser QA was
blocked by browser binary download failure; cloud browser cannot reach the
local server. After staff login, live White/Black switching, Black persistence after reload,
chat reading, and linked order IC261009-6001 (RM28.50 paid, RM0 balance) were
verified. Browser DOM snapshots timed out after loading the large inbox, so
visual QA used screenshots and documented coordinate interactions. Live
Shopee sending remains untested because its adapter is not configured.
Phone-sized viewport and first-chat/media sending are not verified. Subsequent
visual QA corrected primary order card, navigation and filter contrast in White.
