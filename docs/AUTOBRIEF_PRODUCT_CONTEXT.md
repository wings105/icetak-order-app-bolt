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
