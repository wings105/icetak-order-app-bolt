# Shopee webhook operations and recovery

## Scope and status — 2026-10-12 UTC

The owner approved the full webhook audit remediation, including historical failed-event recovery, auxiliary alert projection, deadline/region/session repairs and financial history enrichment. Order System retains raw and canonical order/accounting authority; Unified Inbox retains chat, order sessions and private Shopee credentials.

Backend PRODUCTION: live migrations and 11 active Edge bundles match this source exactly. Live state has 79 completed recoveries, zero failed raw events, 3,213 closed / 98 open Inbox order sessions, zero terminal conversations incorrectly marked needs_reply, and both existing video messages have media URLs. Return history replay supplies 27 solutions; bounded API reads have supplied 13 refund details. Counts are observations, not fixed targets; scheduled history processing continues.

Frontend VERIFIED in the closest controlled environment: real Monitor, Settings and MessageBubble components rendered with their CSS at desktop 1440x1000 and mobile 390x844. Retry, resolve alert, currency/missing-money display, SG configuration isolation and rich cards pass with no application console errors or mobile overflow. Hosted signed-in owner interaction remains unexercised. Hosted delivery PRODUCTION: PR #86 release 572b65f84f897bfc65a3b6d29502bd2e43cba7e8 / Worker 67c9a35a-aad6-4543-8f4c-f81f80f2dc40 passed Workers Builds and public-domain guard. The exact Monitor URL reaches secure Admin Login with no application console errors; its loaded root entry is main-BTN8VOpx.js. Hosted signed-in owner behavior and direct asset-content extraction were not exercised.

SG credential import is BLOCKED, not completed. The automatic approval reviewer rejected transmitting the existing bridge token, Partner Key and SG Access Token to the Inbox configuration endpoint without explicit authorization of that credential destination. No SG credential slot was saved. Provider compatibility of the candidate SG credentials remains unverified. Do not work around the rejection through SQL or another transport. The MY connection remains the verified source for direct financial reads.

## What each received event does

| Code | Raw event | Use after upgrade |
|---|---|---|
| 3 | Order status | Canonical order/status history; existing reconciliation and Inbox projection |
| 4 | Tracking | Shipping/tracking projection and recovery of failed processing |
| 5 | Notifications | Durable shop alerts; buyer-waiting-reply becomes a shop-level reminder |
| 9 | Promotion | Promotion alert |
| 10 | Chat/message/notification | Durable Inbox recovery; original receipt time, message ID and history boundary |
| 15 | Shipment status | Shipment projection |
| 16 | Deleted/deboosted listing | Listing severity, violation reason, provider suggestion and fix deadline |
| 22 | Price changes | Old/new price alert scoped to the seller shop |
| 28 | Penalty | Critical shop alert with issued points |
| 29 | Return/refund | Status and reverse logistics, solution, refund/reason detail through read-only API |
| 30 | Fulfillment | Existing fulfillment projection |
| 47 | Order changes | Ship-by deadline applied with provider timestamp guard |
| No code | Full order detail | Buyer/address/products/payment/shipping fields, preserving newer deadline evidence |

An unsupported heartbeat remains raw-only. Unknown fields are retained as raw evidence; a processed event does not mean every provider field drives an action. Shop reminders do not contain a reliable buyer ID, so no customer is guessed from abbreviated names and no automatic reply is sent.

## Recovery and runtime limits

`marketplace_ops` is private with RLS, no anon/authenticated schema access and service-only operational RPCs. Inserted chat and failed normalized events receive durable jobs. The existing private bridge authenticates the worker and Inbox ingestion; platform JWT is retained for authenticated admin/finance surfaces.

- Recovery cron: once per minute; default 20 jobs, hard maximum 50; lease UUID, five-minute lease recovery, eight attempts with backoff and audited dead-letter state.
- Webhook fast path is preserved. Duplicate capture does not repeat downstream chat/COMPLETED fan-out; queue repair remains independent.
- Admin V2 Shopee Monitor: `/?admin=v2&view=shopee-monitor`. Active owner or view_orders can read; manage_orders is required for recovery/alert actions. Finance rows require view_finance or owner. Actor comes from verified admin identity. Raw event listing is bounded to 100 rows. Optional 60-second page refresh is off by default and pauses while hidden.
- Recovery only restores stored evidence and projections. It does not send customer messages, approve refunds or generate new orders from historical chat.
- Recent chat recovery resolves buyer identity inside the Order project. Historical chat does not overwrite current identity/name metadata, primary order links or active provisional order/session context, and is excluded from the existing AI queue.

## Session, media and region rules

