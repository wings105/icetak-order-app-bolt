# Draft AI Feedback V14

Production upgrade applied 2026-08-15 MYT.

## Why

Recent admin-confirmed drafts showed two recurring extraction failures:

- Long-running WhatsApp conversations let old product words contaminate a new manual/pickup draft.
- Seller variation quotes such as `2pcs A4 rm48` were not bound to the active product unless the product name appeared on the same line.

ClickUp production outbox also had a second, independent initial-status rule inside the Edge Function, creating drift from the Order System status rules.

## V14 draft feedback contract

The Order System normalizer now records `worker_version = qrpay-ai-draft-v14-confirmed-feedback` and applies these verified rules before a draft is persisted:

- Generic chat/pickup triggers use the latest conversation segment after a large message gap rather than old order discussion in the same open conversation.
- `pickup_trigger` is authoritative for Pickup.
- Latest explicit courier statement wins for other sources.
- Seller quantity/variation quotes can bind to the only active item even without repeating the product name.
- Dimension text such as `11x7.5` is treated as orientation evidence, not automatically as Quick Order size.
- Quick Order size/style is normalized before price calculation.
- Price always uses the canonical `icetak_quick_order_price` matrix after variation binding.
- Wording noise such as `1set` is rejected; explicit wording/change-to text is preferred.
- Natural Date Need parser supports numeric dates, Malay/English month names, `hb`, `esok/tomorrow`, `lusa`, and Malay/English weekdays.
- Address extraction stays inside current/frozen order evidence and strips contact-phone lines before postcode detection.

## Confirmed regression checks

### IC260814-3550

Old AI: Edible / 5 inch / Round / RM12 / `1set` / unknown delivery / no date.

V14: Cake Topper / Pre-order / Need Review / 1 pc / Custom Name / RM10 / `HBD SPIDERBOY EHSAN` / Pickup / 2026-08-17.

This matches the admin-confirmed structural order fields and additionally recovers the explicit wording from the latest customer message.

### IC260814-9010

Seller evidence contained `2pcs A4 rm48`, SPX RM4.50, total RM52.50.

Old AI: Edible qty 1 / `11x7.5` / RM6 / Round.

V14: Edible qty 2 / A4 / Full Landscape / RM24 each / SPX RM4.50. Reconciled total: RM52.50.

### IC260814-1495

V14 keeps the earlier fixed regression: Edible / 5 inch / Round / RM12 / explicit wording, and correctly extracts the address postcode/city without treating the customer phone as postcode.

## Learning rules

Verified correction strategies were promoted from candidate to active:

- `date_from_latest_customer_need`
- `variation_from_nearest_item_context`
- `price_from_quick_order_variation`
- `price_from_latest_explicit_seller_quote`
- `preserve_distinct_products`
- `wording_from_explicit_label`
- `shipping_from_latest_explicit_quote`
- `shipping_from_quick_order_delivery`
- `qty_from_nearest_explicit_item_count`

Customer-identity inference and generic human-override rules remain candidates because they are not safe to auto-apply.

## Canonical ClickUp status V3

`icetak_clickup_initial_status_v2` remains the single initial-status resolver and validates every result against active `clickup_status_mapping` rows.

Current canonical behavior:

- Printed editing / review -> `design editing -topper`
- Printed new design -> `new custom`
- Printed no review -> `design editing -topper`
- Edible -> `design edible image`
- Wafer -> `wafer paper`
- Acrylic and Mirror Gold -> `acrylic`
- Burn Away -> two production components:
  - Edible Layer -> `design edible image`
  - Wafer Layer -> `wafer paper`
- Unknown products -> `design editing -topper`

Burn Away is modeled as one order item with two production components. The resolver uses the actual component type/label, so the parent `burnaway` product cannot force both components into the edible status.

`clickup-production-outbox` no longer keeps its own product/status decision tree. Each component receives:

- `initial_clickup_status` from the DB resolver
- `status_source = icetak_clickup_initial_status_v2`
- `process`
- `review`
- `reference_url`
- `due_date`
- expanded `task_description`

AP remains a transport layer and can continue reading `components[0].initial_clickup_status`. Multi-component orders are intentionally processed one component per AP run; the callback returns the outbox to retry until all components are linked.

## Admin WhatsApp after ClickUp tasks are ready

The final admin notification is sent only after all production components have ClickUp task IDs. It now includes separate links for:

- `Admin / Edit Order` -> admin v2 order page
- `Customer Order Link` -> customer-facing order page
- `WhatsApp Customer` -> direct customer chat
- ClickUp task link(s)

This prevents the admin notification from exposing only the admin page when the customer-facing order link is needed for forwarding or review.

## Production migrations

- `20260814174702 draft_ai_feedback_v14_and_canonical_clickup_status`
- `20260814174854 draft_ai_v14_address_cleanup`
- `20260814175031 activate_verified_draft_learning_rules_v14`
- `20260814175121 lock_internal_ai_v14_helpers`
- `20260814222915 clickup_status_rules_v3_burnaway_dual_component`

## Runtime ownership note

The `qrpay-ai-order-worker` function stored in this repository is currently a proxy/bridge to the worker deployed in the external Supabase project `uujcqcsfghqkukaydruc`. The actual V14 extraction implementation is therefore not fully reconstructable from this repository alone. Treat the external worker as a runtime dependency until its implementation is also mirrored into source control.
