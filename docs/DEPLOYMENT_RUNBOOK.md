# iCetak Deployment & Change Runbook

Use this runbook before deploying or making backend changes. Exact commands may evolve; current repository scripts/workflows should be inspected before execution.

## 1. Establish the correct baseline

1. Confirm the request and affected subsystem.
2. Read `AGENTS.md` and the relevant subsystem docs.
3. Fetch the latest `production` head.
4. Inspect recent production commits touching the same area.
5. If backend behavior is involved, inspect live Supabase state for the correct project.

Never start a production fix from `main` merely because it is the default branch.

## 2. Choose the correct backend

Use Order System (`buivecgahhmrhlmfujgt`) for canonical order/payment/admin/production/shipping/finance state.

Use Unified Inbox (`uujcqcsfghqkukaydruc`) for conversation/message/WasapFlow inbox/triage/chat evidence behavior.

For cross-project behavior, document both sides of the contract and preserve idempotency.

## 3. Make the smallest safe change

- Prefer targeted UI/source edits over rewrites.
- Prefer a new migration over modifying old migration history.
- Reuse existing RPCs/Edge Functions and queues when they already own the behavior.
- Do not bypass payment, WhatsApp, ClickUp or session safety gates.
- Avoid unrelated refactors in emergency fixes.

## 4. Database changes

Before applying a migration:

- identify tables/functions/triggers/indexes touched
- understand existing production rows and constraints
- check whether an equivalent migration already ran live
- preserve RLS and least privilege
- make data backfills explicit and bounded
- make retry behavior safe/idempotent

After applying:

- verify the migration exists in live migration history
- query the affected schema/function state
- run the relevant smoke/regression flow
- confirm no unintended historical rows were modified

## 5. Edge Function changes

Before deploy:

- inspect the currently deployed function and repository source
- preserve auth mode unless intentionally changing it
- check required environment/runtime settings without printing secrets
- preserve webhook idempotency and validation

After deploy:

- confirm the new function version is active
- run a non-destructive smoke test where possible
- inspect resulting database/audit state, not only HTTP status

## 6. Frontend/Admin changes

For customer app changes:

- keep admin business logic out of root customer code
- verify customer order/review/payment/tracking paths affected

For Admin V2 changes:

- start in `icetak-admin/`
- preserve permission/auth boundaries
- avoid duplicating order actions already owned by another admin page

Run relevant build/type/lint/check scripts present in `package.json`, `icetak-admin/package.json`, `scripts/` and CI workflows.

## 7. Payments / QRPay checklist

Any payment change should explicitly verify:

- exact amount/session behavior
- duplicate webhook/retry behavior
- already-paid order behavior
- unmatched/ambiguous payment behavior
- manual recovery/void behavior if relevant
- no false-positive link to unrelated draft/order

Ambiguity should fail closed.

## 8. WhatsApp checklist

Any automatic notification change should explicitly verify:

- global/master guard
- per-order opt-out where applicable
- current order/session context
- duplicate-send/idempotency behavior
- stale-order prevention
- template/free-form/window constraints where applicable
- correct recipient identity (phone vs supported channel identity such as bsuid)

## 9. Draft/session checklist

Any chat/AI order extraction change should verify:

- current order session only
- closed-session boundary
- generic seller snippets excluded
- multiple item evidence handled correctly
- customer-specific seller quotes preserved when valid
- no direct real-order creation before required review/confirmation

Recommended repository regression checks include the order-session and AI-learning scripts when those areas change.

## 10. ClickUp checklist

Any production sync change should verify:

- stable Webapp Order ID / Component ID mapping
- one ClickUp task per production component
- duplicate reconciliation before create
- outbox/callback retry is idempotent
- status mapping does not accidentally rewrite unrelated customer workflow

## 11. Shipping/tracking checklist

Verify separately:

- production ready state
- shipment creation/link state
- tracking state mapping
- courier-specific exceptions
- customer notification state
- manual tracking override/cancel behavior if relevant

Do not infer all of these from a single status.

## 12. Release documentation

For a meaningful production-facing change:

- add/update `CHANGELOG.md`
- update `docs/PRODUCTION_STATE.md` if live topology/behavior changed
- update `docs/ARCHITECTURE.md` if ownership/data flow changed
- add/update `docs/DECISIONS.md` if a long-lived architecture decision changed
- update the relevant subsystem document

## 13. Handoff to another AI/tool

Before handing off unfinished work, leave enough repository state that another tool can continue without chat history:

- branch/commit containing current work
- concise commit/PR description
- tests already run and results
- remaining known issue(s)
- any live deployment already performed
- documentation for any new contract/decision

The next agent should be able to begin with: `Read AGENTS.md, inspect latest production, then continue this branch/PR.`