SHIPPED, TO_CONFIRM_RECEIVE, COMPLETED, CANCELLED, TO_RETURN and RETURNED close the matching shop/buyer/order session. Old messages cannot reopen Perlu Balas. A genuinely new active order remains eligible. Successful manual reply proof and concurrent-inbound protection continue through complete_shopee_reply; provider auto_reply/offwork_autoreply does not resolve a customer waiting for a person.

Known seller shop 188218638 owns MY/MYR; 1635364464 owns SG/SGD. The approved repair changed 31 incorrectly labelled SG orders and their financial currency labels, without converting numerical amounts. Shopee wallet accounts are separate by currency. Chat ingestion also derives region from the known seller shop before payload fallback.

Video media URLs are normalized. Order/item/variation/bundle/voucher/return/cancellation cards expose bounded escaped fields and safe HTTPS images. Existing text/media rendering remains intact.

## Direct finance: evidence before accounting

The old Activepieces finance dispatcher is disabled (configuration and cron); iCetak reads fixed signed GET paths using the existing Inbox credential owner. Token refresh remains owned by the existing ClickUp/Activepieces refresh producer; no competing refresh loop was added.

- Worker claim/cooldown: five minutes, 10 enrichment jobs by scheduled invocation, hard maximum 20. Current READY_TO_SHIP/PROCESSED details take priority over history.
- Escrow detail is estimated/pending release. Only explicit provider release time/status/payout evidence populates released_amount. Missing amounts/fees remain NULL and render Belum diterima; verified zero stays zero.
- Release history uses per-shop seven-day windows, 100-row pages, persisted cursor and six-hour recent polling after catch-up. Enrichment failures defer 12 hours; credential blocks defer 24 hours. Existing finance attempts remain bounded.
- Return reads: at most three per finance run, six-hour failure backoff and eight attempts. Reads never approve/refund a return.
- Core fees plus bounded fee_breakdown retain shipping, reverse shipping, seller/Shopee adjustments, voucher, coins, affiliate and pay-per-sale evidence. Existing finance catalog already supports detailed provider fields.
- Provider response normalization has stable hashes; ingest and wallet release evidence remain idempotent. SGD releases route only to the SGD wallet.
- Live MY API probes returned actual escrow detail (99 income fields) and release rows containing order_sn, payout_amount and escrow_release_time. An explicit two-day release probe ingested 56 records, all applied with no unresolved mapping/order rows. Scheduled confirmed releases and detail backfill continue thereafter.

Historical enrichment is asynchronous. Pending release may be valid until Shopee releases money; failed credential reads are visible and do not become zero or borrow another shop's credentials. Monitor shows progress and sanitized worker errors.

## Per-shop credentials

Primary MY retains private key shopee_chat_direct_config for backward compatibility. Other shops use shopee_chat_direct_config:<shop_id>. Settings selection, get/save/check, rotation key generation, token pushes and sending use the exact shop slot. No SG slot inherits the MY access token. A token-rotation payload must include its own shop_id; the existing refresh producer must push each shop to its dedicated rotation key. Unknown expiry remains unknown and requires provider readiness checks for sends.

## Verification and operating checks

- `node scripts/check-shopee-ops.mjs`: 59 assertions for actual release evidence, missing/zero fees, secret stripping, rich cards, unsafe images, seller region, live-source gateway authorization/finance redaction and current/history recovery identity handling.
- `node scripts/check-shopee-direct.mjs`: 30 checks for signing, expiry, shop guards, redaction, owner configuration, scoped rotation and send idempotency.
- `node scripts/check-order-session-isolation.mjs`: existing active-session extraction regressions pass.
- Run supabase/tests/shopee_webhook_operations.test.sql and backend/inbox/shopee-webhook-operations.test.sql only inside BEGIN/ROLLBACK on their respective projects. Actual service_role tests prove deadlines do not regress, aux alerts deduplicate, recovery persists, regions/currencies match, history does not reopen context or replace current identity, video URLs persist, active new orders remain replyable and private grants remain sealed. Finance rollback cases also prove escrow does not post a release, missing fees stay NULL, verified zero stays zero and duplicate SGD release uses exactly one SGD wallet event.
- Root build includes /inbox; Inbox typecheck and Admin V2 build pass. Eleven deployed Edge bundles and relative dependencies match local source byte-for-byte.
- Anonymous POSTs are rejected on worker, private finance fetch and protected ingestion; admin Monitor keeps its JWT and active-admin checks.

Do not mark SG connected or all historical finance complete until the corresponding live outcome is observed. Do not resolve operational alerts automatically; the staff action is audited and can be reopened.
