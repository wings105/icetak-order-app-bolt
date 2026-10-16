# 2026-10-16 — Glossy product storefront

Follow-up PRODUCTION: PR #97 `cbed08b`, Worker `a7222f2e-a272-4e5e-bce2-1ed50926e8ed` clears required-wording feedback immediately on valid input. Actual public-domain mobile/desktop product, gallery, clipboard, options, cart and Edit repeated successfully at 13:50 UTC; served configurator matches tested build. No order/payment submitted.

PRODUCTION: PR #96 `e9a86de`, tested tree `e503ee1`, Worker `0a1a3918-8f00-488e-a764-1eae415bee09` passed hosting/guard. Printed catalogue product pages have compact upper-corner seller/Shopee/share controls and fixed bottom actions opening the existing selection sheet. Happy Birthday hides its field; Custom Words is required and starts blank; cart wording displays once. Pending product navigation is preserved. Actual public CN0790 product, real cover, clipboard, options, cart and Edit passed mobile/desktop without page errors; hosted configurator matches tested code. Basic services retained; no catalogue publication, price/provider changes or actual order/payment submission. See [catalogue evidence](catalog/IMPLEMENTATION.md).

# 2026-10-16 — Products ERP list

Hosted delivery PRODUCTION / controlled UI VERIFIED: PR #95 `b6478e4`, Worker `f3d1c904-0ffd-4561-9598-7dc17fac290e` passed hosting and guard. Products now has compact Shopee-style rows, source price range/stock, separate website price/status, count tabs, inline variations and selected status reads. Live list-contract checks plus rendered ERP desktop/mobile filter/search/expand/Edit/paging/error states pass. Hosted JS matches tested code after normalizing imported filenames; CSS is byte-identical. Exact route reaches Admin Login without app errors; signed-in hosted session is not exercised. No product/provider values were changed. See [catalogue verification](catalog/IMPLEMENTATION.md).

# 2026-10-16 — Shared product catalogue

Hosted delivery and backend/data PRODUCTION; controlled UI VERIFIED. PR #94 `370c2d3` / Worker `a69a5033-5389-46b2-9bb2-fd033f24dbbb` passed builds/guard; actual served Products/configurator code matched the tested build after normalizing imported hash filenames, and Inbox was byte-identical. Exact Products URL renders secure Admin Login without app errors. Authenticated hosted owner actions and changed-value provider writes remain unexercised. Order has 2,004 MY listings / 6,488 models; Inbox cache mirrors all with cover images. Live provider reads: 1,967 NORMAL, 37 UNLIST. Canonical products 2,011 because one legacy product linked; original eight published products preserved, new products start as website drafts. Product admin v3, provider bridge v3 and guarded ClickUp catalogue sync v10 deployed. Catalogue checkout validates price/model/stock before payment reservation. No changed-value provider write performed. See [implementation and verification](catalog/IMPLEMENTATION.md).

# 2026-10-16 — Standalone acrylic office display

PRODUCTION: owner-requested `https://shop.decocake.my/acrylic-production/` renders the shared cutting UI without login/admin shell. PR #93 `ee3dc16ea6363431c8123613d092e755e9f6836e` / Worker `a3d8141c-b35b-4baa-b27d-6499531284ab`; Workers Builds and backend deploy passed. Main-domain no-login stage/Gold/exact-order-search smoke read 14 design tasks with correct A6/2 pcs/set2 evidence. Public GET-only `acrylic-production-display` v1 has exact source/auth readback and a narrow field allowlist; original JWT admin gateway is unchanged and rejects anonymous access. Public possession of the URL permits read access; it is not restricted to office PC/IP. No source/task/stock/customer writes were introduced. See ACRYLIC_PRODUCTION.md.

# 2026-10-16 — Acrylic & Artpaper production queue

Hosted delivery PRODUCTION / controlled Admin V2 VERIFIED: PR #92 release `fea396a4f53e6cc1d53caf8db826965d817444e4` / Cloudflare Worker `80867d5e-1742-4945-bf0d-cd9a685158c6` passed Workers Builds, guard and deploy. Release tree exactly matches the tested source. The hosted root serves the new `main-CsEGlHPM.js` entry and the exact production URL reaches secure Admin Login. JWT acrylic-production v2 and a service-only invoker read expose CF Job Acrylic cake topper / Artpaper only, material/colour/stage filters, design zoom, size/quantity and separate Task IDs. Real 13-task read, model/auth checks and bundled desktop/mobile interactions passed. Live examples have no captured artwork URL; authenticated hosted owner interaction remains unexercised. Existing ClickUp ingestion, source records, stock and notification lifecycles remain. See docs/ACRYLIC_PRODUCTION.md.

# 2026-10-16 — ClickUp job CF in queue

Backend PRODUCTION: outbox v41 adds typed job labels/option IDs by explicit component identity and appends the real ClickUp job CF to component custom_fields. Existing TM adapter forwards it without new inputs; stale cached samples need refreshing. Eleven tests, exact source/auth readback and a real Edible Image production preview pass while price/set remain intact. Earlier owner test now has 3/3 tasks linked and queue processed. Downstream job write awaits a fresh TM run; no historical task update or customer send. See docs/taskmagic-production-price-set.md.

# 2026-10-16 — ClickUp task price and conditional set payload

