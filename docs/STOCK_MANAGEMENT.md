# Stock management

## 29 October 2026 — stock movement reconciliation

Backend verified against native private-stock fixtures, rolled back after each run. A read-only replay of twenty actual consumed records produces no new movements or balance changes. Controlled rendering of the actual Stock component passes at 1440×1000 and 390×844; signed-in hosted operator acceptance remains pending.

- The private `stock.material_health` / `stock.snapshot` read model ranks mismatches, deficits, empty/low stock and incomplete usage before healthy or uncounted manual supplies. It compares physical/reserved totals with both the immutable ledger and active allocations. Unresolved usage is visible beside the affected material; an unconfirmed balance is never presented as complete. Missing opening counts for automatic materials and uncounted manual supplies are separate counts.
- The owner confirmed one standard glossy set (`1pc`, including a standard glossy line without an explicit size) uses one A4-equivalent sheet, with equal double tape. Explicit custom sizes remain review items. Unconfirmed edible/wafer inch rates are not inferred from selling prices. Parenthesized Lilac choices are normalized.
- Order `admin_status` and `fulfillment_stage`, item ownership/variation identities and first marketplace shipping history now enqueue the same stock worker. Item moves enqueue both source orders. Waiting/cancelled orders release unconsumed reservations. Removed final lines release their old reserve and retain a detail-review issue; mixed unresolved orders reserve their known lines without pretending all usage is complete.
- Earliest recorded shipping/ready-notice evidence and a newer physical-stocktake boundary prevent late mapping from subtracting usage already covered by a subsequent count. Older usage needs an explicit reconciliation. Existing fulfilled deductions stay frozen; cancellation after consumption never returns raw material automatically.
- Movement history shows balances after each processing timestamp, source/order references and independent pagination. Review issues have complete paging, code/active-order filters and reusable size/shape forms. The UI refreshes each minute while visible and on returning to the tab.

Verification: `supabase/tests/stock_reconciliation.sql`, `npm run check:stock-admin`, root/customer/Inbox production build, Admin build, critical sorting/search, purchase retry with the same UUID, 110-issue paging/filtering, rule prefill, movement totals and mobile page-width checks. The controlled browser cannot fetch Google Fonts in this environment; the fallback font renders correctly and no application runtime error occurs. Backend reconciliation may reveal negative stock when recorded purchases/counts do not cover previously unprocessed real usage. Resolve this through a real purchase or physical count, never an invented opening balance. The private schema and service-only invoker/JWT gateway boundary are retained.

Status: backend and hosted frontend delivery PRODUCTION; controlled Admin V2 rendering VERIFIED. Owner authorized publication on 14 October 2026. Authenticated hosted owner interaction remains unexercised.

## Owner contract (14 October 2026)

Inventory belongs to Order System (`buivecgahhmrhlmfujgt`). Admin V2 owns the UI at `?admin=v2&view=stock`. ClickUp statuses do not trigger a stock deduction.

- Shopee READY_TO_SHIP and PROCESSED reserve. SHIPPED consumes; later receipt/completed/return statuses never consume twice.
- Real confirmed/paid iCetak orders, including approved cash-counter orders, reserve. Quotes and drafts do not. Courier acceptance/in-transit/Shipped consumes for postal orders.
- Pickup consumes only when pickup_ready_at exists and its Ready for Pickup notification is recorded sent at or after that readiness timestamp. Queued/failed notices and an old notice alone do not consume.
- Before consumption, confirmed cancellation releases the reservation. After consumption, cancellation/return never restores raw material automatically.
- Edible big 8inch is retired. Edible standard, wafer, glossy, artpaper gold, acrylic by actual colour/finish and double tape are automatic material candidates. Other stocks are manual.
- A4/A5/A6/A7 rates are 1/0.5/0.25/0.125 A4-equivalent sheets per ordered unit. This is a fractional material measure, not a count of intact uncut sheets.
- Glossy consumes an equal quantity of double tape. Mirror Gold Artpaper uses artpaper gold, never acrylic Gold.
- Burn Away expands into edible and wafer components, each with its own actual size and the ordered quantity. No generic multiplier of two against one material.
- Inch/shape rates and the printed-topper `1pc` rate are initially unconfirmed. Owner-editable rules and reusable exact item mappings resolve these without bulk SKU cleanup. Price is not a stock rate.

## Data and cutover

The supplied `icetak-stock-setup-20261014(1).xlsx` contains 71 material names/codes and no opening balances. Only material metadata is seeded. Numeric values in the supplied Unit asas column are not treated as physical units or balances: auto materials use helai A4 setara; manual materials require an explicit unit before the first count. No July 2025 balances, old purchases or inferred quantities are imported. Wafer type is explicitly selected by the owner as the primary material; 0.3mm and 0.5mm remain separate records.

Reservations may be visible before opening counts. Consumption requires an entered opening balance and material auto activation. A genuine zero count is valid. Activation starts at server confirmation time. Closed orders predating enrollment/cutover are not backfilled. If an enrolled order shipped before its material activation, it needs manual reconciliation; the owner can attest that usage was already included in the opening balance, releasing its reservation without another deduction.

An order with incomplete item detail/mapping waits for review rather than guessing a material or usage rate. Verified mapping changes wake blocked work. A shortage does not rewrite or reject a canonical order; stock records the shipment and exposes a deficit for reconciliation.

## Boundaries and reliability

