# Order profitability and material cost settings

Owner-requested scope: Shopee/marketplace managerial costing in Admin V2. Bank accounting remains in the existing Finance views.

## Admin surfaces

- Finance opens **Untung Order**: Malaysia date range, order/buyer/SKU search, category, data completeness, status, low-profit/low-margin sorting and pagination. MYR totals separate released income, escrow income, verified actual contribution and estimated contribution. Missing data is not zero profit.
- Marketplace Orders shows **Nett / Untung** below buyer-paid amount only for Finance-permitted admins. One bounded gateway request enriches the visible page. Staff do not receive private costing data through the existing marketplace RPC.
- Either view opens the same **Finance Order** dialog. Material costs are editable per current item, with quantity and goods-price facts owned by the server. Additional costs: packaging, wastage, reprint, labor, extra shipping, external ads and external affiliate. Work minutes permit contribution/hour comparison. Changes require explicit Save.
- **Settings → Modal Bahan** is a separate setting, also reachable from Finance. Seed estimates: Topper 12.70%, Edible 42.50%, Wafer 23.33%, Acrylic 15.83%. All apply only to goods value, excluding shipping. Optional MYR cost per SKU/unit overrides the percentage. `parent SKU::variation SKU` scopes otherwise shared variation SKUs.

## Meaning of the numbers

Contribution = nett Shopee − raw material − additional order costs. This is before business overhead and is not the business P&L.

Nett uses released_amount only with explicit release evidence (released settlement status or timestamp), otherwise escrow_amount is an estimate. COMPLETED alone cannot establish release. A valid released amount of zero remains zero. Currency mismatch blocks the calculation. Cancel/return/refund orders require lifecycle review and are excluded from the default active/completed selection.

Shopee fees in the dialog are reference fields already accounted for by nett. They are not subtracted again. Ads/affiliate entry is only for costs outside those deductions; campaign allocations retain the `allocated` estimate label. No advertising attribution is invented or automatically imported.

Unknown categories/materials, absent nett or changed item facts produce incomplete contribution. Unknown goods price blocks a percentage estimate and margin, but explicit known material costs can still support contribution. Margin denominator is goods value, not cost or nett.

All extra costs initially have zero **estimated** values; they do not establish reviewed actual costs. `Sebenar` contribution requires explicit released nett plus every material/extra cost marked actual and owner review confirmed. SKU defaults remain estimates until reviewed for that order.

## Storage and frozen versions

Order System `buivecgahhmrhlmfujgt` owns private `finance.material_cost_versions` and `finance.marketplace_order_costs`. Settings are append-only versions with an effective timestamp. Orders select the version at first_seen_at. The initial seed covers pre-existing orders, so later settings cannot rewrite their rates.

A deferred item-detail trigger captures a new order's cost snapshot at transaction completion. Old orders are projected from their original version until detail is opened/saved; there is no bulk historical backfill. Capture is idempotent. Item facts are fingerprinted; changes invalidate prior costing and require re-review rather than silently rewriting actual costs. A changed-detail form proposes current items using the original rate version.

Order and settings saves use optimistic versions and finance.audit_log. Editing defaults never changes saved order costs. Confirming order costs does not create journal entries, mutate order/payment/fulfillment state or trigger messaging, so the existing business ledger is not double-posted.

## Gateway

The existing finance-admin Edge Function validates Supabase JWT, active owner `admin1` and `view_finance`. Writes additionally require `manage_finance`; actor comes from the authenticated admin. Existing QRPay/bank actions remain. Live gateway v28 retains JWT verification.

Reads: `order_profit_list`, `order_profit_detail`, `order_profit_summaries`, `material_cost_settings`.

Writes: `order_costs_save`, `material_cost_settings_save`.

The six corresponding public RPCs are executable only by service_role. Private tables have RLS enabled and no client policies/grants. Security-advisor no-policy INFO is intentional for these private, gateway-only tables.

## Verification and deployment

- Applied migrations: `20261002181038_marketplace_order_profit`, `20261002181947_marketplace_order_profit_goods_basis`.
- Live rollback SQL suite under service_role proves accounting examples, no fee double deduction, no false release, actual/allocated distinctions, zero payout/loss, unknown goods/materials, currency mismatch, snapshot capture/retry, historical freezing, stale edits, SKU quantity cost and direct-client permission rejection. No QA orders or changed rates are retained.
- Gateway VM tests exercise the actual Edge source with controlled auth/RPC responses: unauthenticated/invalid users, staff/other owner rejection, read/write permissions, UUID/batch checks, filters and server-owned actor.
- Controlled Playwright Chromium renders the actual Admin V2 App/components at 1440×1000 and 390×844. It verifies cost edit/save/review, pending escrow, settings validation/version/SKU, Marketplace detail/batch, staff hiding and read-only controls. Google Fonts is replaced with a CSS fallback only in the test because the environment blocks the font request. Screenshots inspected; no app console/runtime errors after that controlled substitution.
- Standalone admin TypeScript/build and complete storefront+Inbox build/source guard pass. Test entry is not imported into production bundles; temporary Chromium dependencies are outside the repository.
- Authenticated hosted owner UI remains a separate production smoke check. A published commit or login page alone does not establish that check.

Run `node supabase/tests/finance-admin-order-profit.test.mjs`. Run the SQL test in a rollback transaction. For UI, run `icetak-admin/tests/playwright-order-profit.mjs` with Playwright available and optional `FINANCE_PLAYWRIGHT_MODULE`, `FINANCE_CHROMIUM_EXECUTABLE`, `FINANCE_QA_OUTPUT` overrides.