Backend PRODUCTION / TaskMagic mapping pending owner: Order `clickup-production-outbox` v40 adds saved item unit price × quantity and typed RM/set custom fields, with no set for a single commercial item. Persisted component indices remain stable across one-per-claim retries and split-item amounts are recorded once. Existing shared-secret auth, cached identity, claim and webhook linking contracts remain. Exact two-file bundle/auth readback and eight controlled tests pass; authenticated read-only production previews prove single RM6/no-set and multi RM12/set1 with unchanged queue/task linkage; missing secret is 401. No ClickUp task or customer send was created for QA. Owner must install the prepared Map ClickUp Task V2 adapter and map the active Create Task custom_fields before new tasks receive these values. See docs/taskmagic-production-price-set.md.

# 2026-10-16 — Shopee read warning delivery confirmed

Production 038d219 passed Cloudflare build/guard. Actual hosted Inbox serves the exact tested read-warning asset; login browser smoke passes. The earlier frontend delivery block is resolved. Backend sender v14 / bridge v12 and controlled desktop/mobile verification remain as recorded; authenticated next-reply receipt is still unexercised. See docs/SHOPEE_CHAT_DIRECT_SETUP.md.

# 2026-10-15 — Shopee read receipt verification

Inbox sender v14 and AI bridge v12 deployed with exact source/auth readback; corrected audit fields, post-read provider verification and non-resend warnings. Controlled sender and actual desktop/mobile composer verified; live provider GET reports unread=0 for the latest replied chat and service-role rollback audit passes. Hosted authenticated next-send receipt remains unexercised. See docs/SHOPEE_CHAT_DIRECT_SETUP.md.

# 2026-10-15 — Chat reply state survives fulfillment

- [PRODUCTION backend] Shopee needs_reply/unread are independent of shipped, completed and cancelled order sessions. Sessions still close at fulfillment; successful-send proof, concurrent-inbound protection, manual reply and history guards remain. The latest matched order removes Urgent priority/tag on fulfillment/cancellation and blocks later AI/manual re-addition; a newer active order remains eligible. Service-role native rollback tests cover shipped/cancelled reply retention, closed sessions, urgent removal/re-addition, newer-order protection and successful/failed/concurrent sends; 40 sender and 59 operations checks pass. Provider GET evidence restored three still-unanswered chats without sending or marking provider chats read; newer provider replies/manual completion were preserved. Terminal urgent remaining: zero. Frontend source is unchanged; hosted staff rendering has not been exercised. See docs/SHOPEE_CHAT_DIRECT_SETUP.md.

# 2026-10-14 — Stock management

Backend and hosted delivery PRODUCTION / controlled Admin V2 VERIFIED: PR #89 e72a1cb / Worker 122bdd22 passed Workers Builds/guard/deploy. Exact stock URL renders the secure Admin Login gate; hosted Stock JS/component and CSS match the tested behavior/styles. Private Order stock ledger, 71 materials and owner/manual count/purchase workflow; canonical To Ship reserve, Shipped consumption, pickup consumption only after a current successful ready notification. Bounded every-minute worker is active; actual 45-order reserves match allocations, no failed work or physical deduction with all openings unknown. JWT stock-admin v2 exact source/auth and native rollback/service-role tests pass. Desktop/mobile real App forms and retry behavior, rates, ledger and builds pass. Opening counts, primary wafer and unconfirmed inch/1pc rates await owner input; hosted authenticated owner interaction remains unexercised. See STOCK_MANAGEMENT.md.

# 2026-10-13 — Verified SG token push and release polling

Backend PRODUCTION: the owner generated SG's dedicated rotation key and its actual HTTP push persisted credential version 2 at 10:59:25 MYT, followed by CHAT_READ_VERIFIED / READY. MY independently rotated to version 20 at 10:53 MYT; private boolean checks prove different tokens/key hashes. The external scenario's enabled schedule and next scheduled token refresh remain unobserved.

Order shopee-financial-enrich v10 fixes a moving release-history boundary: extend a short first-page tail before querying, keep subsequent-page ranges fixed and compare completion against that same request snapshot. Seven-day bounds, read-only provider paths, service/JWT auth, ingest/wallet idempotency and existing enrichment limits remain. A mistaken one-time SG next_at of June 2027 was corrected through the existing cursor RPC without changing the date range. The actual 11:14 MYT cron read both shops successfully, persisted six-hour next_at values for 17:14 MYT and finished without error. Exact deployed bundle/auth matches, time/pagination/handler regressions and 31 direct / 59 operations checks pass. At that snapshot: zero failed raw events/finance jobs, 167 completed recoveries, all 42 refunds detailed and 2,293 historical detail jobs still pending. See SHOPEE_SG_TOKEN_PUSH.md and SHOPEE_WEBHOOK_OPERATIONS.md.

# 2026-10-13 — SG connection and provider-proven recovery

Backend PRODUCTION: owner-authorized SG credential import is stored in its isolated Inbox slot; signed escrow/refund reads and CHAT_READ_VERIFIED / READY pass, with unchanged primary MY credential version and token timestamp. Shared provider read checks now scope the shop before limiting conversations, so older SG conversations are found. Five active Edge dependency bundles match source and retain their auth modes. All 42 returns have refund detail; SG release catch-up received 95 rows across 12 API windows, matched 22 canonical releases and retained 73 pending_order rows without creating orders/ledger entries; failed credential jobs were explicitly requeued with prior attempt/error metadata preserved. Order 250707GSUE6A2Y was verified through the signed MY escrow endpoint and its missing Shop ID repaired with evidence. Missing placed_at uses first-recorded created_at for a bounded 90-day release cursor; real rollback cases pass and SG history replay starts 18 July. 31 sender checks, 59 operations checks and session regressions pass. Automatic future SG token push remains pending the actual Activepieces refresh flow URL; no such flow is available in the connected v2taskmagic team. Prepared contract: SHOPEE_SG_TOKEN_PUSH.md. No customer send or refund approval.

