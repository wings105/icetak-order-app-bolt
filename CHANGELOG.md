- [VERIFIED] Products uses a compact Shopee-style ERP list with status-count tabs, separate Shopee/website prices, aggregate source stock, inline model rows and page selection for status checks. Live read-contract and rendered desktop/mobile search/filter/expand/Edit/pagination/error states pass; hosted list delivery pending. See docs/catalog/IMPLEMENTATION.md.

- [PRODUCTION] Shared Shopee/website catalogue: imported 2,004 MY listings and 6,488 models with complete cover/cache images; provider reads confirmed 1,967 active / 37 unlisted. Admin Products, exact Inbox model fallback and storefront variation/cart passed rendered desktop/mobile tests. Server-authoritative order/payment price, model ownership, import preservation and outbound queue recovery passed rollback assertions. PR #94 / `370c2d3` passed hosting builds and domain guard; hosted Products/configurator code and Inbox asset match the tested release. Changed-value Shopee writes and authenticated hosted owner session have not been exercised. See docs/catalog/IMPLEMENTATION.md.

## 2026-10-16 — Standalone acrylic office display

- [PRODUCTION] `/acrylic-production/` opens a dedicated read-only cutting display without login or Admin V2 navigation. Owner-authorized public GET gateway exposes only task/display fields; original admin access remains protected. PR #93 / Worker a3d8141c passed build/deploy and actual main-domain stage/Gold/search smoke with 14 tasks. Usual ClickUp ingestion and one-minute visible-page refresh remain. This public URL is not PC/IP restricted. See docs/ACRYLIC_PRODUCTION.md.

- [VERIFIED] Admin V2 Production Acrylic separates Acrylic/Artpaper work by CF Job, stage and material colour; live 13-task read, bundled desktop/mobile filters/search/zoom/retry and active-admin gateway checks passed. Backend deployed; authenticated hosted owner flow remains unexercised. See docs/ACRYLIC_PRODUCTION.md.

## 2026-10-16 — ClickUp job

- [PRODUCTION] Outbox v41 includes existing ClickUp job label option IDs in typed custom_fields by component type; unknown custom jobs stay unmatched. Eleven controlled tests and real authenticated preview/source/auth readback pass, preserving RM/set and processed queue state. Existing TM Code forwards job; downstream job task write awaits a fresh run.

## 2026-10-16

- [PRODUCTION] ClickUp production queue v40 projects per-task MYR prices and conditional set labels; exact deployed source/auth and real single/multi-order read-only previews verified with unchanged queue/linkage. Eight controlled payload/handler/adapter tests pass. TaskMagic canvas mapping and downstream RM/set task writes remain pending owner action; see docs/taskmagic-production-price-set.md.

## 2026-10-16 — Shopee read receipts hosted delivery

- [PRODUCTION backend and hosted delivery / VERIFIED controlled frontend] PR #91, production 038d219 passed Cloudflare Workers Builds and guard. Live Inbox JS exactly matches the desktop/mobile-tested read-warning build; login smoke has no runtime errors. Provider POST/GET and corrected audit schema were verified. Authenticated next reply remains unexercised. See docs/SHOPEE_CHAT_DIRECT_SETUP.md.

# 2026-10-15 — Chat reply state survives fulfillment

- [PRODUCTION backend] Shopee needs_reply/unread are independent of shipped, completed and cancelled order sessions. Sessions still close at fulfillment; successful-send proof, concurrent-inbound protection, manual reply and history guards remain. The latest matched order removes Urgent priority/tag on fulfillment/cancellation and blocks later AI/manual re-addition; a newer active order remains eligible. Service-role native rollback tests cover shipped/cancelled reply retention, closed sessions, urgent removal/re-addition, newer-order protection and successful/failed/concurrent sends; 40 sender and 59 operations checks pass. Provider GET evidence restored three still-unanswered chats without sending or marking provider chats read; newer provider replies/manual completion were preserved. Terminal urgent remaining: zero. Frontend source is unchanged; hosted staff rendering has not been exercised. See docs/SHOPEE_CHAT_DIRECT_SETUP.md.

# 2026-10-14 — Material stock management

## 2026-10-15

- [VERIFIED controlled sender/frontend; backend deployed] Shopee reply read sync now requires matching provider readback, records supported audit fields and surfaces read/audit warnings without resending successful messages. Inbox v14 and AI bridge v12 source/auth match; live provider GET and service-role rollback audit pass. Desktop/mobile composer and success/failure/concurrent-inbound checks pass. Hosted authenticated next reply remains unexercised. See docs/SHOPEE_CHAT_DIRECT_SETUP.md.

- [VERIFIED] Unified Inbox Shopee composer offers 30 official orangutan stickers with preview and explicit send, preserved text drafts and existing authenticated/idempotent sender audit/reply guards. Real ChatArea desktop/mobile and 40 sender checks pass; Inbox sender v13 source/auth and rollback persistence verified. Hosted signed-in use pending. See docs/SHOPEE_CHAT_DIRECT_SETUP.md.

- [PRODUCTION backend and hosted delivery / VERIFIED controlled frontend] PR #89 e72a1cb / Worker 122bdd22 passed builds/guard/deploy and hosted Stock URL/bundle smoke. Add Admin V2 Stok with balances, opening counts, purchases, physical count/waste/manual usage, size rates, reusable item mappings, review and movements. Canonical orders reserve at To Ship; Shipped or successfully notified ready pickups consume once. Equal glossy/double tape, separate Burn Away sizes, artpaper gold and acrylic colour quantities are preserved. Private service-only ledger/JWT gateway, bounded cron, request receipts, cutover, rate freeze and late linking pass native rollback/auth and desktop/mobile interaction checks. Actual reserves reconcile; all 71 opening balances remain unknown and no physical production deduction is invented. Owner must enter counts, choose wafer and confirm inch/1pc rates. Hosted signed-in owner flow remains unexercised. See docs/STOCK_MANAGEMENT.md.

# 2026-10-13 — SG token delivery and bounded release polling

