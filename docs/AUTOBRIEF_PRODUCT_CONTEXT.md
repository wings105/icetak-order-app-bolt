# AutoBrief product references and labelled wording

Order System owns `clickup-order-brief`, `clickup_order_brief_jobs` and the canonical
`marketplace_order_items` used by this workflow. Unified Inbox continues to own
chat/media evidence. This source starts from the live v40 worker, preserving its
existing authentication, scope, media, comment and field-write safeguards.

## Product context

Current order rows supply title, item/variation SKU, Shopee product/variation ID,
variation and quantity. The exact target SKU must resolve to one row. Product
title and product ID appear beside SKU in the single AutoBrief comment and are
persisted in its private job brief. Only printable customer wording enters
Customize Name. These reference fields are also sent to the existing advisory
Responses request and included in its cache signature; a title/ID change cannot
reuse analysis from the older input.

## Deterministic labelled Buyer Note

For a note such as `Theme Alpha - Sample One turns 5`, a label may be an exact
SKU, exact product ID or a complete phrase occurring in exactly one ordered
product title. The rule requires one labelled line per current order line, full
one-to-one coverage, standard glossy CN/YS SKUs, valid IDs/quantities, and a
related task for every SKU. It never assigns by array position or hardcoded
theme names. Duplicate themes/SKUs, missing coverage, instructions, conflicting
staff wording, unverified chat or a separate substantive customer reply keep
the order in review. That buyer-note rule is separate from the catalogue-backed chat rule below.

A verified match gives the exact suffix wording a rule score of 95. Existing
paid-order, 15-minute, status, missing-detail and post-confirmation guards still
apply. AI remains advisory; its confidence cannot independently confirm fields.
The worker applies only to active ORDER LIST tasks in DESIGN EDITING -TOPPER.

## Verification and release

Run `node --experimental-strip-types scripts/check-autobrief-product-context.mjs`.
This executes the real request builder and worker with controlled transports:
reordered items, title/SKU/ID labels, ambiguous/duplicate/missing labels, staff and
chat conflicts, unpaid orders, exact CF/comment/persistence, replay and auth.
Existing worker selftests and detail/readiness regressions remain applicable.

Deployment is scoped to Order System `clickup-order-brief`; preserve its existing
`verify_jwt=false` platform mode and mandatory in-code `x-order-brief-token`
validation. Never publish its runtime token. No frontend, shipping function,
database schema or notification deployment is required for this change.

## Production evidence — 2 November 2026

The product-context release is active in worker v42 (v41 behavior, normalized
source ending). Source readback matches the tested file. Authenticated runtime
status and the existing selftest pass. An owner-scoped three-item real order
produced separate correct wording, 95% deterministic confidence, Confirmed and
Ai Check; original AutoBrief comment IDs were retained. Exact ClickUp custom
fields and comment bodies were read back, alongside persisted product references.
A transient context read correctly held one item for review and a subsequent
successful read completed it. The same live AI preview, now including product
titles/IDs, independently assigned the target wording at 98%; this remains an
advisory result rather than write authority. No customer chat send, payment,
shipping change or new task was involved. Full product-card sequence matching,
multi-item chat reassignment and later media-change acceptance remain separate.


## Catalogue-backed product-card chat — 5 November 2026

The worker retains exact-session inbound `[Shopee item: ID]` references as
product evidence. It reads `product_channel_listings` by exact Shopee shop/item
identity and joins canonical `products` for title and parent SKU. The catalogue
must agree with the ordered product ID and task SKU; array position is never a
mapping key. Website publication status does not determine catalogue identity.
No catalogue records are changed.

For distinct glossy items with quantity one, a product card scopes the following
bounded name and separate age line. An explicit `Yg <unique title phrase> tulis
<wording>` selects that ordered product even before its next card. Every ordered
item must have an unambiguous wording and sibling task. Unknown cards, duplicate
identities, incomplete coverage, unsupported media, conflicts, nonempty buyer
notes, staff wording differences and unavailable/truncated/ambiguous context
remain in review. Existing paid/time/initial-status/confirmation guards remain.
This is deterministic association, not AI authority or unrestricted chat inference.

