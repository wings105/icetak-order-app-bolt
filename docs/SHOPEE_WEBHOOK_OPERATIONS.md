# Shopee webhook operations and recovery

## Scope and status — 2026-10-12 UTC

The owner approved the full webhook audit remediation, including historical failed-event recovery, auxiliary alert projection, deadline/region/session repairs and financial history enrichment. Order System retains raw and canonical order/accounting authority; Unified Inbox retains chat, order sessions and private Shopee credentials.

Backend PRODUCTION: live migrations and 11 active Edge bundles match this source exactly. Live state has 79 completed recoveries, zero failed raw events, 3,213 closed / 98 open Inbox order sessions, zero terminal conversations incorrectly marked needs_reply, and both existing video messages have media URLs. Return history replay supplies 27 solutions; bounded API reads have supplied 13 refund details. Counts are observations, not fixed targets; scheduled history processing continues.

Frontend VERIFIED in the closest controlled environment: real Monitor, Settings and MessageBubble components rendered with their CSS at desktop 1440x1000 and mobile 390x844. Retry, resolve alert, currency/missing-money display, SG configuration isolation and rich cards pass with no application console errors or mobile overflow. Hosted signed-in owner interaction remains unexercised. Hosted delivery PRODUCTION: PR #86 release 572b65f84f897bfc65a3b6d29502bd2e43cba7e8 / Worker 67c9a35a-aad6-4543-8f4c-f81f80f2dc40 passed Workers Builds and public-domain guard. The exact Monitor URL reaches secure Admin Login with no application console errors; its loaded root entry is main-BTN8VOpx.js. Hosted signed-in owner behavior and direct asset-content extraction were not exercised.

SG credential import was explicitly authorized and completed on 13 October 2026. The isolated SG slot has CHAT_READ_VERIFIED / READY after signed provider escrow and refund reads. The old global newest-200 conversation lookup omitted older SG conversations; checkConnection now filters the exact seller shop before its limit. MY credential version/token timestamp were unchanged by that import. All 42 returns now have refund details. The SG release catch-up used 12 seven-day API windows: 95 release records received, 22 matched canonical orders and 73 retained as pending_order without creating orders or wallet entries. There are 22 confirmed SG releases and 21 positive SGD wallet entries, with zero currency mismatch; replay hashes deduplicate. Previously blocked SG jobs were requeued with preserved attempt/error recovery metadata. The owner's newly wired HTTP token push is receiver-verified at 10:59 MYT: SG version 2 / READY with its own rotation key. MY separately refreshed at 10:53 MYT to version 20 / READY. The external scenario schedule and its next scheduled refresh remain unobserved. See SHOPEE_SG_TOKEN_PUSH.md for the request and evidence. No competing refresh loop or customer send was added.

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

## Release polling verification — 13 October 2026, 11:14 MYT

The one-time SG catch-up had accidentally saved next_at as 20 June 2027, suppressing later release polling. Correct only that excessive delay through marketplace_finance_runtime cursor_save, under the shop row lock with an unchanged-window precondition; the actual 11:08 MYT cron resumed SG reads.

A separate worker bug compared an already-read window end to the advancing current clock. With six-minute cron runs, catch-up could never reach its one-minute completion threshold. Version 10 prepares the first-page tail through a fixed request timestamp before the read and uses that same timestamp for completion; later pages retain their original range. Historical ranges stay at most seven days. Recent polling preserves a seven-day overlap; when that overlap ends before the current snapshot, the next bounded invocation reads the remaining fresh tail and then resumes the six-hour cooldown.

The actual 11:14 MYT cron completed signed MY and SG release reads, saved next_at around 17:14 MYT for both shops and finished without error. Exact three-file deployed readback and unchanged verify_jwt/service auth pass. check-shopee-release-cursor.mjs executes six-minute catch-up from 90 days, pagination, a due recent replay/tail, delayed actual handler responses, future-cursor skip, credential backoff and missing-auth rejection. Existing direct/operations checks pass; no provider send/refund mutation or additional refresh loop is introduced. Snapshot counts: 167 completed recoveries, no failed raw events/finance jobs, 42/42 refunds detailed and 2,293 historical detail jobs pending. Counts continue changing as bounded history enrichment proceeds.

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

Orders with missing placed_at use their first recorded created_at for the bounded release-history start; they no longer silently collapse to only the last seven days. The SG cursor was restarted from 18 July 2026, using existing ingest/wallet idempotency. Three real service_role rollback cases prove missing-date history, placed-date priority and the 90-day bound.

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


## Canonical order finance lifecycle — 30 October 2026

Order System now connects canonical order rows directly to the existing signed Inbox
`get_escrow_detail` bridge. A paid/fulfillable order event durably enqueues missing
financial detail and kicks a private worker after the transaction commits. Separate
once-per-minute Order cron jobs run order reads and release/refund maintenance.
No Activepieces flow is required for this finance path; existing token provisioning
in Inbox remains its own responsibility.

The order worker leases at most three distinct orders, calls escrow concurrently,
normalizes the provider's order-level discounted subtotal, nested buyer payment and
numeric fee components, then verifies required persisted fields. A missing financial
row is incomplete. The previous optional-chain `undefined !== null` skip is removed.
A recurring table reconciliation repairs missing/completed jobs without discarding
attempt history. Transient errors use bounded backoff; credentials use an hourly
retry; exhausted ten-attempt jobs no longer remain permanently excluded. Expired
three-minute leases recover; lease UUID checks reject late finish requests.
New-order work is prioritized ahead of historical enrichment.

`marketplace_order_financials` retains:

| Column | Meaning |
|---|---|
| `estimated_escrow_amount` | First recorded pre-release estimate, immutable after capture |
| `estimate_recorded_at`, `estimate_source`, `estimate_snapshot` | Time, provenance and preserved numeric/provider evidence |
| `escrow_checked_at` | Last successful direct escrow read |
| `completed_finance_checked_at` | Successful direct recheck while canonical order is COMPLETED |
| `released_amount`, `released_at` | Existing provider-confirmed wallet release |
| `payout_difference` | Confirmed release minus preserved estimate; NULL before release proof |

Genuine earlier finance events restore the earliest recorded estimate where available.
An old order without pre-release evidence keeps an unknown estimate; its final
payment is never copied into an invented initial estimate. `COMPLETED` triggers a
fresh escrow read even when a financial row already exists. It is not payment proof.
The job remains pending until the signed `get_escrow_list` amount/timestamp proves
wallet release. A successful completion recheck plus release completes the job;
legacy auto-completed jobs missing that recheck are repaired by table reconciliation.

Escrow and buyer postage remain separate from product sales. Fee aliases are not
summed twice; numeric original income components and full scrubbed provider evidence
remain available to the existing finance snapshot/audit pipeline. Extra recognized
fee components populate `other_fees`; unrecognized components remain visible as raw
fields rather than being guessed. Currency/shop checks and idempotent wallet release
writes are retained. No customer message, refund approval or provider payment mutation
is added. Existing sent daily-report snapshots are historical records and are not
silently rewritten or resent; current report reads use the repaired canonical values.

Verification: actual-handler lifecycle and release-cursor regressions; 59 existing
Shopee operations checks; native service-role rollback proving missing-row repair,
retry after ten attempts, stale-lease rejection, immutable estimates, completion
rechecks and explicit release comparison; deployed source readback; production
private worker reads with persisted canonical price/fee/estimate outcomes; public
unauthenticated requests rejected. Runtime module type checks use the unchanged
local sources with only the unavailable JSR type-marker import omitted.