- [PRODUCTION backend] Verify the owner's actual SG token push and provider read readiness with a dedicated shop key. Correct the SG one-time cursor delay and stop release catch-up chasing each cron's moving endpoint. Order finance v10 now finishes catch-up and schedules six-hour polling: actual MY/SG cron persisted 17:14 MYT next runs and completed without error. Fixed pagination, seven-day bounds, simulated 90-day/six-minute convergence and actual-handler auth/delay/backoff tests pass, with 31 direct and 59 operations checks. Retain separate currency wallets and the sole external refresh producer; its next scheduled token push is still unobserved. See docs/SHOPEE_SG_TOKEN_PUSH.md and docs/SHOPEE_WEBHOOK_OPERATIONS.md.

## 2026-10-13 — Shopee product cards and received stickers

- [VERIFIED] Controlled desktop/mobile rendering with actual webhook data shows nested variation name, selected-variation price and product thumbnail. Received sticker package/ID resolves to verified Shopee CDN imagery; missing images show a readable fallback. Chat message projection now includes existing provider type/metadata, without adding list payloads, polling, API calls or backfills. Inbox typecheck/build and RM6/RM12, sticker, missing-asset, text and overflow checks pass. Hosted signed-in staff rendering remains unexercised.

## 2026-10-13 — Shopee image composer

- [VERIFIED] Controlled desktop/mobile paste → preview → Enter sends exactly one image; multipart Shopee upload/send, persisted image state, duplicate guard and read synchronization pass mocked integration checks. Inbox typecheck/build pass. Real authenticated customer delivery remains unexercised. See docs/SHOPEE_IMAGE_SEND.md.

# 2026-10-13 — Shopee SG connection and historical release recovery

- [PRODUCTION backend] Owner-authorized SG import passes signed escrow/refund reads and chat readiness; MY credential version and token timestamp are unchanged. Fix shop-scoped conversation selection before the 200-row limit in all five deployed shared callers. Requeue blocked SG jobs and repair missing Shop ID for 250707GSUE6A2Y using the successful signed MY provider read. All 42 return refund details are now available. Bounded SG release catch-up received 95 rows, applied 22 and held 73 pending canonical order identity; 21 positive releases use only the SGD wallet. Preserve release history when placed_at is missing, with a first-recorded fallback and unchanged seven-day windows/90-day start bound. 31 sender checks, 59 operations checks, exact deployed source/auth readback and real cursor rollback cases pass. No customer send/refund approval. Future SG token push still needs the actual existing AP refresh flow URL; prepared request in docs/SHOPEE_SG_TOKEN_PUSH.md.

# 2026-10-12 — Shopee webhook recovery and operations

- [PRODUCTION backend and hosted delivery / VERIFIED controlled frontend] Recover 79 failed/chat events with zero raw failures; expose previously unused notification/listing/price/promotion/penalty as audited alerts; project provider-time ship-by changes and return solutions/refund detail. Close terminal sessions without historical replay reopening reply/order context or replacing current identity, and recover both video URLs. Direct finance reads keep missing values unknown, require release proof and separate MYR/SGD wallets; history continues under bounded job/cursor limits. Admin V2 Monitor, shop-isolated Settings and richer Inbox cards pass desktop/mobile interactions, 59 operations checks, 30 sender checks, real database rollback suites, builds and exact deployed bundle readback. PR #86 release 572b65f / Worker 67c9a35a-aad6-4543-8f4c-f81f80f2dc40 passed Workers Builds and domain guard; the exact hosted Monitor URL reaches secure Admin Login with no application errors. SG credential import remains blocked pending explicit destination approval; hosted signed-in owner interaction remains unexercised. See docs/SHOPEE_WEBHOOK_OPERATIONS.md.

# 2026-10-11 — Reply Knowledge and automatic style learning

- [PRODUCTION delivery / VERIFIED controlled staff UI] AI Dashboard Knowledge manages versioned FAQ articles and channel style settings. Nineteen useful owner-reference FAQs are published; 61 unresolved articles remain drafts. Shared suggestions use published facts plus canonical runtime order evidence. Forward-only confirmed human replies learn safe style and fact-equivalent wording; generated copies/automation are excluded. Bounded batching/retry/retention and existing Inbox budgets remain. Live SQL/endpoint/auth/readback and rendered desktop/mobile/tab-idle checks pass; release 1417850 / Worker f9b8b660 passed builds/deploy/domain guard. The exact Knowledge URL reaches the secure hosted login gate and Inbox serves the expected new entry; hosted signed-in staff interaction remains unexercised. See docs/REPLY_KNOWLEDGE.md.

# 2026-10-11 — Marketplace cancellation status

- [PRODUCTION backend / VERIFIED controlled UI] CANCELLED wins same-provider-time webhook ties in canonical reconciliation. Eight real service_role rollback cases and live source/grant checks pass. Exact reported order 2610109KDDK929 now syncs to Inbox as CANCELLED / inactive through the existing worker; original history/payment and READY_TO_SHIP control preserved. Actual linked-order component desktop/mobile light/dark tests confirm Aktif absent only on cancelled card. No broad backfill or provider send; signed-in hosted staff interaction remains unexercised. See docs/MARKETPLACE_STATUS_RECONCILIATION.md.

# 2026-10-10 — Inline suggestion cost control

- [PRODUCTION] Unified Inbox removes periodic/expiry/global-order suggestion refresh, reuses bounded account-scoped fresh cache, serializes requests and backs off failures/429. Gateway v2 enforces shared 120/hour, 1000/MYT day and 30s/chat claims before chat/canonical reads. Real SQL rollback limit/reset/retention/grant tests, exact gateway/auth readback, 10-minute zero-request idle test, scoped orders/cache/debounce/backoff/stale-chat tests, composer/theme/mobile QA and builds pass. Release b343a80 / Worker f33edf17 served the exact tested Inbox JS; Workers Builds and domain guard pass. No customer/order/provider writes; only bounded counters. Hosted authenticated staff interaction remains unexercised; see docs/INBOX_REPLY_SUGGESTIONS.md.

# 2026-10-10

- [PRODUCTION] Draft customer phone now links to the registered WhatsApp app; the second line shows its full wa.me URL in list/card/details. Controlled desktop/mobile click and keyboard destinations, fallbacks and builds pass; PR #84 e071d40 / Worker 59fd3959 hosted JS/CSS and deployment guard checks pass. Native Windows WhatsApp launch and signed-in hosted owner interaction remain unexercised.

# 2026-10-10 — Shopee reply state

