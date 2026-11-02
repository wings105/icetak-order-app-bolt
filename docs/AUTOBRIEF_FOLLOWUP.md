# AutoBrief missing-detail follow-up — 2 November 2026

Owner policy replaces the earlier 30-minute proposal **only for this glossy cake
topper workflow**. Other detail collectors and draft follow-ups are unchanged.

## Behavior

- At least 15 minutes after placement, an active paid Shopee order with no Buyer
  Note, no printable wording and no customer reply gets one fixed detail request.
  Only live ORDER LIST CN/YS tasks in DESIGN EDITING -TOPPER qualify. Successful
  provider receipt changes Review customer to the existing `follow up1` option.
- Exact order/shop/buyer provider reads and the existing linked Inbox/WhatsApp
  reader recheck replies. Clear detail updates the same AutoBrief, Customize Name,
  Confirmed and Ai Check, including transition out of follow up1. Ambiguous details
  retain review. Staff wording, other review choices and started production remain
  protected.
- Starting at 14:00 Asia/Kuala_Lumpur on the provider shipment deadline date,
  an order still lacking detail receives the fixed deadline notice once. Only
  after its provider receipt is confirmed is Customize Name set to lowercase
  `hb`. This default does not claim customer confirmation or change follow up1
  to Ai Check. A later clear reply can replace policy hb with customer wording.
- Every AutoBrief comment now includes Order ID alongside SKU/title/product ID.

First message:

```text
Hi,

Sila berikan nama & umur jika untuk topper.

Jika tiada, kami akan proceed dengan wording default seperti "Happy Birthday".
```

Deadline message (exact owner text):

```text
we proceed to make sure receive timely. thanks
```

## Ownership and safeguards

Order `clickup-order-brief` owns task eligibility, linked-context assessment,
ClickUp field/comment updates and the existing per-task lease. Inbox
`autobrief-followup` uses the existing shop-specific configuration and shared
Shopee signing transport. Fresh signed order reads verify recipient, product,
paid/active state, placement and ship-by. A verified provider conversation can
fill the gap when no local conversation was ingested; provider fallback reads
begin at order placement and never import earlier history. Exact Inbox session
logic remains responsible for any pre-order evidence. Multiple active orders
for the same shop/buyer block automatic assignment/sending.

Inbox's service-only RLS tables store context IDs and one receipt per
shop/order/phase. Claims serialize sends. Existing matching provider messages
are adopted without resending (including earlier escaped line breaks); a manual
follow up1 observation stays distinct from provider proof. Fresh order/chat
revision and live task reads guard dispatch. Unknown/lost responses are never
blindly retried; history can reconcile them. Definite failures have at most three
attempts with five-minute backoff. Existing arbitrary user text cannot become an
automated send body: the bridge accepts only the two fixed phases.

Orders placed after their 14:00 deadline, missing/expired deadline dates,
unverified/truncated chat, substantive unresolved replies or images, cancelled/
shipped orders, staff changes and unsupported product/status all hold for review.
No default is applied merely because a send request was queued.

## Scheduling and operations

The service-only `icetak_dispatch_order_brief_followups` uses the existing worker
canary/lease/record contract. Its minute lane dispatches up to eight eligible
tasks independently; a 06:00 UTC daily lane prioritizes up to 25 shipment-day
tasks. The existing general AutoBrief poll remains intact. Limits and provider
latency mean processing begins at the cutoff rather than promising simultaneous
delivery for every order.

Inbox control: `autobrief_followup_control.enabled`. Order control:
`private_runtime_settings.order_brief_followup_enabled` (text `true`/`false`).
Pause Order dispatch first; the Inbox switch independently blocks new sends.
Keep all worker/bridge/API credentials private. Both functions retain mandatory
in-code token checks; no public/browser write grants are added.

Audit: `autobrief_followup_deliveries`, exact task `clickup_order_brief_jobs.brief.followup`,
existing message/change receipts and cron run details. These are private backend
records; this change adds no new owner UI.

## Verification

- `scripts/check-autobrief-followup.mjs` executes the actual Order worker and
  actual Inbox bridge together under controlled database/provider transports:
  exact clock boundaries/text/recipients, first-send and deadline CF effects,
  reply/Ai Check, manual adoption, repeated/concurrent requests, lost response,
  history reconciliation, stale revisions, linked WhatsApp, older history,
  staff/status/auth guards and one AutoBrief comment.
- `backend/inbox/autobrief-followup.test.sql` checks native receipt dedupe,
  unknown recovery, manual-vs-provider proof and browser denial in rollback.
- Product-context, detail-automation and task-readiness regressions remain required.
- Real provider history confirms an existing owner-authorized first message;
  it is adopted with zero new send attempts. Future actual deadline delivery is
  not implied by controlled clock tests.