# 2026-10-12 — Shopee webhook operations

Backend and hosted delivery PRODUCTION / controlled frontend VERIFIED: durable recovery completed 79 events with zero raw failures; auxiliary notifications/listing/price/promotion/penalty now become audited alerts. Provider-time ship-by updates, return solutions/detail, video URLs and historical/terminal reply/session guards are applied. Direct read-only Shopee finance replaces the old AP dispatch, preserves unknowns, separates MYR/SGD and processes history with bounded cursors/retries. Real rollback tests, 59 operations checks, 30 sender checks, exact 11-function bundle readback and desktop/mobile interactions pass. Admin V2 adds Shopee Monitor and per-shop Settings; hosted signed-in owner interaction remains unexercised. PR #86 release 572b65f / Worker 67c9a35a-aad6-4543-8f4c-f81f80f2dc40 passed Workers Builds and domain guard; the exact hosted Monitor URL reaches secure Admin Login with no application errors. SG import was blocked on 12 October and authorized/verified on 13 October; see the newer entry. See [SHOPEE_WEBHOOK_OPERATIONS.md](SHOPEE_WEBHOOK_OPERATIONS.md).

# 2026-10-11 — Marketplace cancelled status in Unified Inbox

Backend PRODUCTION / controlled card rendering VERIFIED: Order migration 20261010155245 makes CANCELLED win same-provider-time ties and serializes canonical reconciliation. Eight service_role rollback cases and live source/grant checks pass. Only 2610109KDDK929 reconciled; existing worker syncs Inbox CANCELLED / active_order=false, preserving history/payment and the active READY_TO_SHIP control. Actual OrderWorkspaceTab desktop/mobile light/dark rendering removes Aktif for the cancelled card. Hosted signed-in staff interaction remains unexercised. See MARKETPLACE_STATUS_RECONCILIATION.md.

# 2026-10-10 — Draft WhatsApp phone shortcuts

Hosted delivery PRODUCTION / controlled rendered behavior VERIFIED: Draft list/card/details numbers use whatsapp://send?phone=<digits>, with a separate full wa.me URL. PR #84 e071d40 / Worker 59fd3959-1b28-4d16-833a-2504a328e84d passed Workers Builds/guard; hosted App-XRuSgwkf.js and App-CHUY3otE.css contain the shared links/styles. Desktop/mobile click/keyboard, fallback, overflow and builds pass. Native Windows app launch and authenticated hosted owner interaction remain unexercised; no message/data mutation. See DRAFT_LIST_ANALYTICS.md.

# 2026-10-10 — Shopee replies resolve Perlu Balas

Backend PRODUCTION: Inbox complete_shopee_reply validates sent message/audit proof, atomically clears needs_reply/unread for pre-send inbound and preserves customer messages arriving during the provider wait. Shared sender covers Inbox v8 and AI Dashboard bridge v9; auth unchanged and exact bundle readback verified. Thirty sender integration checks and actual SQL rollback cases pass. Screenshot conversation reconciled to false/0 without new messages or provider sends. Inbox existing post-send reload consumes the persisted state; authenticated hosted rendering not exercised because staff session is absent. See SHOPEE_CHAT_DIRECT_SETUP.md.

# 2026-10-10 — WhatsApp API sends in Unified Inbox

Backend PRODUCTION: Order whatsapp-send v29 durably audits successful API sends and mirrors them through the private Inbox order-whatsapp-outbound v1. Dispatch v18 retries logs only, never delivery. Full idempotency conflict index and service-only Inbox RPC applied; exact bundled source/auth readback, real rollback tests, sender retry/audit-failure fixtures and opt-out checks pass. Three proven sent notifications for IC261010-1391 recovered with original text/time/provider IDs, each once; live log API and existing cron mark all synced while preserving the later customer reply/unread state. No recovery provider sends or broad historical backfill. External AP/Make direct sends need their own callback/routing. See WHATSAPP_API_INBOX_SYNC.md.

# 2026-10-10 — Shopee token push without dates

Backend PRODUCTION: minimal App ID / Shop ID / Access Token and blank dates accepted, server receipt time recorded and expiry stays unknown. Same-token retries preserve state; unknown-expiry sends require provider read before claim. Inbox optional-times migration, rotation/config v2, sender v7 and AI bridge v8 have exact source/auth readback. Twenty-eight integration checks, six provider checks and both service-role live rollback suites pass; configured shop/key remain unchanged. Root build passes. Settings sample updated; rendered owner and real automation retry pending. See SHOPEE_CHAT_DIRECT_SETUP.md.

# 2026-10-10 — Shopee direct settings and token rotation

Backend PRODUCTION: Inbox private icetak_shopee_chat_config invoker RPC, shopee-chat-config v1, shopee-token-rotate v1, shopee-chat-send v6 and ai-dashboard-bridge v7; Order shopee-chat-settings v1 validates active owner. Existing ClickUp/AP flow remains the only refresh producer, pushing timestamped scoped updates. SQL rollback/idempotency/privacy tests, 20 integration and six provider checks, exact source/auth readback and real sanitized Order→Inbox config read pass. Empty configuration and anonymous rejections verified; no customer send or ClickUp write. Admin V2 Settings frontend is implemented; owner rendered/provider validation pending login and credential entry. See SHOPEE_CHAT_DIRECT_SETUP.md.