Private `stock` tables store material counts, size/exact item rules, order states, reservations, immutable movements, issue/work queues and admin receipts/audit. Browser roles have no table/schema or RPC access. JWT/active-admin checked `stock-admin` mediates service-only invoker RPCs. Owners and existing order-management staff can manage stock; global pause is owner-only. No customer identity/contact fields are returned.

Canonical order/item changes and successful pickup-notification receipts enqueue work. The processor handles at most 20 orders per invocation; blocked data/configuration is not retried continuously. Transient errors have at most three attempts with a five-minute delay. Configuration changes/manual retry can wake work. No provider polling, messages, ClickUp calls or finance entries are added.

The worker/admin writes share an advisory transaction lock; affected material rows are locked in code order. Per-order locks, stable canonical source/order/item/component keys and unique consumption receipts prevent duplicate effects. Shopee's marketplace record owns inventory; its linked iCetak order redirects to that same record. Repeated webhooks and a regression to To Ship cannot reconsume a completed order. Post-dispatch changes create review issues while keeping the prior deduction. Unchanged fulfilled lines keep their original usage when rates change. The first shipping evidence is retained even across status regression/later receipt timestamps. Late linking releases duplicate reservations or retains a proven prior deduction; two independently consumed identities require manual review.

Admin mutations require a UUID request ID. A repeated request with the same actor/action/data returns its saved receipt; conflicting reuse fails. Opening/purchase/count/waste/manual-use records are append-only movements. Reprints/waste are recorded manually; production status toggling has no stock effect.

## Verification

`supabase/tests/stock_management.sql` rolls back every fixture. It exercises normalized sizes, quantities/colours, independent Burn Away layers, equal glossy/tape rates, privacy grants, manual and zero stock, request retries, reservation edits/cancellation, one-time consumption, pickup readiness/sent receipts and post-dispatch/cutover guards. Local PostgreSQL replay uses the live source column types and finance classifier definitions with isolated canonical tables. The entire suite passed against native production constraints/triggers with rollback, including rule-change freezes, first-shipping cutover evidence, late linking, unchanged webhook updates and review acknowledgement. Fixture absence and unchanged opening/physical-use counts were queried afterwards.

No opening balance may be invented to demonstrate a production deduction. Render the actual Admin V2 component at desktop and mobile sizes and exercise forms/tabs. A controlled UI with a mocked authenticated transport is separate from a signed-in hosted owner session.

## Release evidence (14 October 2026)

- Seven stock migrations applied to Order System: foundation, runtime, identity primitives, identity processor, admin review, source replay guard and material units. Repository migrations remain append-only after deployment.
- stock-admin v2 ACTIVE with verify_jwt=true; deployed file matches source exactly. Real unauthenticated POST returns 401. Controlled actual-handler tests cover active-admin lookup, read/manage/owner separation, forged actor rejection, payload/action bounds and non-owner purchase-cost redaction. Native service_role snapshot/helpers passed.
- Every-minute icetak-stock-worker processes at most 20 jobs. Actual cron completed successfully. At verification: 45 real reserved orders, zero material/allocation reserve mismatches, no failed jobs, 71 materials, zero entered openings and zero physical order deductions. Missing detail/size/colour mappings remain visible review items; blocked jobs do not loop each minute.
- Admin V2 real App/component rendered at 1440×980 and 390×844 with a controlled owner transport: material search, 71-row completeness, retired edible removal, opening count, failed purchase/retry using the same UUID, rates, equal glossy/tape quantities, movement history, pause/resume and viewport bounds pass. Mobile sidebar transition is allowed to finish before visual inspection. Browser plugin unavailable: Playwright used; existing external Google font request is isolated in QA with the normal font fallback.
- Admin/root builds, Admin V2 source check, lint and git diff checks pass. Lint has existing warnings outside this feature. No real customer notification/send, finance posting, historical opening balance or fake production count was created.
- Hosted authenticated owner interactions remain unexercised. Opening balances, primary wafer choice, inch/shape rates and glossy 1pc rate still need owner input before the respective materials/items can auto consume.

## Hosted production delivery (14 October 2026)

PR #89 merged as e72a1cb317aa9fa1baaf656df61fd02a5e9bb5c1. Remote source tree exactly matches the tested tree dc698d148be42d512dfe8c040fa3a5252b613195. Workers Builds, Public Domain Guard (including stock gateway authorization checks) and deploy checks passed. Live Worker version: 122bdd22-94b2-4ec6-bca2-53a8c7f66541.

The exact URL https://shop.decocake.my/?admin=v2&view=stock rendered the existing Admin Login gate with no application errors and retained the stock route. Hosted main-Bwq0DgAv.js → admin-v2-route-DK_yK0QB.js → App-BBimVOrw.js references Stock-CR6_NWfM.js and Stock-BxKzzk0a.css. CSS bytes match the tested build. Component JS matches after canonicalizing scoped minifier variable names and omitting environment-dependent import declarations; all behavior, literals and member keys are preserved in that comparison. Remote JS SHA256: 4000b7d5264cbbcee4c2584adc41774f5a274b38f26401abe28d9668b7219dbb.

Post-release backend smoke: 71 materials, zero entered opening counts, zero physical order deductions, zero reserve/allocation mismatches, zero failed jobs, active every-minute worker with a successful 15:22 MYT run. Signed-in owner use remains unexercised; opening balances/activation, wafer choice and unconfirmed inch/1pc rates still need actual owner input.
