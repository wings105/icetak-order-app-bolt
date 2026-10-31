# Full Shopee order finance

Status: backend and controlled UI VERIFIED; production release 695285e passed Cloudflare Workers Builds and GitHub guard. Hosted authenticated owner flow remains unverified.

Admin V2 Finance → Untung Order uses the same server dataset for the order list, numeric filters, daily/courier charts, summary and CSV export. The existing material settings and per-order cost editor remain separate. Existing bank/P&L, storefront, Inbox and outbound order integrations are unchanged.

## Accounting contract

- Every field under received order_income and buyer_payment_info is preserved with its exact value and source path. Buyer references cannot become seller charges. Unknown fields remain visible.
- Authoritative provider nett is used for contribution. Shipping chooses actual then estimated carrier fee; final shipping is an alternative. Credit-card transaction fee is an alternative to seller transaction fee. No double deduction from provider nett.
- Reconstructed nett is a reconciliation check, never proof of release. Unclear discounts, nonzero unmapped fields and taxes require mapping review. Missing data remains null, separate from explicit zero.
- Shipped refunds/returns keep frozen incurred material and packing costs. CANCELLED/IN_CANCEL instead follow the owner zero-value policy, with original evidence retained. A new refund/adjustment amount cannot reuse earlier release evidence for a different amount. Contribution can be negative; actual profit still requires explicit release and reviewed actual costs.
- These are order contributions before rent/utilities/business overhead, not the bank ledger or business P&L.

## History and imports

Private service-only finance.order_finance_snapshots stores immutable webhook/Excel revisions, source keys and reconciliation metrics. Trigger captures future accepted provider payloads. Bounded replay captured the six already enriched production orders; repeat capture is idempotent. No bulk operational order or cost backfill.

Excel import is owner-only, at most 500 orders / 2MB parsed JSON per batch; browser accepts .xlsx up to 10MB. Repeated product lines sum goods subtotal and returned quantity once; repeated order fees must agree. Raw report rows are retained. Strict order/shop/currency matching, invalid amounts, duplicate IDs, preview-hash revalidation and audit apply. Existing webhook data has priority over Excel. Incomplete Excel shipping/SST/escrow evidence stays incomplete; it does not become zero or released money. No canonical order/items/payment/journal writes occur.

Detail shows grouped fields, field search, source paths, reasons and last 30 history revisions. CSV includes calculated metrics and all raw finance fields for the selected dataset (maximum 5,000 orders; narrow filter if exceeded). Unknown quantities/weights are shown as raw units rather than currency.

## Validation, 2026-10-03

- Six actual Shopee payloads: 122 fields each, all reconstructed nett matched (total escrow RM42.68; fees RM15.32), no release inferred.
- Live service-role transaction rollback: negative refund/SST example -RM5.19 nett -RM1.27 materials = -RM6.46 contribution; prior release not reused; missing vs zero, history/dedup, chart/filter totals, numeric filtering, strict shop/currency, stale import, Excel reference-only priority and grants pass. QA records rolled back; retained QA orders zero.
- Existing cost regression test passes with cancellation assertion updated to retained loss. Auth gateway tests cover existing and new read/write actions, permissions and server actor.
- Regular Playwright because Browser plugin is not available: 1440×1000 and 390×844 actual Admin components. Cost editing/review, settings versions, reader/staff permissions, field search, filters, actual CSV download and .xlsx repeated-item preview/confirm pass; zero console/runtime errors. Advanced filters/import remain within mobile viewport.
- Admin TypeScript/build and full storefront+Inbox build/source ownership check pass. ExcelJS 4.4.0 loads only when importing.
- finance-admin v29 ACTIVE, JWT enabled, deployed source equals repository source. Security advisor reports private RLS-without-policy informational item; private table/functions explicitly deny anon/authenticated.

Hosted authenticated owner UI is not exercised: public entry requires owner login. Public root/admin asset smoke confirms the published release; no-auth finance request returns 401. Root production build also installs pinned ExcelJS 4.4.0, matching the standalone admin dependency. New migration filenames are aligned with versions recorded by the live migration service; SQL contents are unchanged.

## Automatic shipped-return losses — 31 October 2026

Backend PRODUCTION; private read model only. `finance.return_loss_row` retains consumed material and packing, uses provider nett after refund evidence, and avoids subtracting included seller shipping twice. Partial-refund income is retained when evidenced. Pending claims reserve consumed costs plus observed seller shipping; their prior positive escrow does not inflate target contribution. These remain estimates until final charges and actual reviewed costs exist. No bank/journal entry or provider refund approval is created.

`shopee-financial-enrich` v13 rechecks return detail and escrow together through the existing signed read-only bridge. The runtime binds shop/order/return/currency and rejects older return revisions; ingestion and return snapshots commit atomically. Open claims recheck hourly, terminal decisions daily within the existing 90-day recovery window. New provider events wake checks; failures back off without permanently stopping after eight attempts. Existing order/release jobs, wallet evidence and staff authentication remain separate.

Validation: native synthetic full/partial/pending/shipping-double-count/missing-cost/unshipped/cancellation assertions; actual worker-handler auth, paired read, identity, retry and provider/storage failure tests; live provider refresh and persisted negative contributions; deployed maintenance invocation made paired provider reads and committed finance refresh successfully. The affected owner report has no remaining incomplete rows. Hosted signed-in browser acceptance remains separate. Previously deployed cancellation migrations are now checked in using their original live versions; no historical migration is rewritten.
