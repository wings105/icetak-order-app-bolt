# Target & Margin

Status: VERIFIED in the rendered Admin V2 App and against the Order System database. Hosted authenticated-owner interaction remains pending. Finance gateway v32 is ACTIVE with JWT enabled; exact deployed source readback matches. This report is a managerial contribution estimate, not a cash balance or complete accounting profit.

## Admin surfaces

- Business Command Center: owner finance panel above the existing period toolbar. Always the current MYT calendar month, independently of command-center period/source filters. Its refresh follows successful command-center snapshots and also has an independent retry.
- Finance → Target & Margin; deep link `?admin=v2&view=finance&finance_tab=target-margin`. Monthly overview, separate Shopee/direct cards, order filter/search/date/sort, 50-row pagination and order cost details. Table filters do not change the whole-month target summary.
- Orders → order drawer → Payment: direct contribution breakdown and audited cost editor. Shopee details continue using the existing Untung Order cost editor.
- Target settings live in the Finance tab. Material/SKU defaults remain in Settings → Modal Bahan Produk.

All finance values require existing `view_finance` access; edits require `manage_finance`. The server continues restricting Finance to the active `admin1` owner. Staff do not request the target report.

## Calculation contracts

Shopee contribution = existing `finance.order_profit_row.nett` − material − extra costs. Provider nett/escrow is a labelled estimate until released evidence and actual reviewed costs exist. Platform fee/shipping amounts are reference fields and must not be deducted twice. Cancellation/refund requires reviewed costs; cancelled positive escrow cannot inflate the target until released evidence exists.

Direct contribution = fully paid customer amount (including postage, capped at order total) − courier − material − extra costs. Unvoided real transaction/allocated checkout evidence takes precedence; a recorded Paid status without a transaction may contribute only as an estimate. Partial payment, cancellation or refund is excluded. Direct cancellation/refund losses are not yet posted in this managerial target model; use Finance accounting for those movements.

Example: goods RM24 + customer postage RM4.50; receipt RM28.50. With courier RM4.50 and the existing edible cost rate 42.5% on goods only, contribution is RM13.80 and margin 57.50%. A later actual courier charge RM6 changes contribution to RM12.30.

Courier is the sum of active parcel charges; if all charges exist it is actual, otherwise complete charge/quote coverage is estimated. For no parcel or one unpriced parcel, positive order postage is a fallback estimate. Multiple unpriced parcels, foreign-currency charges, or zero/free postage without a known charge need cost review. Pickup is zero actual courier cost. Manual actual courier overrides AWB; manual estimates yield automatically to actual AWB charges.

Direct material uses the immutable default version effective when the order was created. Known SKU unit costs take precedence; otherwise category percentage is allocated across goods, including order-level discount and excluding postage. Unmapped/missing item costs stay null. Manual cost review is invalidated by changed item facts, totals or delivery method. Missing contribution is shown as incomplete and is never invented as zero per order. Known totals identify the number of incomplete orders.

Marketplace internal-order mirrors and explicit test sources are excluded by the existing sales-channel identity/cohort rules. Only MYR Shopee orders enter this report. Order day is the existing sales-channel MYT order-date cohort; it does not regroup old orders by settlement/cash date.

Margin % = contribution ÷ goods sales, rounded to two decimal places. Channel margin remains unavailable if any included contribution/sales is missing. Losses reduce known contribution.

## Target settings and dates

Initial overhead RM5,000; optional owner-income goal RM0; workdays Saturday–Thursday (Friday off), no holidays. Goal = overhead + owner income. Settings are global and also apply to historical month views; they are not monthly budgets or historical overhead snapshots.

Remaining = max(goal − known contribution, 0). Count remaining workdays from today through month-end, inclusive, excluding configured holidays. On a workday, daily target is remaining at the start of today divided by remaining workdays; today’s contribution is then subtracted to show today’s gap. On a day off, use current remaining divided by future working days. Past months show the original goal / full-month workday count rather than a current daily target. Month-end with no remaining workdays shows no daily target.

The report returns `fetched_at`. Failed reports display an error; an independently refreshed dashboard can retain its previous reading only with an explicit stale-reading notice.

## Backend ownership

Order System project `buivecgahhmrhlmfujgt`, private `finance.contribution_target_settings` and `finance.direct_order_costs`, RLS and revoked client grants. Service-role-only RPCs:

- `finance_contribution_report(jsonb)` and `finance_contribution_detail(uuid)`
- `finance_contribution_settings_save(integer,jsonb,text)`
- `finance_direct_costs_save(uuid,integer,text,jsonb,text)`

`finance-admin` adds `contribution_report`, `contribution_detail`, `contribution_settings_save`, `direct_costs_save`. Actor is server-owned. Saves lock rows, reject stale versions/source signatures and write `finance.audit_log`. Settings/cost writes do not post journals, change customer order/payment facts or send provider messages. Report reads do not backfill costs.

## Verification (2026-10-04)

- Admin TypeScript/standalone build, full storefront/Inbox production build, admin source guard and diff check pass. Admin lint has existing warnings, none introduced in the new components.
- `supabase/tests/contribution-targets.sql` passed live in a rolled-back transaction: RM28.50 edible example, quote/charge replacement, receipt evidence, stale/version guards, title/quantity changes, multiple unknown/foreign parcels, partial payment, Shopee arithmetic, mirrors, aggregate reconciliation, holidays, audit and client grants. No retained QA orders/payments/parcels/costs/settings/events.
- `supabase/tests/finance-admin-order-profit.test.mjs`: existing and new actions, owner/staff/reader gates, bounded filters and server actor passed.
- `icetak-admin/tests/playwright-target-margin.mjs`: actual App desktop/mobile, both detail types, direct save/actual labels, target settings, table-vs-summary scope, loss/search/sort/date/error states, reader/staff gates and dashboard navigation; zero console/runtime errors.
- Existing order-profit and sales-channel rendered regressions pass.
- `playwright-target-margin-live.mjs` renders a separately fetched live report read-only. It verifies actual totals, channel cards, missing-data labels and all 50 page rows on desktop/mobile. Do not commit the business-data response file.
- Live database smoke includes October, September and August. Current settings remain default/version 1 and `direct_order_costs` is empty; only schema/default configuration was retained.
- Finance v32 is ACTIVE, JWT true, source readback exact; unauthenticated live POST returns 401. Signed-in owner production interaction is not claimed as verified.

Run UI checks with `FINANCE_PLAYWRIGHT_MODULE` and optional `FINANCE_CHROMIUM_EXECUTABLE`. Browser plugin was unavailable; regular Playwright used an isolated npm-packaged Chromium after the default browser download failed.

Production publication: feature commit `fbfa3bc` passed Workers Builds (`471ad30c-7b5e-40a0-aabc-f6f5f198fe8f`) and Public Domain Guard. Public index links `main-CaDkA1_G.js` → `admin-v2-route-rNJqfjvd.js` → `App-Dy00HLE8.js` with the target and direct-cost actions. The cloud-browser deep link resolves to the Admin Login; no authenticated owner interaction was performed. A follow-up backend review-flag guard requires fresh actual-cost checks after source changes; its rollback test passes.
