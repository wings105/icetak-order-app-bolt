# iCetak Architecture Decisions

This file records decisions that future agents should understand before attempting to simplify or redesign the system.

## ADR-001 — `production` is the live code reference

Status: Active.

`main` and `production` are not equivalent. Production work must begin from the latest `production` state unless the owner explicitly chooses another branch strategy.

Why: selecting `main` can omit live features and reintroduce old behavior.

## ADR-002 — Two Supabase projects have separate ownership

Status: Active.

Order System (`buivecgahhmrhlmfujgt`) owns canonical transactional/order state. Unified Inbox (`uujcqcsfghqkukaydruc`) owns conversation/inbox state and chat extraction context.

Why: conversation ingestion and canonical order/accounting lifecycles have different concerns, volumes and integration surfaces. Cross-project bridges are deliberate.

Do not copy the whole order ledger into Unified Inbox or make Unified Inbox the payment authority without an explicit migration plan.

## ADR-003 — Admin V2 is the only supported admin UI source

Status: Active.

Admin features belong under `icetak-admin/`. The customer app should only mount/redirect into Admin V2 where needed.

Why: duplicate admin implementations caused source-of-truth confusion and inconsistent business logic.

Reference: `docs/ADMIN_V2_SOURCE_OF_TRUTH.md`.

## ADR-004 — AI/payment/chat order creation is draft-first

Status: Active.

A payment or chat signal is not sufficient to immediately create a canonical order. The system creates/updates a draft within an active order session, then requires the appropriate confirmation path before conversion.

Why: prevents incorrect customer/order inference and makes corrections auditable.

Reference: `docs/UNIFIED_ORDER_DRAFT_ENGINE_V1.md`.

## ADR-005 — Closed order sessions are hard context boundaries

Status: Active.

Old chat/order details must not be reused automatically after a session has closed/converted.

Why: the same customer may place multiple orders and historical chat can otherwise contaminate a new order.

## ADR-006 — Payment matching fails closed

Status: Active.

When payment identity/amount/session evidence is ambiguous, the transaction should remain unmatched/attention-required rather than being linked to a convenient draft/order.

Why: false-positive payment matching is more damaging than requiring manual reconciliation.

## ADR-007 — Production work is component-based in ClickUp

Status: Active.

Supabase owns canonical orders/components. ClickUp tasks are external production representations linked by stable webapp order/component identity.

Why: one order may produce multiple production components and retrying integrations must not create duplicates.

## ADR-008 — Integration runners are not sources of truth

Status: Active.

Activepieces and similar automation services may move data or invoke callbacks, but canonical state remains in Supabase/connected systems according to domain ownership.

Why: automations can retry, fail or be replaced; business truth must survive automation-provider changes.

## ADR-009 — WhatsApp sends require guardrails

Status: Active.

Automatic customer messages must use the established safety controls, notification/outbox behavior and per-order opt-out/session rules.

Why: direct send shortcuts can duplicate messages, violate user preference/window rules, or send stale notifications.

## ADR-010 — Shipping readiness is separate from production readiness

Status: Active.

Do not collapse production completion, shipping readiness, courier state and customer tracking into one status field.

Why: these states advance independently and are consumed by different workflows.

## ADR-011 — Migrations are append-only history

Status: Active.

Do not rewrite historical migration files to change production behavior. Add a new targeted migration and preserve rollback/audit reasoning where appropriate.

Why: live database history and repository migration history must remain traceable.

## ADR-012 — Documentation is portable project memory

Status: Active.

Important architectural knowledge must live in the repository rather than only in one AI chat/session. `AGENTS.md` is the common entry point for any coding agent.

Why: the project is intentionally able to move between Codex, Claude, Bolt or other tools without losing system context.

## Adding a new decision

Add a new ADR section when a change alters a system boundary, source of truth, security/payment rule, deployment ownership or long-lived integration contract. Include status, decision and reason. Do not record minor UI implementation choices here.
