# Unified Order Draft Engine V1

Production date: 2026-08-13 (MYT)

## Goal

One draft lifecycle for QRPay payments, seller/chat triggers, and pickup triggers. AI/rules prepare a draft; humans/customers confirm; only then is a real order created and production/ClickUp queued.

## Core flow

### QRPay external payment

`QRPay webhook -> QRPay AI matcher -> current Order Session only -> Draft -> Admin review/edit -> Confirm -> Real Order -> Production + ClickUp`

### Seller/chat trigger prepaid

`WhatsApp deal -> staff trigger -> current Order Session -> Draft -> Admin review/edit -> Approve & Send Customer -> Customer reviews -> exact payment session in web -> payment webhook direct-matches draft -> Real Order -> Production + ClickUp`

The clean web-payment path does not need AI to guess which customer owns the payment. The `payment_session_id` links the exact amount to the draft before payment happens.

### Pickup / Cash at Counter

`WhatsApp deal -> pickup trigger -> current Order Session -> Draft -> Admin review/edit -> Confirm Pickup Order -> Real Order (cash_counter) -> Production + ClickUp`

Legacy pickup auto-create is disabled; the old endpoint now proxies into the unified draft engine.

## Order Session boundary

A closed/converted Order Session is a hard AI extraction boundary. A new payment or trigger after a real order was created starts a new Order Session. QRPay V12 may search historical chat only inside the current open session; it cannot cross a prior closed order boundary.

This means a customer can order yesterday and order again today without yesterday's items being re-used by the new draft.

## Fulfillment / combine shipment

Order Session and fulfillment are separate concepts.

When a new order belongs to the same customer and an older order has not been handed over/shipped, Admin Draft Review may select `combine_with_order_id`.

- Both orders remain separate accounting/payment records.
- Items are not moved into the old order.
- Both orders are linked through `fulfillment_groups` / `fulfillment_group_orders`.
- Terminal shipments are not eligible to combine.

## Draft data model

Legacy table `qrpay_order_drafts` is retained as the universal draft store and now includes:

- `source_type`: `qrpay_payment`, `chat_trigger`, `pickup_trigger`, etc.
- `request_key`
- `order_session_id`
- admin review token (`qrd_...`)
- customer review token (`qrc_...`)
- `customer_status`
- admin approval timestamps
- customer confirmation/change timestamps
- `payment_required`, `payment_status`, `payment_session_id`, `payment_mode`
- parent/combine order references
- trigger/cutoff timestamps
- conversion/order references

`order_sessions` tracks open/closed order boundaries.

`fulfillment_groups` and `fulfillment_group_orders` track ship-together grouping without merging orders.

## Payment behavior

Draft checkout creates a reserved exact-amount `payment_sessions` record before payment.

`icetak_payment_webhook` now supports direct draft matching:

1. exact pending payment session amount matches;
2. payment session becomes `matched`;
3. payment transaction is recorded against the draft session;
4. draft becomes paid;
5. if Admin + Customer already confirmed, the draft is finalized immediately;
6. payment transaction is attached to the newly-created real order;
7. production and ClickUp outbox are queued.

Existing normal-order payment-session behavior remains supported.

## Admin review behavior

Admin page source-aware actions:

- QRPay already paid: `Confirm & Create Order`
- Pickup cash: `Confirm Pickup Order`
- Chat prepaid: `Approve & Send Customer`

Admin can edit/add/remove items, quantity, unit price, size, style, wording, customer/address/date/shipping and optional combine shipment.

AI original snapshot is immutable. Human changes are stored as correction records and candidate learning rules.

## Learning

Flow:

`AI original -> Human final -> field diff -> correction log -> candidate learning rule`

Candidate rules are not automatically activated. Admin activation remains required.

Examples include:

- preserve distinct products
- latest explicit seller price
- nearest explicit quantity
- explicit wording label
- nearest size/style context
- latest explicit shipping quote
- latest required date

## Customer review / payment

GitHub source: `public/order-review.html`.

Customer sees only the admin-approved order, not internal AI evidence/audit data. Customer can:

- review items/qty/price/wording;
- edit contact/address only;
- Confirm Order;
- Request Correction;
- generate/see exact reserved payment amount;
- scan the historical seller QRPay asset inside the page;
- wait for automatic payment webhook detection;
- see the real Order No after conversion.

Customer Request Correction sends an admin WhatsApp alert and stops payment flow until reviewed.

### Deployment safety flag

`private_runtime_settings.draft_customer_web_enabled`

