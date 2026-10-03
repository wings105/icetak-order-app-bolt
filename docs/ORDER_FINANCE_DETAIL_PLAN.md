# Complete Shopee order finance and loss analysis

Status: implementation plan, 3 October 2026 MYT. This document does not claim that the proposed runtime changes are deployed. Based on production `137d0ca`, the live finance receiver/mapping and five owner-supplied Shopee Payment Information screenshots. No customer identifiers or screenshots are committed.

## Outcome

Every order can be inspected from original product value through refunds, promotions, shipping, platform deductions and adjustments to provider-reported nett, then material/additional costs and contribution before business overhead. The same financial facts support order search, filters, sorting, dashboard charts and exports. Received fields are visible; absent fields remain unknown. A report is not complete merely because it has an order row.

Use existing Admin V2 Finance and the shared Marketplace finance dialog. Store financial history in Order System Supabase. Keep Settings → Modal Bahan, version freezing, owner permissions and the bank/P&L boundary.

## Verified gaps in the current implementation

- Receiver stores scrubbed raw finance events but normalizes only subtotal, buyer-paid, one shipping value, escrow/released amounts, four fee buckets and release metadata. The shared dialog exposes only that subset.
- Raw API payloads already contain actual/estimated/final shipping, rebates, shipping SST, reverse shipping, seller discounts/vouchers, refunds, adjustments, AMS commission and the ads top-up/technical-support fee. They are not all separate reportable metrics yet.
- Current contribution function suppresses cancelled/returned/refunded orders. That prevents economic losses such as a refund followed by shipping charges from being analysed.
- Current released wallet event path is for positive releases. Negative managerial order outcomes must not be silently pushed into that path or represented as new bank receipts.
- Existing API containers do not traverse `buyer_payment_info`; its buyer-side reference fields need deliberate support. Buyer fees must remain distinct from seller fees.
- Current snapshot replacement/partial patches need per-field provenance to avoid mixing unrelated revisions. Existing event history is retained; old normalized fields are not sufficient to reconstruct all line items by themselves.

## Complete field coverage

Each field definition carries a stable metric code, Malay label, original source path/header, group, currency/unit, funding party, whether it is estimated/final, and its role: component, subtotal, alternative representation or reference. Monetary values retain decimals and provider signs. Unknown fields remain visible under received additional fields with an unmapped flag; they do not receive an invented accounting effect.

