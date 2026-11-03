# AutoBrief missing-detail follow-up — 2 November 2026

Owner policy replaces the earlier 30-minute proposal **only for this glossy cake
topper workflow**. Other detail collectors and draft follow-ups are unchanged.

## Behavior

- At least 15 minutes after placement, an active paid Shopee order with no Buyer
  Note, no printable wording and no customer reply gets one fixed detail request.
  Only live ORDER LIST CN/YS tasks (including the standard SG SKU suffix) in DESIGN EDITING -TOPPER qualify. Successful
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
- SKU and wording use separate native plain-text code blocks with bold labels;
  ClickUp supplies the hover Copy control. Copy values exclude labels. Custom
  pixel font sizes are controlled by ClickUp. Rich payloads have a versioned
  presentation hash so each existing brief migrates once on its next normal poll.
- Human-visible proof/change-message timestamps use `DD/MM/YYYY HH:mm:ss MYT`
  in Asia/Kuala_Lumpur. Stored message/audit timestamps remain their original instants.

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
existing message/change receipts and cron run details. These remain private records. Admin V2 now exposes a read-only log tab; see below.

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

## Admin V2 logs and brief remarks — 2 November 2026

Open `/?admin=v2&view=automation&automation_tab=autobrief`, or Automation → Log AutoBrief.
The existing `admin-automation` gateway requires a valid JWT, active admin and
`view_orders`/manager access before calling the service-only invoker
`icetak_autobrief_logs`. There is no send/retry action in this tab and no browser
access to runtime settings, service credentials or receipt tables.

The paged list contains one row per task/phase, literal Order ID/Task ID search,
phase/status filters, checked time, deadline and real receipt state. Detail shows
the current remark, product references, wording/confirmation, job errors,
request/provider IDs, send/retry times and attempt counts when recorded. Manual
follow up1 and provider acceptance stay distinct; accepted does not mean read.
The list is a last-check snapshot, not a claim that every waiting row will send.

`autobrief_followup_events` records meaningful receipt, block/default and detail
transitions from deployment onward. A trigger excludes routine checked/updated
clock changes. History is append-only for the gateway, bounded to the latest
100 transitions per exact task, with 30 phase rows per list page. Existing phase
receipts are displayed without inventing earlier transition history. A later
worker failure that clears the current brief retains the latest recorded receipt
snapshot with an explicit historical warning. No historical customer backfill is
performed. RLS without browser policies is deliberate service-only isolation.

Order worker v46 adds a stable `Automation follow-up` remark to the existing
single AutoBrief comment and persists `brief.followup_remark`. It states provider
acceptance time in MYT, manual/unknown/failure/blocked state, waiting/cut-off,
available detail or policy hb. Poll timestamps are excluded from comment text to
avoid repeated ClickUp edits. Inbox bridge v7 adds attempts/next_retry_at to its
existing inspect receipt projection; no new send route or text is introduced.
Admin gateway is v5 with its existing JWT mode intact.

Verification: actual gateway/remark and existing combined workflow regressions,
native rollback history/ACL/filter/paging/failure recovery checks, root/Inbox and
Admin builds pass. The actual React component is rendered in cloud Chrome with
synthetic read-only transport at desktop and a 375px iframe: search, phase/state,
paging, receipt/history modal, Escape, empty/error and recovery checked. The
local Browser extension did not respond; cloud browser cannot reach workspace
localhost, so a temporary credential-free synthetic preview is used and its public endpoint disabled
after QA. Real ClickUp readback confirms one unchanged AutoBrief comment ID with
the new remark, while the adopted receipt still has zero send attempts. Hosted
signed-in admin acceptance and future real deadline delivery remain separate.

Production delivery: commit `60950cbd7a5def9daa4b747d5c735db0bafea3b4` passed Workers build `71d2e99b-3ca6-4576-a491-866202ba93cd`. The exact hosted log URL renders its Admin V2 login gate; signed-in acceptance remains pending. Native log counts stay unchanged across subsequent routine polls.

## Complete multiline Buyer Note — 3 November 2026

Worker v49 can confirm an explicit name plus age in a multiline Buyer Note at
88% without assigning ambiguous linked-chat evidence to that wording. Real line
breaks and escaped newline sequences are accepted. This requires a fresh exact
provider order read, paid/fulfillable state, one quantity-one product with a
verified product ID and one exact task, no substantive inbound reply, no
name/age conflict and no different staff wording. Missing age/name, multiple
products/quantities, unavailable/truncated context and customer images/questions
retain review. The original context state remains in the audit alongside
`complete_note_rule`; this is independent note evidence, not verified chat.
Existing placement/status/staff and send-idempotency gates are preserved.

Actual combined Order/Inbox handler tests prove 88%, Confirmed/Ai Check and zero
sends for ordinary/escaped/labelled multiline notes, stable replay and denied
staff/reply conflicts. Product tests cover incomplete notes, multiple items,
quantities, unknown product/context and conflicting age. Live outcome evidence
is recorded in the scoped roadmap checker run.


## Order card before first detail request — 3 November 2026

Inbox bridge v8 sends the native `order` card for the exact provider order before
its first fixed text. A separate private `order_card` receipt shares the existing
shop/order/phase claim ledger. The first text claim requires a provider-confirmed
card for that buyer/order. Card failures, pending claims and uncertain responses
hold the text; a later exact card in provider history reconciles uncertainty
without another send. Cards for other orders never satisfy this prerequisite.
After card acceptance the bridge re-reads order/chat and target product, so a
new customer reply, Buyer Note or fulfillment change stops the detail request.
The deadline notice remains a separate once-only phase, without another card.

Existing matching first texts are adopted before considering a new card. Already
sent/manual first receipts do not trigger historical card backfills. Exhausted
first-text attempts with the specific `first_chat_without_order_info` rejection
receive at most one additional claim after a confirmed card and existing backoff;
other exhausted failures and unknown outcomes retain their existing protections.
No historical receipt is reset. Review customer becomes `follow up1` only after
the text receipt, never from card acceptance alone.

Order worker v50 includes the card receipt in the private follow-up snapshot and
stable AutoBrief remark, with MYT time and separate text/deadline status. Existing
Admin log event snapshots retain it alongside the comment remark. Authentication,
RLS, eligibility, staff fields and the 14:00 MYT hb policy are preserved.

Verification: the combined actual-handler suite proves card→text order,
concurrent/repeated calls, card failure/lost response/missing ID, exact-order
history reconciliation, customer reply between sends, no premature follow up1,
CF/default/reply protection and a single stable comment. Native rollback tests
prove card-gated text claims, independent receipts, private ACL and bounded
first-chat recovery. Deployed v8 adopted the existing real card/text IDs with
zero additional attempts. Future fresh autonomous provider delivery and the
previously pending full media/hosted operator acceptance remain separate.