Current production value at documentation time: **false**.

`approve_customer` and `resend_customer` are server-blocked while this flag is false. This prevents WhatsApp sending a broken customer link while the Bolt frontend build is not yet published.

Enable only after both checks pass:

- `https://icetak.bolt.host/qrpay-draft.html` contains the new source-aware admin UI.
- `https://icetak.bolt.host/order-review.html` returns HTTP 200 with the customer review UI.

## AI provider state

`order-draft-trigger` supports OpenAI + heuristic extraction, but generative OpenAI is optional and requires server setting `openai_api_key`.

At documentation time no server OpenAI API key exists in the two Supabase projects, so chat trigger currently uses deterministic heuristic extraction with mandatory Admin review. An OpenAI Platform key setup flow was opened separately; do not expose/store a key in frontend code.

QRPay V12 itself is deterministic/session-boundary extraction and remains admin-gated.

## Live Edge Functions

### Order System

- `qrpay-ai-order-bridge`
- `qrpay-draft-data`
- `qrpay-draft-review`
- `order-draft-customer`
- `admin-review-link-dispatch`
- existing payment webhook functions / production outbox functions

### Unified Inbox

- `qrpay-ai-order-worker` — `qrpay-ai-draft-v12-session-boundary`
- `order-draft-trigger`
- `order-draft-from-chat` (`verify_jwt=true` staff entry point)
- `pickup-ai-order-trigger` (unified draft proxy)
- `draft-payment-qr`

## Production migrations applied

- `20260813023555 unified_draft_sessions_customer_payment_v1`
- `20260813023804 draft_payment_webhook_direct_match_v1`
- `20260813024235 generic_draft_save_null_payment_fix`
- `20260813024348 generic_draft_learning_log_support`
- `20260813025547 draft_combine_fulfillment_save_v1`
- `20260813025815 generic_draft_finalize_fulfillment_group_fix`
- `20260813025958 draft_payment_allocator_offset_fix`
- `20260813030119 draft_payment_customer_confirmation_gate_fix`
- `unified_draft_new_fk_indexes_v1`
- `unified_draft_security_lockdown_v1`

## Security

New session/fulfillment tables have RLS enabled.

New internal draft RPCs revoke EXECUTE from `PUBLIC`, `anon`, and `authenticated`; only `service_role` is granted EXECUTE. Customer/admin access occurs through purpose-built Edge Functions using high-entropy review tokens or staff JWT.

New foreign-key/access-path indexes were added for:

- fulfillment group order -> order
- fulfillment group -> master order
- order session -> order / parent order
- draft -> combine order / parent order
- payment transaction -> payment session

## DEV tests (transaction rollback)

No persistent dummy orders were left by these tests.

### Prepaid web flow — PASS

`chat draft -> admin approve -> customer confirm -> payment session -> simulated DuitNow webhook -> order -> payment transaction attached -> production approved -> ClickUp outbox`

Assertions included:

- draft confirmed
- draft payment paid
- Order Session converted/closed
- payment session matched
- payment transaction attached to real order
- order `payment_status=paid`
- `production_approved=true`
- `customer_confirmed=true`
- `clickup.production.create` outbox present

### Pickup cash-counter — PASS

`pickup draft -> admin approve -> admin proxy customer-confirm -> order`

Assertions:

- `payment_status=cash_counter`
- `payment_method=Cash at Counter`
- session converted
- production approved
- ClickUp outbox present

### Session boundary + combine fulfillment — PASS

Same customer Order A then Order B:

- B received a new Order Session after A closed;
- orders remained separate;
- each order retained its own items;
- selecting combine shipment linked both through one fulfillment group.

### Closed-session dry run — PASS

A conversation with no messages after its prior closed order boundary returns `No messages in current order session`; old order details are not reused.

### QRPay worker / bridge smoke — PASS

- QRPay V12 worker returns HTTP 200.
- compact Order System bridge returns HTTP 200 for `learning_context`.

## Current external deployment blocker

Backend is live and tested. GitHub frontend source is complete, but the Bolt/Netlify deployment is not auto-connected to GitHub in this environment.

Latest verification at 2026-08-13 MYT:

- `/qrpay-draft.html`: HTTP 200 but still old deployed build.
- `/order-review.html`: HTTP 404.

The repo contains no deploy hook/Netlify credential and the available connected tools cannot press Bolt's Publish action. Therefore customer web sending remains intentionally disabled by `draft_customer_web_enabled=false` until the new Bolt build is manually published and verified.