An accepted match scores 95 and persists item ID, canonical catalogue ID, title,
assignments and source messages in `product_card_rule`. Each original AutoBrief
comment shows its own card ID/title and wording proof with MYT timestamps; cards
are no longer rendered as unexplained images. Printable wording alone enters
Customize Name; Ai Check and Confirmed follow the existing verified-field path.

Verification: `node scripts/check-autobrief-product-card.mjs` executes the actual
parser, catalogue loader and worker for two distinct synthetic designs, including
provider merge of a card represented as an empty image. Catalogue/coverage,
staff/context/media guards, replay and zero-send checks pass. The same suite
passes against the live source with its initial-status lifecycle. Existing
product-context and explicit-wording regressions pass. Live v71 recovered both
owner-selected items at 95%; ClickUp API readback verified exact wording, Ai
Check, Confirmed, original comment IDs and item-specific proof. No customer send.
Concurrent live acrylic and lifecycle modules were retained unchanged; this
release's repository diff contains only the scoped glossy matching change.


## Explicit shared name and age notes — 5 November 2026

A three-line Buyer Note containing labelled name, labelled numeric age and an
explicit all-topper scope is parsed into separate printable wording and
production instruction. For example `Nama: Sample Child`, `Umur: 5`,
`Dua2 topper sama nama & umur` yields `Sample Child 5`; the scope sentence never
enters printable wording. Two/both must agree with total ordered quantity;
all/semua covers the verified glossy order. SKU/product IDs, task mapping,
quantity, context, later chat and staff-conflict guards remain mandatory.
The existing raw note copied into Customize Name may be cleaned only when it
exactly matches the source note; a different staff value remains protected.

The bounded source rule scores 95, bypassing only the generic multi-item cap.
Payment, lifecycle/initial status, time and unresolved-detail gates remain.
AI model confidence alone still cannot promote arbitrary content to confirmed.
Existing cached analysis is signature-checked against the current inputs.

Each initial brief now includes `Ringkasan bacaan & pemahaman AI / AutoBrief`:
source, product/message counts, extracted name and age where verified, shared
instruction, printable wording and confirmation/review result. Current model
summary/confidence appears when its input signature is checked that run.
`reading_summary` and `shared_name_age_rule` persist private provenance beside
full Buyer Note and existing proof, without creating another comment.

Validation command: `node scripts/check-autobrief-shared-name-age.mjs`.
The actual worker suite exercises both task outcomes, raw-note CF cleanup,
model summary display, replay/no sends, and malformed, staff/context/media,
quantity and scope guards. It also supports a deployed-source file argument
for exercising the concurrent lifecycle implementation without replacing it.

Production evidence: worker v72 source patch preserves all concurrent lifecycle
and acrylic modules. Exact selected two-task canaries complete without errors;
direct ClickUp reads verify clean shared wording, 95%, Ai Check, Confirmed and
unchanged comment IDs. Both comments contain the source/understanding summary
and current-input AI interpretation at 98%. No customer-send receipts created.


## Unlabelled custom-name chat — 6 November 2026

For one verified CUSTOM NAME glossy topper and one matching task, a plain
customer name is printable custom text without a Nama/Custom Name label. An
optional separate numeric age must follow the name in the same conversation
within 15 minutes. Real/escaped multiline messages and identical repeated names
and ages are accepted; distinct names/ages, logistics/instructions, unsupported
media, unverified scope, staff differences or multiple items remain in review.
Current-session, payment, initial-status and confirmed-task lifecycle guards stay.
The deterministic source rule scores90; no model-confidence promotion is needed.
An original Shopee order-card marker is preserved across provider merges so it
is not mistaken for an unnamed image. Name/age proof and the source understanding
summary are retained in the existing original AutoBrief comment and private job.

Actual worker tests: `node scripts/check-autobrief-bare-name.mjs` exercises name
only, separate age, lowercase, multiline, duplicate/conflict, session/media/staff,
logistics/scope, exact CF/comment outcome, no sends and baseline replay. The same
suite passes against live lifecycle source; existing card/shared-note/explicit
wording/product-context suites pass. Deployed v73 exact selected-task recovery
and ClickUp readback verify clean wording90%, Ai Check, Confirmed and original
comment identity with reading summary. Other live modules remain byte-identical.