- [PRODUCTION backend] Successful Shopee replies from Inbox and AI Dashboard now automatically resolve Perlu Balas, with an atomic guard retaining newer customer messages. Failed/unknown sends retain reply status; sent request replay repairs state without another send. Private migration, exact deployed source/auth readback, 30 sender checks and real SQL rollback coverage pass. Screenshot chat repaired without resending; existing frontend reload retained. Hosted staff rendering remains unexercised. See docs/SHOPEE_CHAT_DIRECT_SETUP.md.

# 2026-10-10 — WhatsApp API outbound Inbox logging

- [PRODUCTION backend] Successful Order WhatsApp API sends now mirror saved text/time/provider IDs to Unified Inbox independently of app echo. Audit registration fails closed; private log endpoint deduplicates identity and message IDs; dispatcher retries only logging. Source/auth readback, real SQL rollback and sender failure/idempotency/opt-out checks pass. Three user-reported notification records recovered once and synced through the live API/cron without resending customer messages or changing the later reply/unread state. External provider callers remain outside this sender scope; see docs/WHATSAPP_API_INBOX_SYNC.md.

# 2026-10-10 — Shopee token push simplification

- [PRODUCTION backend] Token rotation accepts three fields without dates, records receipt time and preserves retries; unknown expiry uses provider read before any send claim. Applied private RPC and four deployed functions verified by live rollback tests/source/auth readback and 28 integration checks; no real messages/token/ClickUp mutations. Settings sample updated; owner rendered automation retry remains pending.

# 2026-10-10 — Shopee direct configuration backend

- [PRODUCTION backend] Owner-only Shopee settings gateway, private versioned config RPC and dedicated hashed-key token rotation endpoint deployed and smoke-checked. Identical rotation retries are idempotent; stale/conflicting/wrong-shop/revoked-key input is rejected. Inbox/Dashboard sender retains the shared ledger and adds shop/expiry/read-check guards. Exact five-function source/auth readback, 20 integration checks, six provider-result tests, SQL rollback tests and live sanitized bridge/anonymous rejection checks pass; advisor counts unchanged. Configuration is empty, no customer sends or ClickUp writes. Settings frontend/provider outcome verification remains pending owner login and credential entry; see docs/SHOPEE_CHAT_DIRECT_SETUP.md.

# 2026-10-09

- [PRODUCTION] Draft list/card exposes cancellation/Reopen history, auto system/manual admin/unknown source filter and current actor/time. Existing audit survives Reopen; service-only sanitized read RPC and finance-admin v35 verified with real rollback cancellation/reopen/recancel, privacy/paging/filter tests and desktop/mobile rendered workflows. PR #82 release 9e55979 deployed; hosted asset history/filter/API/CSS checks and Workers Builds/guard pass. Authenticated hosted owner interaction remains unexercised.

## 2026-10-09

- [PRODUCTION delivery / VERIFIED controlled UI] Draft Orders adds default list and graph views with MYT Day/Week/Month, complete server-filtered sent/paid-closed/cancelled percentages, cancelled-reason drilldown, time trend and source conversion. Converted unpaid orders remain separate. Migration 20261009080630 and finance-admin v34 installed; 26 read-only production cohorts/pagination, Edge auth/filter replay and desktop/mobile App/component interactions pass. PR #81 release `861f222` passed Workers Builds/guard; hosted root/admin asset chain contains the new controls/CSS. Authenticated hosted owner interaction remains unexercised. See docs/DRAFT_LIST_ANALYTICS.md.

- [PRODUCTION] Paid Shopee exact-phone matches now cancel one recent unpaid customer-linked prepaid quotation with customer_order_shopee and its Shopee Order ID. Follow-ups/payment sessions stop; ambiguous matches require admin review; paid/receipt-linked drafts and stale checkout are protected. Sixteen real-trigger service_role production rollback tests and Edge source/auth readback pass. PR #80 release `a7fe77c` passed Workers Builds/guard; exact hosted cancellation HTML passes controlled desktop/mobile rendering without checkout or mutation POST. Admin V2 controlled interactions pass; authenticated hosted owner interaction remains unexercised. See docs/SHOPEE_DRAFT_AUTOCANCEL.md.

## 2026-10-07

- [PRODUCTION] Cash at Counter draft actions now persist matching draft/order WhatsApp choices: Send Link defaults ON, including payment/ready pickup notifications; Confirm Pickup Order and explicit opt-out are OFF even when an old draft flag is ON. Installed production RPC rollback, Edge handler retry/queue regressions, source readback, hosted HTML equality and desktop/mobile hosted review interaction pass. Existing send guards remain; no historical replay or customer messages from QA. See docs/CASH_DRAFT_WHATSAPP.md.

- [PRODUCTION] Direct customer checkout now saves WhatsApp consent before notification processing. Existing order-created/payment-received queues generate once for opted-in orders; OFF, retries and non-customer flows remain guarded. Actual live RPC/trigger rollback tests pass; no historical replay or provider messages were sent by tests. See docs/DIRECT_CHECKOUT_WHATSAPP.md.

- [VERIFIED] Sales SKU category buttons filter ranking, KPI totals, trends, SKU drilldown and CSV through the existing catalogue/title mapping; unclassified items use Lain-lain. Live category totals reconcile and full-order profit allocation is preserved. Desktop/mobile interaction, gateway permissions, admin and full production builds pass; hosted owner confirmation pending.

## 2026-10-05 — [VERIFIED] Shopee and WhatsApp order detail evidence

Explicit known Order IDs now create idempotent WhatsApp evidence links and feed the shared scoped detail evaluator/Focus model alongside Shopee sessions. Selected artwork captions fill single-image item requirements; order screenshots/receipts/history and conflicting/multi-item evidence remain guarded. Real 261004R0RYQ2R7 source reads and actual handler replay resolve Detail lengkap 1/1 / Ready design. Backend deployed with private grants/auth retained; 55 recent active-order reference links recovered. Regression, rollback boundary/retry/trigger tests, source readback, component server render, typecheck and full build pass. Hosted owner/browser interaction remains unverified due to failed Chromium download. No outgoing messages or canonical order/task/payment mutations. See docs/ORDER_DETAIL_COLLECTION.md.

## 2026-10-04 — [VERIFIED] Admin loading and Customer Focus timeout