# 2026-10-09 — Draft cancellation audit review

Backend and hosted frontend delivery PRODUCTION / controlled UI VERIFIED: migration 20261009100538 and finance-admin v35 (JWT retained, exact source readback) expose sanitized source/actor/reason/time cancellation/Reopen history without changing mutation contracts. Admin V2 adds source filtering, current cancellation attribution and history on all drafts including reopened ones. Production rollback lifecycle/privacy/pagination/filter tests, 26 report regressions and controlled desktop/mobile UI/Edge authorization checks pass. PR #82 release 9e55979 / Worker 0565d39f-e6b7-46e6-bf23-94543fa4ff5d passed Workers Builds/guard; hosted App-CIyhdYdS.js and App-Bd1cH7jW.css serve the new history/source controls. No historical writes or sends; authenticated hosted owner interaction remains unexercised. See docs/DRAFT_LIST_ANALYTICS.md.

# 2026-10-09 — Draft list and conversion graphs

Backend and frontend delivery PRODUCTION / rendered workflows controlled VERIFIED: migration 20261009080630, service-only invoker finance_admin_draft_report and finance-admin v34 (JWT retained) provide complete filtered cohort totals before pagination. Admin V2 adds default list, cards and graphs, MYT Day/Week/Month, created/sent date basis, source/status/flow/delivery/reason filters and paid canonical conversion. 26 read-only production cohort/pagination tests, Edge auth/filter replay, desktop/mobile App/component interactions and full builds pass. PR #81 release `861f222` / Worker `4a1c2589-41b6-40f7-a9e5-2d55e899592d` passed Workers Builds/guard; hosted admin chain serves `App-CO3ojcGF.js` and new controls/CSS. Authenticated hosted owner interaction remains unexercised. No reporting writes/backfill or customer sends. See docs/DRAFT_LIST_ANALYTICS.md.

# 2026-10-09 — Shopee quotation auto-cancellation

Backend PRODUCTION: migration 20261009051918 and order-draft-customer v13 cancel one recent customer-linked unpaid prepaid quotation on a paid Shopee exact-phone match; delayed CRM mapping is supported. Multi-draft/identity conflicts pause follow-up for admin review, payment/receipt-linked drafts remain protected and stale checkout is blocked. Sixteen real-trigger service_role production rollback cases pass, no QA records remain, Edge source/auth readback matches and security advisor counts are unchanged. PR #80 release `a7fe77c` / Worker `4e47ed25-f864-46fc-b71e-f8e37e9772bd` passed Workers Builds/guard. Exact hosted review/payment HTML renders the cancelled notice without checkout/QR or mutation POST in controlled desktop/mobile Chromium tests. Admin V2 controlled interactions pass; authenticated hosted owner interaction remains unexercised. See docs/SHOPEE_DRAFT_AUTOCANCEL.md.

# iCetak Production State

## 2026-10-08 — AWB preview SKU copy

PRODUCTION: PR #79 release `818130dfbef0074d6db76a5b23505e8f5546abf7` / Worker `642b7957-460b-4b0e-806a-d6c8d1bf6d6f` passed Workers Builds/guard. Each task's ClickUp SKU appears below Finished with a copy icon; empty SKU is omitted and controls stay out of print/PDF. `awb-preview` v6 has exact five-file source readback, unchanged public JWT mode/signed POST boundary and safe live preview/PDF smoke. New service-role-only bounded print-fields RPC reads the latest stored snapshot and preserves the old AWB RPC. Local exact clipboard/Refresh/keyboard/error/mobile/print checks pass; hosted production displays melody cupcake and reports SKU disalin ✓. Copy sends no action POST. The owner-configured webhook is now enabled; no real task action was sent during this SKU QA. See `AWB_PREVIEW.md` for evidence and ingestion timing.

## 2026-10-07 — AWB preview task actions (unconfigured)

PRODUCTION: PR #78 release `efa3db327f32ac08ef87cb3fbf880c31e5c15d5d` / Worker `7ace457e-084e-4f65-a160-adce5a14ff62`. Header Address/Complete actions cover all current preview tasks; Finished below each task covers only that task. Admin V2 Settings owns the private AWB Preview Action Webhook URL through `webhook-forward-settings` v3 (JWT true). `awb-preview` v5 retains public exact-order reads and implements signed, task-scoped POST dispatch with private receipt RPCs. URL remains blank, visible action buttons inactive, no live destination POST sent. Hosted public preview, deployed source readback, unsigned/auth rejection and private DB state smoke checks pass; configured action/Settings behavior verified in controlled tests. See `AWB_PREVIEW.md` for payload, retry limits and unexercised real destination/authenticated hosted Settings flow.

## 2026-10-07 — Direct checkout WhatsApp consent

Backend queue generation PRODUCTION: migration `20261007052454_direct_checkout_whatsapp_consent` persists checkout consent during the initial order INSERT for customer/customer_portal sources. Live RPC/trigger rollback tests confirm one order-created and one payment-received queue entry, opt-out and retry behavior, correct recipient and unchanged non-customer flow. No historical replay or provider send; authenticated browser checkout/provider delivery remain unexercised. See [DIRECT_CHECKOUT_WHATSAPP.md](DIRECT_CHECKOUT_WHATSAPP.md).

Snapshot date: 2026-08-29 MYT.

This is a living production snapshot, not a substitute for checking live services before risky changes.

## GitHub

