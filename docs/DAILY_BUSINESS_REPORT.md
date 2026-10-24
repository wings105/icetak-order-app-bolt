# Daily Business Report

Backend: `finance_business_tick` → unique daily run → `daily-business-report` Edge Function → WasapFlow. Schedule defaults to 08:30 Asia/Kuala_Lumpur; retry worker checks every five minutes. It does not depend on ChatGPT, Activepieces, or a PC.

Admin: `/?admin=v2&view=daily-business-report`. Owner finance authentication is required. Controls: schedule ON/OFF, recipient, local time, template/language, preview/regenerate, test copy, queue daily report, retry failed, delivery history and MTD order rows. Test copies are explicit separate sends; the normal daily key is date/type/recipient. Turning off the schedule prevents new automatic runs; already queued/manual runs continue, subject to the global WhatsApp switch.

## Definitions

- Sale day: Shopee placed_at (fallback created_at), direct created_at, converted to MYT. Only paid, non-cancelled/non-returned/non-refunded records. Direct marketplace mirrors and test sources are excluded.
- Product sales: Shopee product_subtotal; direct total minus customer postage. Customer postage is separate. Null sales are counted as missing, never silently treated as fully covered.
- MTD: first of report month through report day; previous month comparison clamps to that month's last day. Forecast = MTD + trailing seven calendar-day average × remaining days. Forecast is not cash received.
- Contribution: released Shopee payout minus materials and recorded extras, with a packing floor of RM0.40/order (only the additional amount is deducted). Direct uses the existing finance direct contribution model and adds packing RM0.40. Direct extras may include manually entered packing: verify this before using both. No second platform fee deduction from payout. Only calculable rows contribute; denominator and missing data are displayed.
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
