# iCetak AI / Engineering Operating Guide

This file is the first document any coding agent must read before changing this repository.

## Production source of truth

- Repository: `wings105/icetak-order-app-bolt`
- Live code branch: `production`
- Do not assume `main` is current production. The branches have diverged.
- Before editing, inspect the latest `production` head and the files relevant to the requested subsystem.
- Supabase is authoritative for live backend state. Repository migrations and function source explain intended state, but live Supabase must be checked before risky backend work.

## Production Supabase projects

### Order System
- Project name: `icetak-order-system`
- Project ref: `buivecgahhmrhlmfujgt`
- Owns canonical orders, order items, payments, production components, ClickUp sync, shipping/tracking, admin backend, QRPay draft lifecycle, pickup checkout, customer master/CRM, marketplace data and operational settings.

### Unified Inbox
- Project name: `icetak-unified-inbox`
- Project ref: `uujcqcsfghqkukaydruc`
- Owns conversations/messages, WasapFlow inbox ingestion, message media, conversation AI/triage, quick snippets, Shopee chat ingestion, external order summaries and chat-driven order extraction triggers.

Do not move responsibility between these projects casually. Cross-project bridges are deliberate.

## Required reading order

1. `AGENTS.md`
2. `docs/PRODUCTION_STATE.md`
3. `docs/ARCHITECTURE.md`
4. The subsystem-specific document for the requested work
5. Relevant source files, latest migrations and live Supabase state
6. `docs/DECISIONS.md` before changing architecture
7. `docs/DEPLOYMENT_RUNBOOK.md` before deployment/backend changes

## High-level system boundaries

- Customer storefront/order portal: root `src/`, `public/`
- Admin V2: `icetak-admin/`
- Order System backend: `supabase/` plus backend integration code
- Production documentation: `docs/`
- Admin UI business logic belongs in `icetak-admin/`, not customer `src/main.ts`.
- Backend mutations should use the existing Supabase RPC/Edge Function contracts rather than bypassing them with direct client writes.

See `docs/ADMIN_V2_SOURCE_OF_TRUTH.md` for the admin boundary.

## Order lifecycle principle

The current architecture is draft-first for AI/chat/payment-assisted order creation:

`conversation/payment signal -> active order session -> draft -> review/confirmation -> real order -> production -> ClickUp -> fulfillment/shipping`

Never reuse historical chat details across a closed order-session boundary. Do not recreate legacy direct auto-order behavior unless explicitly requested and safety-reviewed.

See `docs/UNIFIED_ORDER_DRAFT_ENGINE_V1.md`.

## Safety rules for agents

- Never expose service-role keys, API tokens, webhook secrets or private runtime settings in commits, logs or documentation.
- Never disable RLS or authentication as a shortcut.
- Do not make broad schema rewrites when a targeted migration is sufficient.
- Do not delete or rewrite historical migrations.
- Preserve idempotency for payment, webhook, ClickUp and WhatsApp flows.
- Payment matching must fail closed when identity/amount evidence is ambiguous.
- WhatsApp automatic sends must respect master guards, per-order opt-out and session/window rules.
- Do not backfill historical production data unless the task explicitly requires it and impact is understood.
- Prefer reversible changes and explicit audit trails for admin/payment overrides.
- Do not create duplicate admin implementations in customer code.

## Working with another AI/tool

When taking over work created by another agent:

1. Pull/read latest `production` state.
2. Inspect recent commits touching the subsystem.
3. Read the relevant docs listed in `docs/PRODUCTION_STATE.md`.
4. Verify live Supabase tables/functions if backend behavior matters.
5. Treat chat memory as optional context, never as source of truth.
6. Preserve prior architectural decisions unless there is evidence they are wrong.
7. Document important new architectural decisions in `docs/DECISIONS.md`.
8. Add an entry to `CHANGELOG.md` for meaningful production-facing changes.

## Definition of done

A change is not done merely because code was written. Depending on scope, completion should include:

- correct branch/ref
- relevant tests/check scripts
- build/type/lint checks where available
- database migration validation where applicable
- Edge Function deployment verification where applicable
- smoke test of the affected user/admin flow
- no unintended duplicate notifications/orders/payments/tasks
- documentation update when architecture or operating behavior changed

## Key subsystem documentation

- Admin V2: `docs/ADMIN_V2_SOURCE_OF_TRUTH.md`
- Unified draft engine: `docs/UNIFIED_ORDER_DRAFT_ENGINE_V1.md`
- AI feedback/learning: `docs/DRAFT_AI_FEEDBACK_V14.md`
- QRPay draft review: `docs/QRPay_AI_DRAFT_REVIEW_V1.md`
- Quick order contract: `docs/QUICK_ORDER_DRAFT_CONTRACT_V1.md`
- Product catalog: `docs/PRODUCT_CATALOG_SUPABASE.md`
- Finance webhook: `docs/FINANCE_WEBHOOK_SETUP.md`
- Shipping agent: `docs/SHIPPING_AGENT_GUIDE.md`
- ClickUp/Activepieces: `docs/ACTIVEPIECES_WHATSAPP_ORDER_AND_SHIPPING_SETUP.md`

If a document conflicts with live production code/database, verify the newer state and update the stale document rather than blindly following it.
