# QRPay AI Draft Review V1

Implemented 2026-08-13 for the iCetak Order System.

## Production flow

`QRPay webhook -> immutable unmatched payment -> 3-minute QRPay AI job -> Unified Inbox WhatsApp match/extraction -> Order System draft -> admin WhatsApp review link -> admin edit/reconcile -> Confirm -> real order + linked payment + production components + ClickUp outbox`.

The core safety rule is **Draft != Order**. Before admin confirmation there must be no real order number, no sales order, no `payment_transactions` allocation, no production release, and no ClickUp create outbox.

## Admin draft review

Edge Function: `qrpay-draft-review`.

The review page shows the immutable QRPay amount/transaction/time and an editable order reconstruction: customer, WhatsApp, Date Need, multiple items, product type, title/theme, qty, unit price, size, style, wording, shipping/pickup and address. Admin can add/remove items, save, mark wrong customer/rematch, reject as not-an-order, or Confirm.

Confirmation is server-blocked unless:

- at least one item exists;
- a valid Malaysia customer phone exists;
- Date Need exists;
- shipping is explicitly Pickup/SPX/J&T/Ninja Van;
- courier orders have an address; and
- item subtotal + shipping equals the immutable payment amount to the cent.

Only `icetak_confirm_qrpay_order_draft` creates the actual order and calls `enqueue_clickup_production_order`.

## Audit and learning

Every draft preserves:

- immutable payment/webhook snapshot;
- conversation evidence and message IDs;
- original AI draft;
- every admin save/confirm event;
- final human-confirmed payload;
- field-level AI-vs-human corrections;
- candidate learning rules and examples.

Learning is intentionally human-gated. A correction creates/increments a **candidate** rule. It does not affect later extraction until an admin presses **Activate Rule**. Active rules are returned by `icetak_qrpay_active_learning_context()` and read by `qrpay-ai-order-worker` on every run.

Current strategy keys include:

- `preserve_distinct_products`
- `price_from_latest_explicit_seller_quote`
- `qty_from_nearest_explicit_item_count`
- `wording_from_explicit_label`
- `variation_from_nearest_item_context`
- `shipping_from_latest_explicit_quote`
- `date_from_latest_customer_need`
- `customer_identity_from_strong_payment_context`

## Hard auto-create cut

`qrpay-ai-order-bridge` is the safety boundary. Both `create_draft` and the legacy `create_order` action are redirected to draft creation. This prevents an older worker from bypassing admin review. An attempted legacy `order_created` status is also normalized back to `draft_created` when no real order exists.

Unknown shipping remains `unknown`; it is never silently converted to Pickup.

Pickup AI remains a separate flow and is not converted into the QRPay draft lifecycle by this change.

## Worker

Production worker identity: `qrpay-ai-draft-v9`.

The Order System cron invokes the Unified Inbox worker once per minute. There is no competing QRPay cron in Unified Inbox. The worker reads WhatsApp context, builds a draft, records evidence, uses active learning rules, and never creates the real QRPay order itself.

Important extraction changes in V1:

- explicit seller `RM` quote is preferred; no more splitting the payment amount into invented item prices;
- unresolved item price is left as 0 so reconciliation visibly fails;
- unresolved delivery is `unknown`, not Pickup;
- explicit multiline `Wording:` is extracted;
- multi-product categories are retained instead of deliberately collapsing to one product;
- Date Need and delivery are mandatory at admin confirmation.

## Production database objects

Tables:

- `qrpay_order_drafts`
- `qrpay_order_draft_events`
- `qrpay_ai_corrections`
- `qrpay_ai_learning_rules`

Core RPCs:

- `icetak_create_or_update_qrpay_draft`
- `icetak_save_qrpay_order_draft`
- `icetak_mark_qrpay_draft_needs_rematch`
- `icetak_reject_qrpay_order_draft`
- `icetak_confirm_qrpay_order_draft`
- `icetak_upsert_qrpay_learning_candidates`
- `icetak_set_qrpay_learning_rule_status`
- `icetak_qrpay_active_learning_context`

## Verification performed

Two rollback-only production DB tests were run after deployment:

1. **Draft isolation**: payment -> draft created; asserted no order, no allocated payment and no ClickUp outbox before confirmation; unmatched payment remained preserved.
2. **Admin confirm + learning**: after confirm, asserted paid/production-ready order, Date Need + delivery fee, payment audit snapshot, ClickUp create outbox, confirmed draft lock, correction record and candidate learning rule.

Both tests passed and were rolled back, so they created no test production orders or ClickUp tasks.