Fixes the observed Inbox statement timeout with bounded indexed chat batches, exact-key order-detail snapshots and shared overlapping gateway reads. Preserves full coverage, ordering, revisions and private auth; incomplete batches fail explicitly. Marketplace reuses completed detail scans for detail-only filters and skips hidden-tab polling. Focus prevents overlapping refresh and shows backend reasons. Finance keeps same-scope values during refresh with stale-error labels; Dashboard avoids its duplicate initial margin read. Live equivalent-result/private-grant tests, deployed full-coverage smoke and real desktop/mobile Admin tests pass; one authenticated focus read took 4.649 seconds versus earlier 8–18 seconds. Hosted owner interaction remains pending. See docs/ADMIN_READ_PERFORMANCE.md.

## 2026-10-04 — [VERIFIED] Paid sales and cancelled follow-up view

Command Center GMV and Sales Channel sales exclude unpaid, partial and cancelled orders. Receipt evidence takes precedence over recorded Paid status; refund/void safeguards remain. Pending balances and original cancelled records are retained. Dashboard links to the date-scoped cancelled Finance view for manual follow-up; no messages or duplicate orders are created. Live rollback tests and actual App desktop/mobile with live read-only reports pass without runtime errors. Hosted owner interaction remains pending.

## 2026-10-04 — [VERIFIED] Finance card sales, fee and cost breakdowns

Target month/today/channel and Untung Order cards show server-aggregated sales, fees, courier, adjustments, nett and material/extra costs. Gross GMV and eligible contribution have explicit labels; remainder/daily goal show formulas. Same headline cohorts, missing-data handling and private grants checked live; real read-only reports rendered in desktop/mobile Admin App with no runtime errors. Hosted owner confirmation pending.

## 2026-10-04 — [VERIFIED] Real order contribution targets

- [VERIFIED] Marketplace Orders opens with To Ship by default; explicit valid status links and manual All selection remain available. Rendered initial RPC/tab, invalid-link fallback and All/To Ship interactions pass; Admin build passes.

Adds Target & Baki to Admin V2 Dashboard and Finance → Target & Margin. Shopee uses net release/escrow after fees; direct uses customer receipt less courier, material and extra costs. Actual AWB charges replace courier estimates; missing data, receipt evidence and actual/estimated costs remain explicit. Includes overhead/owner-income goals, Saturday–Thursday workdays/holidays, dynamic remaining daily target, per-order direct cost review, filters and existing Shopee detail. Live rollback financial/audit/access tests, gateway auth tests, rendered real App desktop/mobile and live-report checks pass; existing profit/channel regressions pass. Finance v32 keeps JWT and owner gates. Hosted authenticated-owner interaction remains pending. See docs/CONTRIBUTION_TARGETS.md.

## 2026-10-04 — [VERIFIED] Trusted webhook phone reconciles Shopee/WhatsApp CRM masters

Exact-order authenticated phone mappings now use both primary phone and verified inbound WhatsApp identifiers. Service-only atomic reconciliation prefers the WhatsApp owner, merges through the existing CRM contract and fixes ClickUp staging references; invalid/order-mismatch/different/competing verified phones stay review cases. CSV/reference-free mappings cannot auto-merge. Real ingest handler fixtures and live rolled-back exact-order/guard/retry tests pass; v5 source/token-auth readback matches. Owner-authorized 261004Q6YDX95C merge persists with identity matched; audited WhatsApp order interval and supplied wording are saved, final artwork remains unselected. See crm-identity-ingest/README.md.

## 2026-10-04 — [VERIFIED] Marketplace order detail filters

Adds a detail filter beside Marketplace search: complete, missing, review, follow-up due, waiting, detail deadline, ready design and production lock. Intersects existing search/platform/shipping filters, evaluates every matching source page before 50-row result pagination and shows scan progress/exact matched total. Uses existing authenticated reads, sequence guards and nonoverlapping refresh; failures have retry and are never classified as missing. Real rendered 123-order/three-source-batch checks prove late-page matches, pagination, search/status intersection, empty/retry and desktop/mobile without runtime errors. Admin typecheck and production build pass. Hosted owner interaction remains pending. See ORDER_DETAIL_COLLECTION.md.

## 2026-10-04 — [VERIFIED] Recognize complete ClickUp custom wording

Corrects false missing name/age for completed topper tasks with supplied Customize Name. Recognizes inline name/age and full birthday wording; exact assigned confirmed/production task text can satisfy inferred wording without overriding explicit staff requirements. Regression and rendered real gateway/list/panel checks pass for MOHAMMAD ARYAN (6 TAHUN), Olivia's 2nd Birthday and Captain TIYEN turns 9. Empty fields, quantities, conflicts and production locks retain their guards. admin-ai-dashboard v15 source readback matches and retains JWT; no task/provider writes. See docs/ORDER_DETAIL_COLLECTION.md.

## 2026-10-04 — [VERIFIED] Recognize checkout topper wording and ClickUp checkbox values

Fixes a user-reported false missing-detail case: explicit wording on topper notes now populate wording and supersede title-only name/age inference; matching ClickUp text is normalized without false conflict. String/boolean confirmed values render accurately as ClickUp facts. Exact live order data and real desktop/mobile panel confirm complete 1/1 without age, confirmed Ya and retained production lock; ambiguity/explicit-rule guards remain. admin-ai-dashboard v14 retains JWT; no task/provider writes. Hosted authenticated owner refresh pending. See docs/ORDER_DETAIL_COLLECTION.md.

## 2026-10-04 — [VERIFIED] Per-order detail and linked chat sessions

Marketplace and Customer Focus lists share per-item completeness and a Detail / session panel. Reads exact ClickUp custom fields, distinguishes internal/task/chat links, binds same-identity WA/Shopee scopes, records explicit deadline/manual follow-up and protects quantities, changed item facts, conflicts and production locks. Actual handler/rendered desktop/mobile and live rollback audit tests pass; service-only read RPCs, JWT dashboard and custom-token bridge preserve access. Marketplace refreshes scoped detail/task facts every 60 seconds; the rendered fresh-task polling check passes. Initial release 9ebd080 passed Workers Builds/source guard and served asset smoke. No automated Shopee sends/default or ClickUp writeback: adapters are not connected. Hosted authenticated owner saves remain pending. See docs/ORDER_DETAIL_COLLECTION.md.

## 2026-10-04 — [VERIFIED] Customer Focus manual and bulk actions