- Repository: `wings105/icetak-order-app-bolt`
- Production branch: `production`
- Production head observed during this review: `8b38b5a94d892096f3ecd10910bad4a6e1fdfae7`
- `main` and `production` are diverged. Agents must not assume `main` is equivalent to production.

Recent production work includes courier display improvements, QRPay fail-closed reconciliation and per-order WhatsApp auto-send opt-out hardening.

## Supabase: Order System

- Name: `icetak-order-system`
- Project ref: `buivecgahhmrhlmfujgt`
- Status observed: active/healthy

Major live domains observed:

- canonical customers/orders/order_items
- payment sessions/transactions/unmatched transactions/voids
- production components and ClickUp sync/log/outbox data
- shipments/tracking/events/POD and attention alerts
- WhatsApp settings/templates/rules/outbox/notification queues
- marketplace webhook ledger and normalized Shopee/marketplace entities
- customer master/identifiers/source records
- product catalog foundation
- QRPay AI jobs, drafts, corrections and learning rules
- order sessions and fulfillment groups
- CRM profile/notes/tasks/tags
- pickup checkouts, bundle orders, access tokens, handovers and voids
- admin users/permissions/audit and operational runtime settings

Notable active Edge Function families observed:

- core/customer/admin API helpers
- payment sessions and payment matching
- WhatsApp send/dispatch/webhook/proxy/admin/login
- shipping-agent/shipping-api/AWB/POD/tracking
- ClickUp ingest/outbox/callback
- product catalog sync/pull
- QRPay AI worker/bridge/draft review/data/publisher
- order draft customer/trigger/manual paid
- admin order control/review/draft control
- finance webhook/admin/daily QRPay summary
- address import/fetch
- admin WhatsApp window monitor/bridge
- AI learning admin endpoint
- GPT order actions
- pickup receipt

## Supabase: Unified Inbox

- Name: `icetak-unified-inbox`
- Project ref: `uujcqcsfghqkukaydruc`
- Status observed: active/healthy

Major live domains observed:

- customers and channel identities
- conversations and messages
- WasapFlow webhook event ledger
- message media/cache jobs/references
- tags and quick snippets
- Google contacts cache
- external order summaries from Order System
- conversation AI jobs/analyses/semantic prototypes
- conversation activity and order links
- Shopee chat ingest receipts/events/send attempts
- external WhatsApp request audit

Notable active Edge Function families observed:

- WasapFlow webhook/send/template/media/raw/interactive helpers
- 24h window checks
- external WhatsApp send/outbound logging
- Google Contacts bridge
- active order summary sync/health
- conversation AI/semantic triage workers
- Shopee chat ingest/send
- QRPay AI order worker
- pickup AI order trigger
- order draft trigger/from-chat
- draft payment QR endpoints
- admin window bridge
- order session status

## Core production behavior

### Admin
Admin V2 is the supported admin implementation. See `docs/ADMIN_V2_SOURCE_OF_TRUTH.md`.

### Draft engine
Unified draft/order-session behavior is live and is the intended path for QRPay/chat/pickup-assisted order creation. See `docs/UNIFIED_ORDER_DRAFT_ENGINE_V1.md`.

### Payment matching
Production has explicit hardening for unmatched/ambiguous QRPay reconciliation. New matching logic should preserve fail-closed behavior.

### WhatsApp
Production has global safety controls plus per-order opt-out behavior for automatic sends. Any new automatic send path must integrate with these guards.

### Pickup counter
Pickup bundle checkout, notifications, void/review state and QRPay linkage exist in the backend and Admin V2 surfaces.

### AI learning
Draft correction/learning infrastructure and weekly control settings exist. Do not create a second independent learning store without architectural review.

## Known documentation caveats

Some subsystem docs contain point-in-time verification dates or old deployment URLs. Treat them as detailed historical contracts, then verify current production before acting.

`icetak-admin/README.md` is still the generic React/Vite template README and should not be treated as iCetak architecture documentation.

## How to refresh this document

When a meaningful production architecture change ships:

1. Verify the current `production` head.
2. Check affected live Supabase tables/migrations/functions.
3. Update only the sections impacted by the change.
4. Add the production-facing change to `CHANGELOG.md`.
5. If the system boundary/decision changed, update `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` too.

## 2026-10-02 — Unified Inbox hosting

- [PRODUCTION] `https://shop.decocake.my/inbox/` serves the staff Inbox login; `/inbox` redirects to the trailing-slash entry. Frontend source: `apps/inbox/` on `production`, imported from Inbox repository main `fdbcaa291e51fc69634287b9acd4a0a2d95b7f7f`.
- Release `9b35249efe2c03a01994a2a9c8b2b5939b56cd82`; Cloudflare version `69ce3c0d-3f25-4fad-98b5-e7af354fface`. Workers Builds and GitHub guard passed. Production browser verified Inbox page identity/login gate, root catalogue and Edible Image product navigation.
- Local build/typecheck passed. All 79 pre-existing storefront build files were byte-identical except the deliberate shop service-worker cache isolation change. Existing renderer Worker/bindings and mockup build input remain present.
- Backend remains Inbox Supabase `uujcqcsfghqkukaydruc`; both projects were healthy and Inbox conversations/messages/customers RLS was active. No backend migration, credential, webhook or message/order mutation was performed. Authenticated staff Inbox workflows were not exercised.
- See `UNIFIED_INBOX_HOSTING.md` for build and ownership details.


## 2026-09-30 — Business Command Center

