# Sales SKU analytics

Finance → Sales SKU is the owner-only Shopee SKU read model, behind the existing `finance-admin` JWT/owner/view_finance checks. No new order, payment, cost snapshot or notification writes are made by reporting.

## Counting contract

- Malaysia calendar dates, rolling inclusive 1 day / 7 days / 1, 3, 6, 12 calendar months; all available history or custom dates. Monthly boundaries clamp the day to the previous month's length before advancing one day. Currency and shop filters are applied before aggregation.
- Latest Excel `report_items` supplies each order's historical item rows and order creation date. Current normalized marketplace items are the fallback only when the Excel item array is absent/empty. This avoids counting both copies. Data coverage is returned/displayed explicitly; long periods do not imply complete history.
- Cancelled, unpaid, in-cancel, unknown and dashboard-excluded canonical orders are excluded. Excel cancelled/unpaid status is also excluded. Return quantity is clamped to ordered quantity. Net units = units minus returns. Sales = product subtotal before platform deductions, not settlement nett or refund-adjusted revenue.
- Distinct parent and variation SKU references form `parent::variation`; otherwise the available code is used. Missing references are separated by product/variation hash, with the display label Tanpa SKU. Multiple variation names under a code show a variation count.
- SKU contribution is an estimate allocated from existing order profit by item subtotal / total order goods. Any unknown item subtotal or order contribution preserves null. Missing contribution never becomes zero. Daily/monthly empty buckets are zero; incomplete populated buckets remain null and chart segments break.
- Ranking returns at most 5,000 SKU groups with an explicit truncation notice. Selected-SKU orders return the latest 500 with a total count/notice. Client search/sort/CSV operate on the loaded ranking; trend and KPI totals remain the selected date/shop/currency scope. CSV blanks preserve missing values and text cells protect spreadsheet formula interpretation.

## Verification (2026-10-03)

Backend and controlled rendered frontend VERIFIED. Migration `20261003061250_sales_sku_analytics` is applied; finance-admin v30 has JWT verification enabled. Anonymous and authenticated direct RPC execution are denied; existing finance gateway owner/staff/read-only checks pass. Live no-auth gateway smoke returns 401.

Live seven-period reports reconcile ranking-unit sums, trend-unit sums and overview units for every period. September: 1,171 units, 13 returned, 1,158 net units, 1,012 distinct orders and 310 SKU groups. A selected September SKU reconciles 174 net units across ranking, trend and 151 order details. No excluded status or return-over-quantity lines are present.

Rendered actual Admin V2 fixture tests prove periods/custom range, net/return display, ranking changes, incomplete profit, search, downloaded CSV, selected SKU and existing order detail, desktop/mobile layout and no runtime errors. Existing order-profit desktop/mobile regression passes. TypeScript/admin and complete storefront+Inbox builds pass. These controlled tests do not establish authenticated hosted-owner behavior.

Run `node supabase/tests/finance-admin-order-profit.test.mjs` and `node icetak-admin/tests/playwright-sales-sku.mjs` (optional FINANCE_PLAYWRIGHT_MODULE / FINANCE_CHROMIUM_EXECUTABLE overrides). Fixtures are isolated from the production entry.