Adds Dah balas, ✓ Selesai, Design siap and checkbox bulk actions with optional remarks, completed review, Undo/reopen and explicit partial failure/retry. External-reply marks are conversation-scoped; they preserve unfinished design. New chat reopens reply work, while actual task changes invalidate design observations. Real gateway/model/component desktop/mobile checks, auth/stale/idempotency guards and live rolled-back save/audit tests pass; no retained QA state or business mutation. admin-ai-dashboard v11 keeps JWT/admin gates and the existing private save RPC. Hosted authenticated-owner save confirmation remains pending. See docs/CUSTOMER_FOCUS.md.

## 2026-10-04 — [VERIFIED] Customer Focus inline shortcuts

Adds WhatsApp app / wa.me buttons, source Shopee username and small copy controls for order IDs, phone, related references and tracking. Compact source and Pos/Pickup badges stay in the pinned customer column. Real desktop/mobile component, clipboard, link, search and navigation checks pass; Admin type/build checks pass. Hosted authenticated-owner interaction remains pending. No backend or priority changes. See docs/CUSTOMER_FOCUS.md.

## 2026-10-04 — [VERIFIED] Customer Focus daily scope

Corrects the owner's reported ranking failure: July COMPLETED orders and old chat/deadline combinations no longer dominate daily focus. Full actual-data comparison reduces 1,813 to 126 daily rows with zero July focus rows; current chat/paid, future work, pickup and historical filters remain accessible. Real desktop/mobile component tests, regressions, Admin type/build checks pass; admin-ai-dashboard v10 source/auth readback verified. Hosted authenticated owner confirmation remains pending. See docs/CUSTOMER_FOCUS.md.

## 2026-10-04 — [VERIFIED] Shopee / Deco Sales Channel comparison

Finance → Sales Channel compares known MYR goods sales, percentage, trend, average order, contribution completeness, receipt/pending evidence, fees/refunds/shipping losses, repeat customers, fulfillment timing and top products. Scoped order filters/CSV and existing detail routes retain owner Finance access. Live SQL and controlled desktop/mobile checks pass; hosting smoke pending. See docs/SALES_CHANNEL.md.

- [PRODUCTION] Admin prepaid/chat draft review notifications now use the idempotent WhatsApp notification queue instead of an unlogged direct WasapFlow call. Provider failures are persisted with bounded retries, a minute scheduler dispatches delayed retries, successful delivery updates `admin_link_sent_at`, and an audit event is recorded. Production smoke recovered all four missed evening drafts exactly once: four queue rows sent, four draft timestamps set and four audit events recorded.\n\n# Changelog

## 2026-10-03 — Sales SKU analytics

- [VERIFIED] Finance → Sales SKU adds rolling day/week/month/quarter/half-year/year/all/custom periods, top-SKU bars, net-unit/sales/order/allocated-profit ranking, search, CSV and SKU trend/order drilldown. Latest Excel rows take precedence over normalized webhook items without duplicate counting; returns, cancelled/unpaid exclusions, currency/shop scope and incomplete contribution are explicit. Live reports reconcile all seven periods and selected-SKU detail; actual Admin desktop/mobile tests and existing finance regressions pass. Read-only private RPC migration is applied and finance-admin v30 preserves JWT/owner access. Hosted authenticated owner smoke remains separate; see `docs/SALES_SKU.md`.

## 2026-10-03 — Shopee order contribution and material settings

- [VERIFIED] Finance → Untung Order separates released/escrow income and actual/estimated contribution, exposes per-item material and extra order costs, flags incomplete data, and shows owner-only Nett/Untung in Marketplace Orders. Separate Settings → Modal Bahan holds four initial percentages and optional SKU/unit costs with frozen historical versions. Live service-role rollback tests prove release/zero/fee/currency/cost/version/trigger/permission behavior; gateway auth tests and rendered desktop/mobile workflows pass, with no app runtime errors. finance-admin v28 is deployed with JWT verification preserved. Frontend release `534d2c9` passed Workers Builds/guard and the live JavaScript asset contains the new UI/actions. Authenticated hosted-owner smoke remains unverified; see `docs/ORDER_PROFIT.md`.

## 2026-10-02 — Unified Inbox on shop Cloudflare hosting

- [PRODUCTION] Unified Inbox is served at `shop.decocake.my/inbox/` with isolated assets, dependencies, PWA scope/cache and its existing Inbox Supabase backend. Release `9b35249` passed Workers Builds/guard; production browser verified the staff login page, `/inbox` redirect and storefront catalogue-to-product navigation. All 79 original storefront build files remained byte-identical except the intentional service-worker isolation change. Authenticated Inbox workflows remain untested; no messages, orders or backend data were changed. See `docs/UNIFIED_INBOX_HOSTING.md`.

## 2026-10-01 — SPX tracking suffix recovery

- [PRODUCTION] Tracking-link and courier recognition accept ParcelDaily SPX numbers ending in `A` as well as existing numeric `MY` numbers, preserving the complete provider number. Live migration `20261001095802_spx_tracking_suffix` applied; 11 valid/invalid/courier regression cases passed. Five first-scan notifications blocked today were recovered through the existing guarded queue: all five reached `sent` at 17:58 MYT with one attempt and a provider message ID each. A rollback retry test retained exactly five queue rows. No master/per-order controls, historical migration files, or sent/cancelled notification policies were changed.

## 2026-10-01 — Operational order work read model

- [VERIFIED] Private ClickUp projection links legacy Order SN / explicit Webapp IDs and preserves separate set progress. Global order work reads current order/payment/shipment/task state independently of chat review. Printing/completion retire earlier work; shipment movement retires postage work; new review corrections remain actionable. Live SQL grants/mapping, rollback lifecycle and actual gateway controlled-response tests passed; v7 sources read back after deploy. Rendered frontend and first scheduled provider backup remain pending; this entry does not claim UI verification.


## 2026-09-27 — AWB reference preview

- [PRODUCTION] AWB sheets now use a 4×4 grid (16 tasks per A4). Customize Name is projected from raw ClickUp custom fields and shown below each task title with wrapping; blank values are omitted. Existing rows were backfilled for this field. Production browser verified order 260924U9ED78FC with both customization texts and all 1 + 2 direct ClickUp images. Build and image-selection checks pass. Physical printer and multi-sheet output remain unverified.