| Group | Required details | Observed API examples / report coverage |
|---|---|---|
| Product and item | Original/deal price, quantity, returned/cancelled quantity, SKU/variation, gross/subtotal, seller rebate/discount, Shopee rebate, product protection | Existing item facts; `original_price`, `order_original_price`, `order_discounted_price`, `order_selling_price`, `cost_of_goods_sold`, `seller_discount`, `order_seller_discount`, `shopee_discount`; retain original item snapshot before refunds |
| Promotions | Seller/Shopee/external vouchers, coins redeemed, seller-funded cashback, bundle discounts, credit-card/payment promotions, voucher code and funding party | `voucher_from_seller`, `voucher_from_shopee`, `voucher_from_external_party`, `coins`, `seller_coin_cash_back`, `seller_voucher_code`, `credit_card_promotion`, `payment_promotion`; Excel-only bundle indicators/discounts remain explicit report fields when supplied |
| Shipping income and cost | Buyer-paid shipping, carrier estimate/actual/final fee, Shopee subsidy/rebate, seller shipping discount, carrier discount, shipping SST and net shipping effect | `buyer_paid_shipping_fee`, `estimated_shipping_fee`, `actual_shipping_fee`, `final_shipping_fee`, `shopee_shipping_rebate`, `seller_shipping_discount`, `shipping_fee_discount_from_3pl`, `shipping_fee_sst` |
| Returns and refunds | Product refund, partial/full quantities, reverse shipping, return-to-seller fee and SST, handling fee, overseas return fee, refund offsets and compensation | `seller_return_refund`, `reverse_shipping_fee`, `reverse_shipping_fee_sst`, `final_return_to_seller_shipping_fee`, `return_to_seller_shipping_fee_sst`, `return_handling_fee`, `overseas_return_service_fee`, `prorated_*`, seller protection/lost compensation fields |
| Platform deductions | Commission, service, seller transaction fee, ads top-up/technical-support fee, AMS/affiliate commission, campaign, processing, protection and other applicable fees | `commission_fee`, `service_fee`, `seller_transaction_fee`, `ads_escrow_top_up_fee_or_technical_support_fee`, `order_ams_commission_fee`, `campaign_fee`, `seller_order_processing_fee`, protection fee fields, `sspl_fee`, `fbs_fee`, `pay_per_sale` |
| Taxes and adjustments | Applicable shipping/product taxes, cross-border/import/withholding taxes, adjustments and recoveries | Received tax fields, `total_adjustment_amount`, `escrow_amount_after_adjustment`, refund/recovery adjustments; no blanket addition of tax already included in a parent fee |
| Buyer-side references | Actual buyer total, shipping, buyer transaction/service fees, vouchers, coins and promotions | `buyer_payment_info.*`; informational unless its mapping explicitly establishes a seller-side effect |
| Nett and settlement | Original escrow, escrow after adjustment, provider-reported order income, released amount, release evidence/time, settlement reference, update time and source | Preserve both original and adjusted balances, never treat them as additive receipts; completion/delivery alone is not release proof |
| Operating costs | Raw material per item, packaging, wastage, reprint, labour/work minutes, outside-platform shipping, external ads/affiliate, cost recovery | Existing costs with actual/estimated/allocated labels; reviewed recovery/salvage is a separate amount, capped and audited against recorded incurred material cost |
| Operational context | Order lifecycle, dates, buyer/order search, courier, shipment method, country/region, category, SKU, reason for cancellation/refund | Existing order/shipment records and report context; contact/address fields remain in their existing permitted order views, not chart payloads |

API and Excel names are not assumed to be one-to-one. Some are aggregates, some are alternatives, and some are present in only one source. A versioned mapping manifest and fixtures establish each supported interpretation. Preserve the original value and source so differences can be reviewed.

## Accounting and reconciliation rules

1. Provider-reported nett is the controlling balance for contribution. Display the detailed bridge from goods to nett, but do not subtract its shipping, vouchers, fees or refunds again from nett. The independent reconstructed bridge is a reconciliation check, never an automatic replacement when incomplete.
2. Separate subtotal rows from their components. Do not count a combined fees row together with commission/service/transaction rows, actual plus estimated shipping, original plus adjusted escrow, or SST already included in a fee.
3. Seller-funded promotion, Shopee-funded subsidy and buyer-only costs have separate identities. They cannot all be classified as seller loss. Effects require source-specific mapping; unknown funding/effect is flagged.
4. Shipping effect is buyer shipping plus applicable subsidies/recoveries minus the applicable carrier charge, seller shipping/SST charges and return charges. Only compute when the required components and their status are known. Also show outbound and return effects separately. Show estimate versus actual change as a comparison, not another deduction.
5. Contribution = current provider nett − incurred material − additional outside-platform order costs + confirmed material recovery. Negative nett and zero nett are valid. Distinguish missing values from a confirmed zero.
6. Refund or cancellation does not reset incurred material/reprint/labour to zero. Preserve the original cost basis. A cancelled-before-production order can have reviewed zero incurred cost; already-used materials can be recovered only through an explicit reviewed recovery, not because product revenue became zero.
7. Returned/refunded orders with known financial values remain in loss analysis. Incomplete settlement or unreviewed costs retains an estimated/review label, but known negative balances remain visible. Current lifecycle suppression must be replaced by financial completeness rules.
8. Actual contribution requires authoritative final settlement/adjustment evidence and reviewed actual costs. A UI label `Order Income`, an order-complete timestamp or a numeric adjusted-escrow field alone does not establish settlement evidence. Preserve the existing release guard.
9. Original order value, post-refund merchandise and buyer paid are separate denominators. Show clearly labelled margin on original goods value where meaningful; do not divide by zero after a full refund. Loss amount in MYR remains the primary returned-order comparison.
10. Platform ads top-up/technical-support fee and AMS commission are displayed separately from external marketing spend. Manual ads/affiliate fields mean additional costs outside provider nett. Allocation remains estimated, with attribution/source references to prevent duplicate recognition.
11. Estimated and final snapshots are revisions, not additive transactions. Preserve release and later refund/adjustment history; distinguish a provider's cumulative balance from a cash movement. Do not alter existing bank journals or wallet posting while adding this managerial projection.
12. Reconciliation exposes `matched`, `difference`, `incomplete`, `source_conflict` or `unmapped`. Display the residual between a complete, independently reconstructed income and provider nett. Never invent a fee to force the residual to zero.

