# Sales Channel comparison

Status: backend and controlled rendered Admin V2 VERIFIED (2026-10-04 MYT). Hosting publication awaits the release smoke check.

Entry: Finance → Sales Channel. Existing Untung Order remains the initial Finance tab. Shopee and Deco own orders are compared in MYR with Malaysia order dates, rolling day/week/1/3/6/12-month/all/custom ranges. Calendar-month clamping reuses Sales SKU's period function. Trend is daily up to 93 days, monthly above that. Both channel totals remain visible while channel/kind/search filter only the order list. Exact counts, 50-row pagination, capped 5,000-row CSV export and existing order detail routes are included.

## Accounting and identity contract

- These are managerial order sales before refunds, not refund-adjusted net revenue or official P&L. Shipping, fees, receipts, pending nett and contribution remain separate.
- Shopee item subtotal includes item selling-price discounts. Separate seller voucher and seller coins are deducted once. Missing voucher/coin facts or ambiguous discounts retain a basis-review flag. Deco uses final order total minus delivery fee (which already includes its pricing adjustments). No buyer-paid/settlement amount is substituted for missing goods value.
- Missing goods makes full sales/share/average null. Known sales/share/average remain separately labelled. The known-sales percentage denominator is the sum of known sales of both channels; it does not impute missing amounts. Unknown refund is null. Main sales are explicitly before refund.
- Cancel/in-cancel/unpaid/unknown Shopee orders do not contribute to sales. Own canonical orders include cash-counter/unpaid commitments; drafts are absent. Own cancellation checks status/admin status/fulfillment stage. Cancelled records remain drillable. Dashboard-excluded marketplace orders and explicit known test sources/providers are excluded.
- Marketplace ownership follows canonical marketplace records. Internal mirrors are excluded from Deco by internal_order_id or exact external/order/order_no Order SN matching, irrespective of chat source. Deco means Shop/WhatsApp/counter/internal combined; unreliable historical subchannels are not inferred.
- Receipts and outstanding balances are current state for the selected order cohort, not cash flows as of the selected end date. Own receipts use unvoided payment transactions and paid, allocated pickup-checkout lines, excluding the same transaction ID twice. A paid status without a transaction is labelled status-only, not treated as proven received money. Partial payments reduce outstanding balances. Cancelled receipt movements are retained in known receipts for review.
- Shopee release requires existing explicit release evidence. Escrow and report_estimate nett remain estimated/unconfirmed release. Historical missing release evidence does not establish a debt owed by Shopee. Aging uses order date, not contractual settlement due date.
- Shopee contribution reuses finance.order_profit_row, preserving actual/estimated/incomplete states and avoiding double fee deductions. Deco has no equivalent recorded full cost model: profit and margin stay null. No historical costs or receipts are invented/backfilled.
- Known fees/refunds/shipping losses and actual/estimated contribution are partial known sums with missing-data context, never the whole-business profit. Full contribution/margin only display when every included order is complete. Product contribution is allocated by item goods ratio and labelled allocation.
- Customers repeat within the same channel using available customer ID/phone or shop-scoped Shopee identity and chronological eligible orders. Anonymous identities are reported separately. No guessed cross-channel identity matching. History coverage is displayed and does not assert a complete year.
- Fulfillment timing uses shipped_at/pickup_collected_at or valid Shopee ship_time. COMPLETED is not substituted for delivery proof. Missing timestamps stay unavailable. Growth compares preceding equal-length days and is unavailable for missing sales/zero prior period.

## Backend and permissions

Order System owns the read model: private finance.sales_channel_orders(date,date), service-only public.finance_sales_channel_report(jsonb). Migration 20261003172037_sales_channel_analytics. Both are SECURITY INVOKER with empty search_path, anon/authenticated EXECUTE revoked, service_role granted. No new tables, journal writes, order/payment mutations or outbound integrations.

finance-admin v31 ACTIVE, JWT verification enabled; new read action passes through unchanged active owner admin1/view_finance authentication. No manage_finance permission is required to read. Existing writes remain gated separately. Deployed source readback matches repository; no-Authorization request returns 401.

## Verification

- Live service-role read-only rollback suite: seven periods; channel sales sum equals overview; trend order counts; known shares sum to 100; empty period zero; pending/channel filtering; exact mirror exclusion; cancellations; unknown direct costs; incomplete sales/profit preserve null; private grants.
- September known sales: Shopee RM12,781.15; Deco RM4,203.54; known total RM16,984.69; known shares 75.25% / 24.75%. Six included Shopee orders lack goods values, so full sales/share are null. No completion/release implied.
- Actual Admin App controlled Chromium at 1440×1000 and 390×844: all presets/custom dates, known share/completeness labels, null trend gaps, channel/pending/search, empty/invalid dates, actual scoped CSV download, existing Shopee finance dialog, desktop/mobile/no page overflow and no runtime/console errors. Fixture financial aggregates are taken from the live September report; order identities are anonymized. The fixture is isolated from production imports.
- Browser plugin/skill is absent; regular Playwright used. Google Fonts request is replaced with empty CSS in QA because environment access is blocked. Chromium uses existing QA dependency in an isolated temporary extraction directory.
- Finance gateway tests, Admin type/build and complete storefront+Inbox/source-ownership build pass. Hosted authenticated owner interactions remain unverified separately from controlled testing and asset publication.

Run node supabase/tests/finance-admin-order-profit.test.mjs, supabase/tests/sales-channel.sql in a rollback transaction, and node icetak-admin/tests/playwright-sales-channel.mjs with the existing FINANCE_PLAYWRIGHT_MODULE / FINANCE_CHROMIUM_EXECUTABLE overrides when required.
