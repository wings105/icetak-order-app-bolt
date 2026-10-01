# iCetak Production State

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
- See `docs/CAKE_MOCKUP.md` for dimensions, privacy and validation contracts.


## 2026-10-01 — AI order work lifecycle

Order System migrations ai_order_work_lifecycle and ai_order_work_safety applied; private task/set mapping and global order-work RPC verified live and with rollback tests. admin-ai-dashboard v7 ACTIVE, JWT enabled, six sources read back equal. Hourly stored replay enabled; separate hourly ChatGPT provider reconciliation scheduled. Initial pull/project of 49 task snapshots succeeded; scheduled execution not yet verified. Admin UI implementation/build passed, but authenticated rendered check is pending (cloud browser shows Admin Login). See AI_ACTION_DASHBOARD.md; full frontend flow is not yet PRODUCTION.