## Storage and ingestion

- Retain existing immutable scrubbed events. Add private versioned breakdown snapshots and their line items, with event/source IDs, provider timestamps, received timestamps, currency, mapping version, coverage and release evidence. Add an indexed latest-per-order projection with commonly filtered monetary metrics.
- A line item stores metric code, original source path, raw amount, normalized display/effect amount where defined, funding party, grouping/aggregate relationship and estimate/final status. Generic additional fields cover future API fields until a mapping is established.
- Extend the current finance receiver without changing the owner's automation URL contract. Accept nested Shopee API responses and explicit mapped Excel imports. Webhook-provided identity cannot replace server actor/permissions.
- Order/shop/currency matching stays strict. Wrong-shop, currency conflict, unmapped or ambiguous data remains in review rather than attaching to a convenient order. Deduplicate identical retries and order-level repeated report amounts.
- Source freshness is evaluated using provider timestamps and snapshot identity, not arrival time alone. Partial newer patches retain per-field provenance; omitted fields do not become zero. A later unreleased estimate cannot downgrade confirmed release, and a newer legitimate refund must not be discarded merely because an older release exists.
- Preserve all revisions and show a change history: estimated → updated → released → refunded/adjusted. Old and new nett can be compared without summing them. Selection of adjusted versus original escrow must be explicit and fixture-tested.
- Replay already-stored payloads into the new derived projection in bounded batches, with a dry run, counts, audit and repeat-run idempotency. This does not resend webhooks or recreate orders/payments/messages/tasks. Existing material versions and reviewed actual costs remain unchanged.
- Excel import uses upload preview, exact order/shop matching, per-order grouping and item lines. Repeated order-level fees across product rows are counted once; conflicting duplicates are review items. Parse MYT dates, zero/negative values and blank cells correctly. Historical exports cannot overwrite newer authoritative API settlement data. Missing operational orders are reported for mapping; finance import cannot silently create them or notify customers.
- Previously received finance can be reprocessed; orders without finance cannot be populated with invented income. Coverage is visible in every report. Refresh requests through the existing automation are bounded, logged and deduplicated; pending-release/refund refresh policy stops or flags aged unresolved cases rather than looping indefinitely.

## Order detail and searchable list

The shared Finance Order dialog follows the screenshots: item summary; merchandise and refund subtotal; promotions by funding party; outbound/return shipping and SST; fees and charges; adjustments; provider nett; material/additional costs; contribution. Include actual versus estimate badges, source/update time, reconciliation status and a revision history. Every received financial field has a labelled value or additional-fields entry; absent expected fields read `Belum diterima`.

List metrics include original goods, refunds, seller-funded promotions, outbound shipping effect, reverse/return shipping, platform fees, platform marketing-related fees, external ads/affiliate, nett, material, contribution, margin and coverage. Column selection avoids putting the entire breakdown on every default row.

Search by order ID, buyer, SKU, product and financial reason. Filters combine MYT date range/date basis, category/SKU, courier, country/shop, operational and financial lifecycle, settlement status, source/coverage, negative nett, negative contribution, shipping loss, return costs, seller promotion, platform ads/AMS fees, external marketing and reconciliation issues. Numeric filters support greater/less/range values. Stable server-side sorting supports worst contribution/margin, biggest shipping/return charge, refund, seller promotion, fee rate and newest update. Saved views and filtered export reuse exactly the same filter semantics.