- [PRODUCTION] Public `?awbpreview=<custom-field-order-id>` page groups ClickUp tasks into A4 sheets with one A6 quadrant per task, wrapped titles and all images from the latest image comment. Private indexed projection updates from raw task events; endpoint exposes print fields only. Browser-verified on shop.decocake.my: 260924U9ED78FC shows two tasks with 1 + 2 images; IC260922-7118 shows one missing preview and one round image; Refresh reloads and Print becomes enabled after images load. Physical printer output, mobile viewport and multi-sheet print output not verified. Build and image-selection regression checks pass.

- [PRODUCTION] WhatsApp 24-hour windows are monotonic when delayed WasapFlow events arrive: old customer messages can no longer overwrite newer session timestamps, existing stale conversations were backfilled, and `check-24h-window` independently selects the newest inbound/customer timestamp. Production verification reduced stale window rows from 48 to 0, false-closed active conversations from 2 to 0, and returned `can_send_freeform=true` for customer `60126253704` until 23 Sep 2026 10:51 MYT.

- [PRODUCTION] AI Dashboard now classifies the newest actionable customer request, shows a concise case brief (request, confirmed facts, missing checks and next action), and requires an explicit admin/session-bound order confirmation before order/payment/shipping facts are used. Added guarded shortcuts to the existing Draft Orders, Create Order and canonical order/marketplace views; no draft, payment, order status or customer message is created automatically. Production browser, gateway guards, build/type checks and rolled-back SQL idempotency/security tests passed.

- [PRODUCTION] Admin V2 AI Dashboard now defaults to an inline conversation workspace with expand, Card/List alternatives, per-customer order-stage filters and two WhatsApp links prefilled from the edited reply. Authenticated desktop smoke verified real To Ship/Completed filtering, AI panel, encoded multiline prefill and unsaved-switch warning. Added qualitative confidence evidence and a separate audited conversation-feedback/SOP approval dataset; SQL rollback tests and gateway guard tests passed. Model retraining/auto-send remain off; browser training submission and mobile QA remain unverified. See `docs/AI_ACTION_DASHBOARD.md`.

- [PRODUCTION] AI Dashboard conversation workspace now provides a customer rail, readable WhatsApp/Shopee timeline, date/session markers, chat search and sender/attachment filters, image preview, message copy and quoted notes, alongside Order & CRM and Semakan AI tabs. Verified in authenticated production Browser at 1363×936: real conversations, image load, search/filter results, order/payment context, exact order-ID clipboard copy, and unsaved customer-switch protection. No customer send or review mutation was submitted; mobile device validation remains pending.

- [PRODUCTION] Draft-to-order conversion now preserves a saved CRM `customer.address_id` when creating the canonical order, preventing duplicate-address unique-constraint failures caused by harmless spacing differences. Verified on production by recovering paid draft `5ef69019-b775-451b-8615-748f4c7b4a07` into order `IC260917-4487`, linking transaction `941473576Q` (RM19.50), reusing the single saved address, and queuing one idempotent ClickUp outbox event.
- [PRODUCTION] Compact punctuated Malaysian addresses (for example `No.85,Taman Irama`) are accepted across customer checkout and database guards while genuinely short addresses remain blocked; paid drafts now show a recoverable error instead of an endless spinner when order creation fails. Verified with live trigger tests, Edge Function v12, and the deployed payment page.
- [PRODUCTION] Customer checkout Confirm is atomic and retry-safe across courier/free-shipping flows; fixed PostgreSQL 42702 ambiguity, prevents duplicate payment sessions, recovers post-confirm network failures, and renders structured errors instead of `[object Object]`. Verified against the live RPC with rollback-isolated SPX/free-shipping and retry tests.
This file is reliable shared memory for meaningful production-facing or architecture-level changes. It is not intended to mirror every commit or every coding attempt.

## Status policy

Only record a change here when it has reached one of these evidence levels:

- `[VERIFIED]` — the requested outcome has been tested and observed, but final production confirmation is not yet established.
- `[PRODUCTION]` — the change is in the production source/runtime and the requested outcome has been smoke-checked successfully on production.

Do **not** record speculative fixes, code-only attempts, failed verification, or changes the user reports as still not working as completed items. Those belong in commits/PR handoff notes until they are proven.

If a previously recorded success is later disproved, correct its status/entry rather than preserving a false success record.

See `docs/VERIFICATION_PROTOCOL.md`.


## 2026-09-06 — [PRODUCTION] QRPay unmatched payments fail closed without AI drafts

- Disabled the `unmatched_payment_queue_qrpay_ai` trigger in Order System production.
- Preserved `zz_auto_reconcile_unmatched_payment`: a unique exact-amount eligible draft/order may still auto-link.
- Payments with no unique exact match now remain unmatched for manual review instead of creating a speculative AI draft from nearby WhatsApp messages.
- Production rollback smoke test confirmed an unmatched payment created no AI job and no draft, while the canonical auto-reconcile trigger remained active.

## 2026-08-30 — [PRODUCTION] Evidence-based completion and AI handoff policy

- Added the mandatory `ATTEMPTED -> VERIFIED -> PRODUCTION` work-status model for all coding agents.
- Agents may no longer claim `done`, `fixed`, `working` or `live` from a code edit/build/merge alone.
- Added outcome-specific verification rules for UI, backend, database, payments, WhatsApp, ClickUp and deployment work.
- Added explicit handling for cases where the user checks the real system and reports that a claimed change is absent or broken: the work returns to ATTEMPTED/FAILED until re-verified.
- Added a troubleshooting order for source/deploy/cache/route/runtime mismatches before repeating arbitrary patches.
- Changelog entries are now reserved for meaningful VERIFIED or PRODUCTION outcomes; failed attempts remain in Git/PR handoff history.
- Added a non-blocking PR documentation reminder so missing verification/changelog review is surfaced as a warning rather than preventing work.
- No application logic, database schema, Edge Function behavior or live business workflow is changed by this policy release.

## 2026-08-29 — [PRODUCTION] AI portability / project memory

- Added repository-level `AGENTS.md` as the mandatory entry point for coding agents.
- Added ecosystem architecture documentation covering customer app, Admin V2, Order System, Unified Inbox, ClickUp, WhatsApp, QRPay, payments and shipping.
- Recorded the two live Supabase project boundaries so agents do not modify the wrong backend.
- Recorded `production` as the live code reference and documented that `main` must not be assumed equivalent.
- Added architecture decisions for draft-first order creation, order-session boundaries, fail-closed payment matching, WhatsApp guardrails and integration ownership.
- Added a deployment/change runbook and cross-AI handoff procedure.
- No application logic, database schema or live function behavior changed in this documentation release.

