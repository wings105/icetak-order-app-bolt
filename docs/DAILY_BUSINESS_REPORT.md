# Daily Business Report

Backend: `finance_business_tick` → unique daily run → `daily-business-report` Edge Function → WasapFlow. Schedule defaults to 08:30 Asia/Kuala_Lumpur; retry worker checks every five minutes. It does not depend on ChatGPT, Activepieces, or a PC.

Admin: `/?admin=v2&view=daily-business-report`. Owner finance authentication is required. Controls: schedule ON/OFF, recipient, local time, template/language, preview/regenerate, test copy, queue daily report, retry failed, delivery history and MTD order rows. Test copies are explicit separate sends; the normal daily key is date/type/recipient. Turning off the schedule prevents new automatic runs; already queued/manual runs continue, subject to the global WhatsApp switch.

## Definitions

- Sale day: Shopee placed_at (fallback created_at), direct created_at, converted to MYT. Only paid, non-cancelled/non-returned/non-refunded records. Direct marketplace mirrors and test sources are excluded.
- Product sales: Shopee product_subtotal; direct total minus customer postage. Customer postage is separate. Null sales are counted as missing, never silently treated as fully covered.
- MTD: first of report month through report day; previous month comparison clamps to that month's last day. Forecast = MTD + trailing seven calendar-day average × remaining days. Forecast is not cash received.
- Contribution: released Shopee payout minus materials, packing and other recorded extras. Direct uses the existing finance direct contribution with packing included once. The old flat packing floor is retired; pickup has zero postal packing. No second platform fee deduction from payout. Only calculable rows contribute; denominator and missing data are displayed.
- Costs: existing versioned finance cost models and actual overrides; estimates remain labelled. Direct courier net = known/estimated courier cost minus postage collected. No separate Shopee courier deduction from payout. Overhead, wages and unrecorded advertising are not net profit.
- Channels: explicit sales_channel if present, customer/customer_portal = web, chat_trigger = WhatsApp/chat, pickup_trigger retains its technical name. Unknown stays unknown; pickup does not establish physical walk-in.
- Ingestion: reads latest stored operational data; does not fetch/re-enrich all Shopee orders. Marks Shopee data incomplete when no order was seen in the last 24 hours. This freshness heuristic is not a guarantee all orders are synced.

## Delivery and recovery

Sender checks global WhatsApp enabled and the existing 24-hour window endpoint. If closed, an APPROVED template is required; it must have one body text parameter. Configure template name/language only after provider approval. There was no daily-report template approved at rollout; closed-window runs fail visibly and retry with bounded exponential backoff (maximum five attempts). Existing order templates are not reused for unrelated reports.

A successful provider response must include a message ID. Run status `sent`, delivery status `accepted` means API acceptance only, not delivered/read. No delivery/read webhook mapping is added by this release.

Ambiguous provider timeout/5xx or a stale processing worker becomes `uncertain` and is not automatically resent. Verify the provider first; use an explicit Test copy only after checking. Deterministic pre-send failures retry; failed runs can be retried from the page. Database snapshots/version history are retained on generation and send attempts. Snapshot regenerations do not resend accepted reports.

## Rollout verification

- Live calculation for 2026-10-24 and month-boundary comparisons for 2026-10-01 / 2026-09-30.
- Repeated normal enqueue for 2026-10-24 produced exactly one routine run.
- Anonymous/authenticated roles have no RPC execution or table access; owner Edge Function mediates access. Private finance tables have RLS and intentionally no client policies.
- First real run accepted by provider with message ID, one attempt. No customer messages sent.

## Visual dashboard — 25 October 2026

VERIFIED controlled UI. The web report now prioritises KPI cards, daily sales/order trend, channel donut (MTD or report day), comparison/forecast bars, separate known-cost bars and a coverage ring. Teal denotes sales, orange Shopee, blue web/material, purple pickup/courier, and muted gold forecast/estimates. Existing Admin navigation and white panel system are retained, following the owner's dashboard references. The visuals are native SVG/CSS with responsive measurement; no chart-library or raster dependency.

All charts derive from the exact saved snapshot already used by WhatsApp. The trend zero-fills calendar days up to report day; missing order amounts remain flagged. MTD/day channel totals are checked against stored KPI totals. Coverage means known material values, not profit margin. Cost bars are independent components and are not labelled total expenses or a profit waterfall.

Hover/focus exposes per-day figures; keyboard Enter/Space or click opens corresponding orders. Donut segments/legend open channel-filtered orders. Order search, reset, 25-row paging and filtered CSV export are local read-only operations. WhatsApp actions and settings keep their existing authenticated RPC contract in a separate tab/collapsed section. Date requests are sequenced to discard stale responses. No backend schema, sender, scheduler, price, payment, or customer state changes are part of this enhancement.

Controlled validation uses the real report component and existing Sidebar/Topbar, with saved-snapshot fixture transport and zero real service writes. Desktop 1580×1080 and mobile 390×844 screenshots were inspected against the owner's references for KPI hierarchy, chart anatomy, white panel spacing, teal/semantic palette, responsive labels and collapsed settings. The mobile KPI overflow and donut centre sizing found during QA were corrected. Daily/channel sums, missing-value coverage, month-day generation, empty-state aggregation and CSV quoting checks pass. Root build/source guard and Admin typecheck/build pass. A hosted authenticated owner session is not exercised by controlled transport tests.

## Standard packing visibility — 30 October 2026

Private finance packing settings hold owner-approved small/topper, large-edible and acrylic rates. Use the highest item tier once per order, never multiply by quantity or add mixed-item rates. Direct postal orders use the same estimator; explicit pickup/walk-in/counter uses zero. Standard packing is an estimate; confirmed manual marketplace costs are retained. OPP pack quantity remains an assumption pending confirmation.

Finance and Target money breakdowns return packing separately from other extras while retaining their existing profit cohorts. The Target monthly packing summary includes all finance-eligible orders (including incomplete contribution); its card arithmetic covers known contribution only. Untung Order follows its date/status/currency filters and reports the full filtered cohort, not just the current page. These scopes can differ from each other and from the paid-only daily report.

Snapshot schema 2 exposes packing_total, packing_shopee, packing_direct, packing_missing and per-order packing for chart/table/CSV. Reading an older saved snapshot requests a new version through the existing generate action; historical versions and delivery receipts remain intact. Generate does not enqueue or send WhatsApp. The current report date remains yesterday or earlier. Existing sender/automation controls are unchanged.
