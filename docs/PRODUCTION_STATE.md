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
