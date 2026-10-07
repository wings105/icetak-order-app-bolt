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

## Publication checkpoint

Source release `b524c9132d2c4f67c72b58858daf511d4a4ed0e8` and rebuild trigger `6c1e6a55c55c835302e6590e806f9c38cd0634b7` are on production; GitHub Public Domain Guard passed for both. The published source tree equals the locally verified tree. At the 2026-10-03 06:38 UTC checkpoint, six cache-bypassed live polls still served `main-CUC30-YA.js` → `App-B6wbDnZB.js`, without `sales_sku_report` or the Sales SKU tab. Direct Worker origin also served the old release. Therefore hosting publication and authenticated hosted-owner behavior are pending, not PRODUCTION. Current session has no Cloudflare deployment credential or signed-in dashboard session; deployment logs/retry need the connected Cloudflare account. Do not treat the rebuild trigger or GitHub guard as hosting success.


## 2026-10-04 — Publication confirmed

Workers Builds recovered and production release d3532961 published. Live root/admin asset chain contains sales_sku_report and the Sales SKU periods/tab; owner supplied the authenticated Finance → Sales SKU screenshot and confirmed the feature is visible. This supersedes the earlier pending-hosting checkpoint. Sales Channel is a separate comparison report; see SALES_CHANNEL.md.


## 2026-10-07 — Category buttons

[VERIFIED] Finance → Sales SKU offers Semua, Topper, Edible, Wafer, Acrylic and Lain-lain buttons. Date/shop/currency remain in effect. Ranking, distinct-order KPI, category trend, SKU drilldown and CSV use the selected category; switching clears the selected SKU. Search remains ranking-only.

The existing finance.material_category mapping checks each parent/variant SKU against the catalogue before title fallback. Unrecognized or ambiguous items form Lain-lain; this does not persist AI labels or rewrite order/cost records. Classification runs on distinct SKU/title pairs. Filtering occurs after full-order contribution allocation so mixed-category orders keep their original allocation denominator.

Order System migration 20261007014812_sales_sku_category_filter is applied; finance-admin v33 retains JWT/owner gates and source readback equals repository. Live Sep 1–Oct 7 reports reconcile ranking/trend net units with each category and unchanged all-category sales RM15,746.33 / 1,410 net units / 1,237 distinct orders. Topper SKU contribution values match unfiltered allocations (259 groups, zero differences). RPC remains service-role only. Gateway permission/filter tests, admin/full storefront+Inbox builds and real component desktop/mobile category/search/CSV/drilldown/date tests pass. Browser plugin unavailable; controlled Playwright uses an npm Chromium binary after the standard CDN download failed. Hosted authenticated owner check remains pending.