## 2026-08-27 — Customer tracking display

- Production customer tracking UI improved courier label visibility.

## 2026-08-26 — QRPay and WhatsApp safety hardening

- QRPay unmatched payment reconciliation hardened to fail closed rather than force an uncertain match.
- Per-order WhatsApp opt-out behavior hardened for automatic sends.

## 2026-08-24 to 2026-08-26 — Pickup / tracking controls

- Pickup bundle receipt/review and QRPay linkage work added.
- Per-shipment/per-order automatic tracking notification controls hardened.
- SPX pickup-hold mapping preserved as in-transit behavior where intended.

## 2026-08-21 to 2026-08-22 — Session isolation, AI learning and pickup counter

- Order-session isolation and draft lifecycle boundaries introduced/hardened.
- Weekly AI learning control-center infrastructure added.
- Pickup counter bundle checkout, payment/notification and void-related backend flows added.

## 2026-08-19 to 2026-08-20 — Draft/admin and WhatsApp window operations

- Customer shop checkout/draft flows extended.
- Admin WhatsApp window monitoring added.
- Manual draft/payment flow and late QR/counter reconciliation improved.

## 2026-08-13 to 2026-08-16 — Unified draft engine and payment recovery

- Unified order sessions and draft-first lifecycle established for QRPay, chat/prepaid and pickup flows.
- Draft pricing, address validation, customer checkout and payment linking/recovery iteratively hardened.
- Shipping/payment attention paths added for operational recovery.

For exact implementation history, inspect Git commits and Supabase migration history on the relevant production system.


## 2026-09-30 — Business Command Center

- [VERIFIED backend; ATTEMPTED UI] Whole-system snapshots and audited sales tracking deployed to both Supabase projects. Live SQL, rolled-back sales lifecycle/idempotency tests, gateway role redaction and TypeScript/build checks passed. Five-view frontend implemented; visual interactions and hosting publication remain unverified. See docs/PRODUCTION_STATE.md for scope and limits.



## 2026-10-01 — SKU renderer v3

- [PRODUCTION public render/export; VERIFIED engine; ATTEMPTED authenticated editor] SKU renderer adds per-layer curve direction/strength, rotation, tracking, horizontal/vertical scale and multiple field bindings while reading legacy one-region templates. Public production smoke on YS0184 proves down-curve wording, input invalidation and a decoded 2480×3508 PNG preserving the full template. Initial setup reuses the owner's uploaded artwork and records one audited version-1 save. Controlled tests prove two inputs/three layers, both curve directions, transform bounds, auto-fit, stale-render rejection, legacy save compatibility and API guards. GitHub and Cloudflare builds pass; authenticated admin interactions and mobile QA remain unverified. See docs/RENDER_TEMPLATES_V2.md.

## 2026-10-01 — Cake Mockup sizing configurator

- [PRODUCTION public sizing preview; VERIFIED 3D and PNG downloads] `/mockup` provides scale-based round/rectangular cake preview, 1–4 independently sized tiers, edible on top/curved sides and flat acrylic on top/sides. Live public checks confirm the route, inch/cm conversion, 5-inch edible on a 6-inch cake (0.5-inch margin), side-height warnings/removal, 3-tier acrylic placement and PNG preparation with a download link. Cloudflare Workers Builds and GitHub guard pass for release `4e0c89d`. Software-rendered Chromium desktop 1536×1024/mobile 390×844 checks pass for both WebGL 3D and no-WebGL 2D, presets, upload/removal, actual decoded 1600px PNG downloads, stale download invalidation, square cakes, both route forms and mobile controls, with no runtime errors/overflow. Cloud browser has WebGL disabled; its download-event adapter times out, so hosted 3D and completed cloud-browser downloads are not independently claimed. Build, targeted TypeScript and geometry regressions pass. See `docs/CAKE_MOCKUP.md`.

## 2026-10-01 — Edible sizes, shapes and prices in Cake Mockup

- [PRODUCTION public catalogue; VERIFIED 3D and PNG downloads] `/mockup` adds 34 owner-supplied edible presets with shape-specific RM6/RM12/RM24 pricing and the round cupcake 1.8-inch RM1.20/pc, 24/A4 preset. Square and Rectangular are separate; Love renders a true clipped heart. Rectangular landscape/portrait swaps dimensions while preserving preset price. Uploads retain selected edible footprints; custom dimensions request a quote. Shape, orientation and price appear in PNG/WhatsApp summaries. Controlled WebGL/no-WebGL desktop/mobile tests pass for every preset, six rectangular orientations, alpha-mask silhouette, uploads, decoded 1600px PNG downloads, stale-export invalidation and acrylic regression; geometry/price regressions, TypeScript and build pass. Catalogue release `f2fda399` passed Cloudflare Workers Builds/GitHub guard; live public smoke verifies four shapes, shape-specific 4-inch prices, all six rectangular dimensions/orientations, cupcake price/capacity and the clipped heart preview. Cloud-browser proof uses the labelled 2D fallback; hosted 3D and completed cloud-browser downloads are not independently claimed. See `docs/CAKE_MOCKUP.md`.


## 2026-10-01 — [PRODUCTION] Native PNG renderer output for automation

- Same-project `/render-test/output.png` now returns native PNG via Bearer POST or a 30-minute signed GET; shared Canvas engine preserves configured curves/strokes/transforms and excludes guides. YS0184 accepts name/age with `{{name}} turns {{age}}`, preserving old full-phrase links.
- render-template v4 and service-only/RLS key RPCs support render-only key rotation/revocation/rate limits; admin editor includes pattern labels, output-link and key controls. Authenticated Admin interactions remain unverified.
- Release 3bb9fad passed current GitHub guard/Cloudflare build. Live signed GET decoded and visually checked at 2480×3508 (5,092,393 bytes); authenticated POST returned matching output and retry cache hit. Live missing-field/no-auth/tamper rejection and public age-edit/regenerate checks pass. Desktop public UI verified; mobile not verified.
- Activepieces Code adapter and setup guide added; controlled multipart upload/comment/retry tests pass. Not installed/tested in owner's AP and no real ClickUp post performed. Temporary QA key removed. See docs/RENDER_AUTOMATION_AP.md.