Reasons are factual labels such as `Shipping negatif`, `Reverse shipping`, `Refund barang`, `Voucher seller`, `Fee tinggi`, `Kos bahan tinggi` and `Data belum lengkap`. Multiple reasons may coexist. A deduction does not automatically mean a provider error, and an alert does not pretend to establish causal attribution for advertising.

## Dashboard and drilling into evidence

- Cards: orders in selection, orders with finance/settlement/cost coverage, released versus pending nett, actual versus estimated contribution, negative orders, outbound/return shipping costs, refunds, seller-funded promotions and fee totals.
- Trend: daily/weekly/monthly nett and contribution, with actual and estimates distinguished.
- Ranked bars: confirmed/estimated deductions and shipping losses, top loss-making SKUs/categories and couriers with shipment denominators. Show cost/rebate contributions, not only gross shipping charges.
- Order waterfall: original goods → merchandise changes/promotions → shipping effect → fees/adjustments → nett → material/additional costs → contribution. Display a reconciliation residual or missing component rather than fabricating a complete bridge.
- Return analysis: return/refund count and rate, negative nett, return shipping/SST and contribution loss. SKU/courier groups support drill-down to the exact filtered order list and shared financial detail.
- All charts/card totals/list/export use the same server projection, filters, currency and date basis. Do not mix original-order-month performance with release-month cashflow. Multi-currency amounts are separate; no assumed conversion rates.
- Coverage labels accompany totals: unknown income/cost is excluded from known-only sums and reported as missing, never zero. Do not call a deduction ranking a complete decomposition of total business loss; income deductions and already-incurred costs are distinct measures.

## Screenshot-based acceptance cases

| Reference scenario | Expected result |
|---|---|
| RM22 order cancelled in full | Product RM22 and cancellation −RM22 remain visible; merchandise/nett zero where confirmed; incurred costs still determine contribution |
| RM10 topper, fees RM3.22 | Commission 1.67 + service 0.70 + transaction 0.74 + ads top-up 0.11 = 3.22; estimated provider income 6.78; marketing-related fee shown once |
| RM12 edible with shipping rebate | Buyer shipping 0, carrier 4.90, rebate 4.90 → shipping effect 0; fees 1.04 + 0.70 + 0.45 + 0.16 = 2.35; provider income 9.65 |
| RM10 topper, provider income RM7.14 | Fees 1.67 + 0.70 + 0.38 + 0.11 = 2.86; no residual 0.11 hidden as missing; item cost remains separately estimated/reviewed |
| Full refund, returned parcel | Product 10 − refund 10 = 0; shipping −4.90 and SST −0.29 → provider nett −5.19; with illustrative incurred material 1.27 and no extra cost, contribution −6.46, clearly estimated until costs/settlement evidence are confirmed |

Also test seller versus Shopee voucher funding, partial returns, multiple items, repeated Excel fees, sign conventions, original versus adjusted escrow, taxes included in parent fees, refund after release, stale/partial callbacks, duplicate replay/import, known zero, absent fields, currencies, optimistic cost edits, staff/read-only roles, snapshot totals, chart drill-down and desktop/mobile detail scrolling. Use service-role rollback tests and controlled gateway/UI tests before release. Hosted owner smoke remains required to promote the complete new outcome to PRODUCTION.

## Delivery order

1. Inventory and mapping manifest; screenshot/real-payload fixtures and accounting invariants.
2. Append-only migrations, complete normalization, private projection and reconciliation; replay existing payloads safely.
3. Shared order breakdown, loss lifecycle handling, search/filter/sort, coverage and external-cost safeguards.
4. Server report aggregates, drill-down charts and filtered exports; Excel preview/import with duplicate/conflict rules.
5. End-to-end tests, production source/deployment evidence and owner smoke, with updated status/docs.

Completion requires all accepted financial fields to be visible and traceable, the screenshot scenarios to reconcile, negative shipping/refund outcomes to be findable, and cards/charts/list/export to agree without duplicated deductions. A full-looking screen populated with assumed zeros is not completion.
