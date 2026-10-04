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
