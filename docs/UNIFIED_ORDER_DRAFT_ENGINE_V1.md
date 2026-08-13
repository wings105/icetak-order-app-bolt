# Unified Order Draft Engine V1

Production date: 2026-08-13 (MYT)
Latest live verification: 2026-08-13 11:44 MYT

## Goal

One draft lifecycle for QRPay payments, seller/chat triggers, and pickup triggers. Rules/AI prepare a draft; humans/customers confirm; only then is a real order created and production/ClickUp queued.

## Core flows

### QRPay external payment

`QRPay webhook -> QRPay matcher -> current Order Session only -> Draft -> Admin review/edit -> Confirm -> Real Order -> Production + ClickUp`

### Seller/chat trigger prepaid

`WhatsApp deal -> staff trigger -> current Order Session -> Draft -> Admin review/edit -> Approve & Send Customer -> Customer review -> exact payment session in web -> payment webhook direct-matches draft -> Real Order -> Production + ClickUp`

### Pickup / Cash at Counter

`WhatsApp deal -> pickup trigger -> current Order Session -> Draft -> Admin review/edit -> Confirm Pickup Order -> Real Order (cash_counter) -> Production + ClickUp`

Legacy pickup auto-create is disabled; the old pickup endpoint proxies into the unified draft engine.

## Order Session boundary

A closed/converted Order Session is a hard extraction boundary. A new payment or trigger after a real order was created starts a new Order Session. Old order details cannot be reused across a closed boundary.

## Fulfillment / combine shipment

Order Session and fulfillment are separate concepts. A new order may be grouped for shipment with an older unshipped order via `fulfillment_groups` / `fulfillment_group_orders`, while both orders retain separate accounting, payment and item records.

## Draft store

Legacy table `qrpay_order_drafts` is retained as the universal draft store and now supports:

- `source_type`: `qrpay_payment`, `chat_trigger`, `pickup_trigger`, etc.
- `request_key`
- `order_session_id`
- admin review token (`qrd_...`)
- customer review token (`qrc_...`)
- customer/admin confirmation state
- payment state/session/mode
- combine/parent order references
- trigger/cutoff timestamps
- conversion/order references

## Payment behavior

Draft checkout reserves an exact amount in `payment_sessions` before payment. `icetak_payment_webhook` can direct-match the draft payment session, mark the draft paid, attach the transaction to the final real order and queue production/ClickUp once Admin + Customer confirmation is complete.

## Admin review behavior

Admin page source-aware actions:

- QRPay already paid: `Confirm & Create Order`
- Pickup cash: `Confirm Pickup Order`
- Chat prepaid: `Approve & Send Customer`

Admin corrections are recorded against the immutable original draft and may become candidate learning rules.

## Customer review / payment

Live frontend source: `public/order-review.html`.

Customer can review the admin-approved order, edit contact/address, Confirm Order, Request Correction, get the exact reserved payment amount, scan the seller QRPay image, wait for automatic payment detection and see the real Order No after conversion.

Customer Request Correction alerts admin and stops payment progression until the draft is reviewed again.

## Deployment safety flag

`private_runtime_settings.draft_customer_web_enabled`

Current production value: **true**.

Verified live at 2026-08-13 11:44 MYT:

- `https://icetak.bolt.host/qrpay-draft.html` -> HTTP 200, new source-aware admin UI present.
- `https://icetak.bolt.host/order-review.html` -> HTTP 200, customer Confirm Order / Request Correction UI present.
- Admin page references `qrpay-draft-review`.
- Customer page references `order-draft-customer`.
- `draft-payment-qr` -> HTTP 200 `image/jpeg`.

The previous Bolt deployment blocker is cleared. `approve_customer` and `resend_customer` are now enabled by the production flag.

## API smoke verification after enabling customer web

Fake high-entropy-format test tokens were sent only to validate endpoint routing. Both admin and customer APIs returned `draft_not_found`, confirming the feature-flag 503 guard is no longer blocking and no real draft/customer was touched.

## AI provider state

`order-draft-trigger` supports OpenAI + heuristic extraction, but generative OpenAI remains optional. Current server state: **no `openai_api_key` configured** in the Order System runtime settings, so chat trigger currently uses deterministic heuristic extraction with mandatory Admin review.

QRPay V12 remains deterministic/session-boundary extraction and admin-gated.

## Live Edge Functions

### Order System

- `qrpay-ai-order-bridge`
- `qrpay-draft-data`
- `qrpay-draft-review`
- `order-draft-customer`
- `admin-review-link-dispatch`
- existing payment webhook / production outbox functions

### Unified Inbox

- `qrpay-ai-order-worker` — `qrpay-ai-draft-v12-session-boundary`
- `order-draft-trigger`
- `order-draft-from-chat`
- `pickup-ai-order-trigger`
- `draft-payment-qr`

## Security

Session/fulfillment tables have RLS enabled. New internal draft RPCs revoke execution from `PUBLIC`, `anon` and `authenticated`; only `service_role` can execute them. Customer/admin traffic goes through purpose-built Edge Functions using review tokens or staff JWT.

## DEV tests

No persistent dummy orders were left by rollback tests.

### Prepaid web flow — PASS

`chat draft -> admin approve -> customer confirm -> payment session -> simulated DuitNow webhook -> order -> payment transaction attached -> production approved -> ClickUp outbox`

### Pickup cash-counter — PASS

`pickup draft -> admin approve -> admin proxy customer-confirm -> order`

### Session boundary + combine fulfillment — PASS

Same customer Order A then Order B produced a new session for B; both orders stayed separate and could be grouped for shipment.

### Closed-session dry run — PASS

No messages after prior closed order boundary returns `No messages in current order session`; old order details are not reused.

### QRPay worker / bridge smoke — PASS

QRPay V12 worker and Order System bridge return HTTP 200 for supported smoke paths.

## Current production state

Backend Unified Draft Engine: **LIVE**  
QRPay Draft: **LIVE**  
Pickup Draft: **LIVE**  
Order Session boundary: **LIVE**  
Combine shipment grouping: **LIVE**  
Customer review frontend: **LIVE**  
Customer payment frontend: **LIVE**  
Customer web feature flag: **ON**  
Generative OpenAI classification: **NOT CONFIGURED / OPTIONAL**