## 2026-10-03 — [PRODUCTION] Full Shopee order finance

Grouped raw finance fields/source/history, refund shipping-loss contribution retaining incurred costs, server filters/numeric sort, daily/courier charts and full CSV export. Owner-only Excel preview/import matches order/shop/currency, deduplicates and keeps webhook priority. Six real payloads reconcile; rollback accounting/import tests and desktop/mobile field/filter/export/XLSX flows pass. Backend finance-admin v29 retains JWT and permissions. Release 695285e passed Cloudflare Workers Builds and GitHub guard; published root/admin assets confirmed. Hosted owner flow unverified. See docs/ORDER_FINANCE_DETAIL.md.


## 2026-10-04 — Fokus Customer

- [FAILED LIVE LOAD; controlled checks only] Admin sidebar sortable list joins orders, active drafts, payment evidence, customer chat, per-set ClickUp progress/due/needed dates and shipment state. Prior filters/multi-sort/columns/CSV/Urus checks passed in controlled desktop/mobile, but the user's live screenshot overrides the release claim: full snapshot hit PostgREST's 8s timeout. Backend gateway v9 and private Inbox bridge v2 retain auth; hosted owner interaction/recovery remains unverified. See docs/CUSTOMER_FOCUS.md.
- [VERIFIED — backend repair] Full focus snapshot uses indexed latest-full ClickUp events/archive time and a once-built task date map. All 4,053 orders serialize in 1,120ms under the actual 8s service-role budget; normalized old/new order/task/date contents agree. Complete chats/drafts/identities and full-data focusRows succeed. No increased role/global timeout or business record/auth changes. Owner UI recovery still pending; see docs/CUSTOMER_FOCUS.md.
# 2026-10-05

- [PRODUCTION] AWB reference page adds Print AWB from the matched ClickUp tasks' latest AWB link fields, deduplicates shared PDFs and opens each document in a new tab for printing. Actual-order controlled desktop/mobile interaction and private indexed RPC checks pass; awb-preview v3 is active. PR #74 release d1b697d passed Workers Builds and source guard; production browser shows Print AWB and opens the existing PDF for task 14zbjdpktr8. See docs/AWB_PREVIEW.md.

- [PRODUCTION button/PDF flow; native popup ATTEMPTED] Print AWB now fetches the exact matched task PDF through awb-preview v4 and invokes the local PDF frame's print action without a new tab. PR #75 release 506dcf7 passed Workers Builds/guard; live hosted click verifies loading, frame/returned print call and no new tab. Original PDF bytes, task membership and bounded source retrieval checked; controlled desktop/mobile failure/retry/reference-print checks pass. The cloud browser does not expose native print dialogs, so popup contents and physical output remain unverified. See docs/AWB_PREVIEW.md.


## 2026-10-08 — [PRODUCTION] Copy AWB reference task names

Small title icons copy the original full task name and show Disalin ✓; retry/manual-copy feedback handles denied clipboard access. Copy controls and feedback are excluded from print/PDF. Exact native clipboard bytes, long/Unicode/newline titles, second-sheet task mapping, keyboard/Refresh/denial, desktop/mobile and A4 print/PDF exclusion pass in the actual controlled entry; full build and existing preview regression pass. PR #77 release a1cc728 passed Workers Builds and guard; hosted production shows the icon and success feedback on click. Cloud clipboard-read adapter does not expose native bytes; those were checked locally. See docs/AWB_PREVIEW.md.

## 2026-10-07 [PRODUCTION] — AWB preview task action buttons (unconfigured)

Added Address/Complete header actions for all preview tasks and one Finished action below each task's images, with task-scoped JSON, loading/results, retry-only-failed and private receipt deduplication. Added Admin V2 Settings AWB Preview Action Webhook URL using existing admin authorization. Controlled rendered AWB/Settings tests, backend handler and live rollback receipt tests pass; production URL intentionally unconfigured. Print/PDF excludes controls. PR #78 release `efa3db3` / Worker `7ace457e-084e-4f65-a160-adce5a14ff62` passes CI and hosted production preview smoke. AWB v5 and Settings v3 source/auth modes verified, unsigned action/auth rejection confirmed, receipts zero and original PDF proxy retained. Real owner webhook delivery and authenticated hosted Settings session remain unexercised; see AWB_PREVIEW.md.

## 2026-10-08 [PRODUCTION] — SKU copy beneath Finished in AWB preview

Added ClickUp SKU text and a copy icon beneath each task's Finished button. Exact SKU-only clipboard copying, empty omission, Refresh/keyboard/error retry, task 17, desktop/mobile and print/PDF exclusion pass in the actual rendered entry. Private read-only snapshot RPC preserves AWB lookup and existing RPC compatibility; live value, bounds and grants verified. No webhook POST on copy. PR #79 release 818130d passed Workers Builds/guard; production browser shows melody cupcake beneath Finished and confirms SKU disalin ✓. awb-preview v6 source readback and safe preview/PDF smoke pass; details in AWB_PREVIEW.md.
## 2026-10-10 — [VERIFIED] Inline Unified Inbox reply suggestions

Minimal SOP suggestion above the composer inserts editable text, preserves existing drafts and requires explicit Send. Six-second customer burst debounce, fresh canonical order/work context, 60-second expiry and stale chat/customer safeguards. Inbox staff/private cross-project endpoints deployed and smoke-tested without writes/sends; desktop/mobile light/dark actual-component interactions pass. WhatsApp expired-window Enter guard fixed. Authenticated hosted staff interaction remains unexercised. See docs/INBOX_REPLY_SUGGESTIONS.md.

## 2026-10-12

- [VERIFIED] Finance Sales SKU adds Acrylic colour filters, colour-separated rows/CSV and reconciled colour breakdown. Private owner-editable variation mappings include reset/idempotency/audit. Historical report totals, service-role rollback lifecycle/grants, gateway auth, desktop/mobile component interactions and root/admin builds verified. Backend migration and finance-admin v36 deployed. PR #85 production build/guard passed and hosted Admin V2 serves the new frontend bundle; authenticated hosted Finance interaction remains unexercised. See docs/SALES_SKU.md.