## One name defaults across two custom sets — 7 November 2026

Owner policy: when a two-unit glossy order supplies one unambiguous name in Buyer
Note or exact-session chat, use it for both CUSTOM NAME sets unless another
instruction distinguishes the items. No explicit same-name sentence is needed.
One SKU with quantity two and two distinct custom SKUs are supported. An order
with one custom and one ready-stock item applies the text only to the custom
item; a ready-stock target cannot enter this path. Product IDs, standard glossy
SKUs, quantities, unique custom task mapping and current context are mandatory.

Buyer Note labels are decoded and cleaned for interpretation; source chat proof
retains its original text. A shared optional age is accepted, including `6y`.
Different names/ages, item-specific instructions, additional unsupported detail,
media, staff differences, unknown scope or missing mappings do not use the
assumption. Existing catalogue-specific matching remains authoritative. Current
payment, initial-status, confirmation lock and unresolved-detail guards remain.

The bounded rule scores92 and stores `two_custom_name_rule`; its instruction and
reading summary explicitly state the default assumption and its custom-item
scope. AI confidence is not used to override conflicting customer evidence.

Run `node scripts/check-autobrief-two-custom-name.mjs`: actual worker tests cover
both custom task outcomes, note/chat/labels, quantity-two, ready-stock exclusion,
conflicts/instructions/staff/context, no sends and baseline replay. The same
suite passes on live lifecycle source; prior relevant regressions also pass.

Production verification: live v74 exact-task canary recovered the only current
eligible blocked two-unit order (one custom plus one ready-stock product).
Direct ClickUp readback confirms the custom task's correct name/age92%, Ai Check,
Confirmed and stable original comment with scope summary; ready stock remains
unchanged and no customer send occurs. v75 additionally deduplicates multiline
proof by message ID; actual baseline/live tests and exact native comment cleanup
readback verify one source proof while preserving rich formatting. Two-custom
set association is proven by controlled actual-worker tests for both task paths;
no current unconfirmed two-custom order was available for a live two-task run.
Concurrent lifecycle/acrylic modules are preserved unchanged.


## AI confirmation grounded in customer evidence — 7 November 2026

Owner-authorized AI confidence >=90 can promote a low-confidence initial glossy
brief only when its input signature is checked against the current order/chat.
The current active provider order must have one CUSTOM NAME product, quantity
one and one matching task. AI needs_review must be false; target SKU must match,
all cited IDs must belong to verified inbound session evidence, and the latest
explicit customer wording message must be cited. Model wording must exactly
match that source; printable punctuation and capitalization come from customer.

Earlier punctuation-only variants do not create a semantic conflict. Different
names/ages remain held unless an explicit latest correction already scopes the
source; age conflicts, later changes, staff or buyer-note differences, unresolved
details, ambiguous/truncated/unavailable context and multi-item targets are held.
A model score alone never supplies missing authority. Payment, initial-status,
confirmation locking and post-confirmation observation remain unchanged.

The existing initial comment records AI confirmation, score, latest source time,
full proof and reading summary. Layout reference requests and requested arrival
dates are separate instructions, with arrival described as a customer request.
`ai_confirmation_rule` records provenance and `ai_mode=evidence_confirm`; other
model results remain advisory. Image links/backups and media warnings remain.

Run `node scripts/check-autobrief-ai-confirm.mjs`. Actual baseline/live worker
checks cover score/current-input/evidence/latest/SKU/name-age/staff/note/context/
quantity/later-change guards, CF/comment/instruction outcome, no sends and replay.

Production evidence: worker v76 matches the tested source and preserves all live
acrylic/lifecycle modules. Exact selected-task canary completes in evidence_confirm
mode at94%; direct ClickUp reads verify exact latest punctuation, Customize Name,
Ai Check, Confirmed, original comment identity, both existing media references
and separate layout/arrival-request instructions. No customer send receipts.
This releases initial brief confirmation, not a promise of delivery or design QC.