- Backend VERIFIED; frontend implementation ATTEMPTED. Five views: Overview, Sales & Chat, Orders & Production, Shipping, Finance & Health; date/source filters and optional 60-second refresh.
- Order System owns operational and audited sales data. Unified Inbox owns chat aggregates. Service-only snapshot RPCs are joined by authenticated admin-command-center (v3) and private token-authenticated command-center-bridge (v1). No browser service/bridge credentials.
- Sales events are idempotent, version checked and audited. Won requires a real noncancelled order plus admin confirmation; quotation requires confirmed dispatch. No messages or order/payment mutations are added.
- Ledger uses existing finance_admin_report posted entries across all finance sources. GMV, cash receipts and Shopee settlement remain separate. Missing settlement is not zero; Shopee COMPLETED is not delivery proof; 1970 ship-by dates are flagged.
- Verified live SQL snapshots, service-only grants, sales lifecycle/retry/version checks in a rolled-back transaction, gateway owner/staff redaction and no-auth rejection, TypeScript and production build/source ownership guard.
- Not verified: desktop/mobile rendered interactions and authenticated hosted frontend. Browser download failed; public site reaches Admin Login. A GitHub commit does not prove frontend hosting publication.
- Existing production webhooks, automations, messaging and customer app preserved; no historical backfill.


## 2026-10-01 — Cake Mockup public sizing tool

- Public route `https://shop.decocake.my/mockup/` is deployed through the existing Cloudflare Workers Builds production pipeline. Release `4e0c89d` and GitHub guard both passed; live public sizing preview is PRODUCTION.
- Browser-only Three.js tool with inch-based geometry: round/rectangular cakes, 1–4 independently sized tiers, edible top/curved-side placement, flat acrylic top/side placement and fit warnings. A labelled Canvas 2D top/front fallback supports browsers without WebGL 2. No backend, order, payment or message writes.
- Public browser checks verify inch/cm conversion, 0.5-inch clearance for 5-inch edible on 6-inch cake, side-height warnings, three-tier acrylic placement, example artwork and PNG preparation/native download link.
- Controlled software-rendered Chromium verifies WebGL 3D and no-WebGL fallback, desktop/mobile interactions, image upload/removal, decoded 1600px PNG downloads, stale-download invalidation and both routes. Production cloud browser disables WebGL and its download-event adapter timed out; hosted 3D and completed downloads in that browser remain unverified. The standalone Chromium public request was blocked by its environment proxy certificate trust, not by an observed site error.
- Owner-supplied edible catalogue update `f2fda399` is PRODUCTION after Cloudflare Workers Builds/guard and public browser smoke. 34 presets cover Round/Square/Rectangular/Love, RM6/RM12/RM24 shape-specific prices, cupcake 1.8-inch RM1.20/pc (24/A4), landscape/portrait and custom quote handling. Live smoke verifies round/love 4-inch RM6 versus square 4-inch RM12, six rectangular dimensions/orientations with retained prices, cupcake capacity/prefill and clipped heart preview. Controlled desktop/mobile WebGL/no-WebGL tests cover every preset, upload footprints and actual decoded PNG downloads. Catalogue/prices are browser-only and do not modify store/backend records.
- See `docs/CAKE_MOCKUP.md` for dimensions, privacy and validation contracts.


## 2026-10-01 — AI order work lifecycle

Order System migrations ai_order_work_lifecycle and ai_order_work_safety applied; private task/set mapping and global order-work RPC verified live and with rollback tests. admin-ai-dashboard v7 ACTIVE, JWT enabled, six sources read back equal. Hourly stored replay enabled; separate hourly ChatGPT provider reconciliation scheduled. Initial pull/project of 49 task snapshots succeeded; scheduled execution not yet verified. Admin UI implementation/build passed, but authenticated rendered check is pending (cloud browser shows Admin Login). See AI_ACTION_DASHBOARD.md; full frontend flow is not yet PRODUCTION.


AI order work release evidence: f0214c0 and 71e35c0 both passed Cloudflare Workers Builds and guard. Four operational migrations applied; exact-status/conflict rollback tests passed, QA cache rows zero. Secure cloud-browser login returned Failed to fetch; authenticated visual verification remains blocked. This is a concrete login/network failure, not a customer-message/order mutation or proof of a broken dashboard. See AI_ACTION_DASHBOARD.md for continuation.


## 2026-10-03 — Shopee order contribution

Backend and controlled frontend VERIFIED. Private material-cost history and per-order snapshots in Order System; finance-admin v28 retains JWT and existing owner permissions. Finance → Untung Order, Marketplace Nett/Untung and separate Settings → Modal Bahan are added to Admin V2. Service-role rollback/trigger tests, Edge auth tests, desktop/mobile rendered workflows, TypeScript and full storefront+Inbox build pass. Release `534d2c9` passed Workers Builds/guard; the live root/admin route serves `App-BhGe7vwM.js` with the new UI and finance actions. Gateway source readback matches and live no-auth requests return 401. No retained QA orders, changed production cost rates, journal entries or historical order backfill. Hosted authenticated owner UI remains unverified. See ORDER_PROFIT.md.


## 2026-10-03 — Full Shopee finance details

Release 695285e passed Workers Builds and GitHub guard. Private immutable finance snapshots, full received-field/source/history display, refund/return loss contribution, server-backed filters/sort/daily/courier charts/full CSV and owner-only Excel preview/import are added. finance-admin v29 is ACTIVE with JWT, source readback equal and no-auth 401. Six original payloads reconcile; live webhook arrivals grew coverage to 28 orders / 29 snapshots at 11:23 MYT. No retained QA orders, changed modal percentages, or finance journal writes. Controlled desktop/mobile and live rollback accounting/import tests pass. Hosted owner login flow remains unverified. See ORDER_FINANCE_DETAIL.md.


