# Stock management

Status: backend PRODUCTION; controlled Admin V2 rendering VERIFIED. Owner authorized the GitHub push and production merge on 14 October 2026. Frontend publication/smoke checks are in progress; authenticated hosted owner interaction remains unexercised.

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
