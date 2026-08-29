# iCetak Architecture

Last reviewed against production: 2026-08-29 MYT.

This document describes system ownership and data flow. For exact live versions/counts, verify `docs/PRODUCTION_STATE.md` and the live services.

## Ecosystem map

```text
Customers / Staff
      |
      +--> Customer Web / Order Portal -------------------+
      |                                                   |
      +--> Admin V2 --------------------------------------+----> iCetak Order System Supabase
      |                                                   |       buivecgahhmrhlmfujgt
      +--> WhatsApp / Shopee Chat --> Unified Inbox ------+           |
                                      uujcqcsfghqkukaydruc            +--> Orders / Payments
                                               |                      +--> Drafts / Order Sessions
                                               +--> extraction ------>+--> Production Components
                                               +--> triggers -------->+--> ClickUp Outbox
                                                                      +--> Shipping / Tracking
                                                                      +--> Finance / QRPay
                                                                      +--> Customer Master / CRM
                                                                                |
                                                                                +--> Activepieces / ClickUp
                                                                                +--> ParcelDaily / couriers
                                                                                +--> WasapFlow notifications
```

## 1. Customer application

Primary code lives under root `src/` and `public/`.

Responsibilities include customer browsing/order entry, order history, customer order detail, review/payment pages and tracking presentation. Customer code must not become a second admin application.

Customer-facing writes should flow through existing RPC/Edge Function contracts so server-side validation, payment rules and audit behavior are preserved.

## 2. Admin V2

Primary code: `icetak-admin/`.

Admin V2 owns operational UI for orders, draft review, payments, finance, QRPay, shipping, WhatsApp controls, pickup counter, AI learning, customers and staff/permissions.

Detailed boundary: `docs/ADMIN_V2_SOURCE_OF_TRUTH.md`.

Rule: when changing admin behavior, start in `icetak-admin/`. Root customer code is not the place for admin business logic.

## 3. Order System Supabase

Project: `icetak-order-system` / `buivecgahhmrhlmfujgt`.

This is the canonical transactional backend. Major domains include:

- customers and customer master/identifiers
- orders and order items
- payment sessions, transactions, unmatched transactions and voids
- QRPay draft store, corrections and learning rules
- order sessions and fulfillment grouping
- production components and ClickUp sync/outbox state
- shipments, tracking events and notification state
- pickup checkouts/bundles/handovers
- finance and operational alerts
- marketplace/Shopee normalized records
- admin users, permissions and audit data
- runtime/integration settings

Repository source for this backend is primarily under `supabase/`.

## 4. Unified Inbox Supabase

Project: `icetak-unified-inbox` / `uujcqcsfghqkukaydruc`.

This project is conversation-centric. It owns:

- customers/identities as known by inbox channels
- conversations and messages
- WasapFlow raw webhook capture
- message media and media cache work
- tags and quick snippets
- Google contacts cache
- external order summaries linked from Order System
- conversation AI jobs/analyses and semantic triage
- Shopee chat ingest receipts/events
- message references and order links
- chat-trigger endpoints that collect current-session evidence for order drafting

It does not replace the Order System as the canonical order/payment database.

## 5. Draft-first order creation

Current principle for AI/chat/payment-assisted flows:

```text
signal
  -> resolve customer/conversation
  -> active Order Session
  -> gather evidence only inside current session boundary
  -> draft
  -> admin/customer confirmation according to source
  -> real canonical order
  -> production approved/queued
  -> ClickUp and fulfillment
```

Important consequences:

- A closed/converted order session is a hard history boundary.
- Seller generic snippets/catalog/courier menus must not become customer order evidence.
- QRPay payment does not justify arbitrary draft matching; uncertain matching fails closed.
- Pickup/cash orders remain real orders with explicit payment/lifecycle state, not informal side records.

Detailed contract: `docs/UNIFIED_ORDER_DRAFT_ENGINE_V1.md`.

## 6. ClickUp / production workflow

Supabase owns the order and component record. ClickUp represents production work/tasks.

The integration is designed around stable component/order IDs and idempotent outbox/callback behavior. A component should map to one ClickUp task; duplicate reconciliation must occur before creating another task.

Activepieces acts as an integration runner where configured; it is not the canonical order database.

See `docs/ACTIVEPIECES_WHATSAPP_ORDER_AND_SHIPPING_SETUP.md`.

## 7. WhatsApp / WasapFlow

WhatsApp appears in both projects:

- Unified Inbox: inbound conversation capture, media, send helpers, session/window context and trigger extraction.
- Order System: transactional notification queues, admin controls, order-specific opt-out, payment/production/shipping notifications and safety guards.

Do not bypass notification queues/guards with a new direct send path unless the design explicitly requires it. Automatic sends must respect master controls and per-order/session rules.

## 8. Payments / QRPay

Canonical payment state belongs to Order System.

The payment architecture uses explicit payment sessions/transactions and separate unmatched/attention paths. Matching logic should be conservative and idempotent. Manual recovery should create an auditable link/override rather than silently rewriting history.

## 9. Shipping / tracking

Canonical shipment records and tracking state live in Order System. ParcelDaily/courier integrations update shipment/tracking state and customer/admin surfaces consume that state.

Shipping readiness and production readiness are separate concepts. Avoid inferring one solely from the other.

## 10. Marketplace / Shopee

Raw marketplace webhook history and normalized marketplace entities live in Order System. Shopee chat ingestion also feeds Unified Inbox so conversational context can be linked without moving the order ledger out of Order System.

## 11. Documentation hierarchy

Use this hierarchy when facts conflict:

1. Live production service/database state
2. Current `production` branch source
3. Newest relevant migrations/tests
4. `docs/PRODUCTION_STATE.md`
5. Subsystem source-of-truth document
6. Older historical docs/chat context

When a lower layer is stale, update the documentation after confirming the newer state.