## 2026-10-04 — Sales Channel comparison

- Backend and controlled Admin desktop/mobile VERIFIED. Finance → Sales Channel compares Shopee / Deco sales, known shares, trends, receipts/pending evidence, contribution completeness and customer/operational metrics. Hosted frontend smoke pending.
- Order System migration 20261003172037_sales_channel_analytics, service-only invoker reports, finance-admin v31 ACTIVE with JWT/owner checks retained. No business record/journal/notification mutation. See SALES_CHANNEL.md.


## 2026-10-04 — Fokus Customer

User screenshot confirms load recovery after the 8s query repair, but revealed FAILED daily ranking: 1,813 focus rows including completed July orders. Daily-scope correction VERIFIED on the complete 4,056-order/3,436-chat/12-draft snapshot and real desktop/mobile component: 126 daily rows, zero July focus rows, zero fulfilled-order deadline urgency. Current paid work, chat review, future work and history remain separately accessible; routine pickup and unpaid waiting drafts do not clutter daily focus. Counts change with new source data. admin-ai-dashboard v10 ACTIVE, JWT=true and all seven files match readback. No new migration or business mutation; four Order/one Inbox migrations remain. Hosted authenticated owner confirmation of the corrected daily list is pending. See CUSTOMER_FOCUS.md.

Manual/bulk actions VERIFIED on the real component and gateway/model using full actual data + controlled cases. Dah balas records exact chat revision; whole-action completion, design/production, waiting, Undo/reopen and up-to-50 selection reuse private audited state. Partial failure keeps failed targets; lost-response retries do not duplicate events. Live save/audit tests rollback cleanly; service-only grants unchanged. admin-ai-dashboard v11 retains JWT/admin gates, no new migration or canonical/provider mutation. Authenticated hosted-owner saves remain pending. See CUSTOMER_FOCUS.md.

## 2026-10-04 — Order detail collection and scoped sessions

[VERIFIED] Shared per-item detail checks and scoped chat panel in Marketplace Orders / Customer Focus. Separate internal iCetak, ClickUp and chat links; exact task custom-field read model, explicit same-identity WA/Shopee bindings, history/cutoff guards, quantities, conflicts, production locks, deadline and observed manual follow-up. Actual handler/list/panel desktop/mobile checks, source/version/idempotency/reader guards and live rolled-back persistence/audit checks pass. Order System admin-ai-dashboard v13 retains JWT; Inbox ai-dashboard-bridge v3 retains custom token auth; new read RPCs service-only. No retained QA state, historical backfill or provider/order/payment mutation. Shopee automatic sends/default and ClickUp field writeback are blocked by absent adapters; not enabled. Hosted authenticated owner saves remain unverified. See ORDER_DETAIL_COLLECTION.md.

Frontend release `9ebd080` passed Workers Builds/source guard and its public root/admin asset chain contains the detail/session and Marketplace column markers. Marketplace detail/task reads refresh every 60 seconds (controlled fresh-task polling check passes), alongside existing Focus refresh. Hosted authenticated owner saves and absent external-send/writeback adapters remain the limitations above.

2026-10-04 checkout wording correction VERIFIED: the user's 261004PU9CC6BW screenshot revealed unparsed wording and string-checkbox false negatives. Exact live-data and rendered panel now show Detail lengkap 1/1, Note to seller wording, Confirmed (ClickUp): Ya and preserved printing lock. admin-ai-dashboard v14 retains JWT; regression/type/full-build checks pass. No canonical/task/provider mutation. See ORDER_DETAIL_COLLECTION.md.

2026-10-04 complete-task wording correction VERIFIED: three exact source orders (261004PU64CYAS, 261004PQXWU76N, 261004PPSG0SKY) now show complete details in real rendered Focus list/panel. Nonempty final task wording and inline name/age are recognized; empty fields, explicit requirements, quantity/conflict and production guards remain. admin-ai-dashboard v15 source/auth readback matches. No task/provider writes. See ORDER_DETAIL_COLLECTION.md.

2026-10-04 verified webhook phone reconciliation: service-only icetak_reconcile_webhook_phone and crm-identity-ingest v5 deployed with existing custom token auth. Primary and verified WhatsApp identifier owners reconcile on exact authenticated order mapping; conflicts remain review. Exact Ct Izana/izana3005 example merged with one canonical active owner; repeat unchanged and private session binding has one audit event. No outgoing notification, payment/shipping/task status writes. Repository source incorporates previously live v4 behavior. See crm-identity-ingest/README.md.

## 2026-10-04 — Contribution targets

Admin V2 now has a VERIFIED contribution-target read model and direct-order cost review. The Order System privately owns goal/workday settings and direct cost overrides; existing Shopee nett/cost and sales-channel identity/date rules remain authoritative. Dashboard and Finance distinguish known actual/estimated totals, missing orders and overhead goals. finance-admin v32 deployed with unchanged owner/JWT gates; no accounting journal, payment/provider or historical cost backfill. Hosted owner UI interaction remains pending. See [CONTRIBUTION_TARGETS.md](CONTRIBUTION_TARGETS.md) for formulas, cohort limits and evidence.

## 2026-10-05 — WhatsApp Order ID evidence links

[VERIFIED] Inbox message/order-summary triggers create idempotent per-order links from one explicit known Shopee Order ID; 55 recent active-order references recovered. Shared detail scopes now include WhatsApp beside Shopee and stop at the next order reference. Selected single-item artwork counts as received detail, while screenshots, history, conflicts and print-quality QC remain guarded. Actual live source/handler replay for 261004R0RYQ2R7 resolves complete 1/1 / Ready design. admin-ai-dashboard v18 ACTIVE, all eight files match readback and JWT/private grants retained. Regression, rolled-back boundary/retry checks, component server render, typecheck and full build pass. Hosted authenticated owner interaction remains unverified. Outgoing sends and ClickUp writeback remain disabled. See [ORDER_DETAIL_COLLECTION.md](ORDER_DETAIL_COLLECTION.md).

Frontend release `5548f1e` passed Workers Builds and source guard; Cloudflare version `ed9ca73f-b234-457e-b2df-e2d0ad43409c`. Public root/admin asset chain serves the new Order ID binding label in `App-BsbkqW6c.js`. Authenticated owner interaction remains pending.


## 2026-10-05 — AWB reference Print AWB

[PRODUCTION] PR #74 release `d1b697d` passed Workers Builds and GitHub guard; Cloudflare version `1892364c-bc12-4628-b7d4-5d5a8312f6ce`. Public reference toolbar reads matched task AWB link fields through service-only bounded indexed RPC and awb-preview v3. Actual production browser for `261005SQ0C3Y1F` shows the control and clicking opens the existing `14zbjdpktr8` AWB PDF. Duplicate/multiple/missing/unsafe links and desktop/mobile behavior VERIFIED in controlled tests. No historical backfill or business writes. Physical printing not exercised. See [AWB_PREVIEW.md](AWB_PREVIEW.md).


## 2026-10-05 — AWB direct-print correction

[PRODUCTION button/PDF flow; native popup ATTEMPTED] PR #75 release `506dcf7ae72a122e878636906cb453043fa45ae3` passed Workers Builds and guard; Cloudflare version `87e8e039-530a-4cd1-9933-7d97a9b36d1b`. awb-preview v4 proxies only the stored PDF for a task belonging to the requested exact order, with allowed hosts/redirect and byte limits, unchanged PDF bytes and no business writes. Hosted Chrome observes the new Print AWB button, loading and PDF-frame print return without a new tab. Native print UI is not exposed for either print action in this cloud browser; popup contents and physical printing remain unverified. See [AWB_PREVIEW.md](AWB_PREVIEW.md).


## 2026-10-08 — AWB reference task name copy

[PRODUCTION] PR #77 release `a1cc728dcdfa871473f6d2af72be58c2ea89d27c` passed Workers Builds/guard; Cloudflare version `ae7fde23-804c-4333-816f-2e8edf44bb9c`. Each task title has a one-click copy icon with Disalin ✓ feedback. Native clipboard bytes verified in local Chromium; hosted exact-order icon/click feedback verified. Copy controls/status are hidden in print/PDF. No backend or business writes. See [AWB_PREVIEW.md](AWB_PREVIEW.md).
# 2026-10-10 — Inline Inbox reply suggestions

Backend PRODUCTION / controlled rendered behavior VERIFIED: Inbox JWT/staff-only inbox-reply-suggest v1 and private Order inbox-reply-context v1 reuse canonical context and shared SOP rules above the composer. Six-second customer quiet period, 60-second expiry, stale message/customer rejection, editable click-to-draft with append/dedup and explicit Send only. WhatsApp Enter respects expiry. Actual cross-project read and unchanged conversation state, exact auth/bundle readbacks, handler/engine regressions, desktop/mobile light/dark interaction checks and full builds pass. Admin dashboard v20 adds xreply/xbalas shorthand recognition. Hosted authenticated staff interaction remains unexercised; see INBOX_REPLY_SUGGESTIONS.md.


# 2026-10-10 — Inline suggestion cost guard

Delivery PRODUCTION / controlled UI VERIFIED: Inbox inbox-reply-suggest v2 retains JWT/staff auth and adds a service-only atomic 120/hour, 1000/MYT-day, 30s/chat allowance before canonical reads. No polling/expiry/resume refresh or unchanged-context automatic retries; scoped order events, bounded account memory cache, one browser request at a time and error/429 backoff. Live SQL rollback boundary/reset/retention/grant tests and exact gateway v2/auth readback pass; zero persisted QA counters. Ten idle minutes produce zero extra UI requests. Existing composer/send/session rules and Order inbox-reply-context v1 remain unchanged. Hosted authenticated staff interaction remains unexercised. See INBOX_REPLY_SUGGESTIONS.md.


# 2026-10-11 — Reply Knowledge

Backend PRODUCTION / rendered UI VERIFIED: Order Knowledge v2, context v4 and Dashboard v22 share published FAQ retrieval and formal/channel style; Inbox owns successful-human-only learning queue. 19 published / 61 review drafts; five-minute bounded learning batches, copy/automation exclusion and TTL cleanup active. No OpenAI generation or provider sends. Actual desktop/mobile Knowledge controls, tab unmount/no idle polling, live SQL and endpoint source/version outcomes verified; release 1417850 / Worker f9b8b660 builds/deploy/domain guard pass. Hosted Knowledge URL reaches its login gate; Inbox entry index-DUwdbjFj is served. Hosted signed-in staff interaction remains unexercised. See [REPLY_KNOWLEDGE.md](REPLY_KNOWLEDGE.md).
