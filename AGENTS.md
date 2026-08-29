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
4. `docs/VERIFICATION_PROTOCOL.md`
5. The subsystem-specific document for the requested work
6. Relevant source files, latest migrations and live Supabase state
7. `docs/DECISIONS.md` before changing architecture
8. `docs/DEPLOYMENT_RUNBOOK.md` before deployment/backend changes

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

## Work status: ATTEMPTED -> VERIFIED -> PRODUCTION

Every agent must use these meanings consistently.

### ATTEMPTED

Code/configuration was changed, but the requested behavior has not been proven on the affected surface.

- Do not say `done`, `fixed`, `working`, `live`, or equivalent.
- Build/lint/typecheck success does not promote a change to VERIFIED.
- A code diff that looks correct does not promote a change to VERIFIED.
- Do not add the change to `CHANGELOG.md` as completed.
- Report it as `implemented, not yet verified` or `attempted`.

### VERIFIED

The requested behavior was tested on the actual affected surface, or on the closest valid controlled environment, with observable evidence.

Examples:

- UI: the rendered page/component was opened and the requested visual/interaction change was observed.
- Backend/API: the relevant request was executed and the resulting response plus persisted/audit state were checked.
- Database: the intended schema/data effect was queried after the change.
- Edge Function: the deployed/target function version was checked and a safe smoke test validated the resulting state, not only HTTP 200.
- Automation/integration: a controlled event proved the expected downstream state without duplicate or unintended effects.

A VERIFIED item may be recorded in `CHANGELOG.md` with `[VERIFIED]` if it is a meaningful production-facing change awaiting final production confirmation.

### PRODUCTION

The intended change is merged/deployed to the production source/runtime and the affected production surface has been smoke-checked successfully.

A meaningful completed release should be recorded in `CHANGELOG.md` as `[PRODUCTION]`.

## Verification truth rules

- Never manufacture verification evidence from reasoning alone.
- Never treat a successful commit, merge, build, deployment command, HTTP 200, or migration execution as proof that the user's requested outcome works.
- Verification must test the outcome the user actually asked for.
- If tools/access do not allow actual verification, say so and keep the status ATTEMPTED.
- If the user reports that the change is not visible or does not work, that report overrides any earlier completion claim. Reclassify the work as ATTEMPTED/FAILED until it is re-investigated and re-verified.
- Do not repeatedly apply the same patch after a failed user check without first investigating source-of-truth, deployed commit/ref, build/deploy pipeline, routing, cache, feature flags, selectors, or other reasons the change is not reaching the real surface.

Detailed rules: `docs/VERIFICATION_PROTOCOL.md`.

## Working with another AI/tool

When taking over work created by another agent:

1. Pull/read latest `production` state.
2. Inspect recent commits touching the subsystem.
3. Read the relevant docs listed in `docs/PRODUCTION_STATE.md`.
4. Read `docs/VERIFICATION_PROTOCOL.md` and distinguish attempted work from verified/live work.
5. Verify live Supabase tables/functions if backend behavior matters.
6. Treat chat memory as optional context, never as source of truth.
7. Preserve prior architectural decisions unless there is evidence they are wrong.
8. Document important new architectural decisions in `docs/DECISIONS.md`.
9. Add an entry to `CHANGELOG.md` only for meaningful changes that reached VERIFIED or PRODUCTION status.
10. Do not inherit another agent's `done` claim without evidence; re-check the affected surface when correctness matters.

## Definition of done

A change is not done merely because code was written. Depending on scope, completion should include:

- correct branch/ref
- relevant tests/check scripts
- build/type/lint checks where available
- database migration validation where applicable
- Edge Function deployment verification where applicable
- smoke test of the affected user/admin flow
- no unintended duplicate notifications/orders/payments/tasks
- evidence that the actual requested outcome is present
- production confirmation when claiming the change is live
- documentation update when architecture or operating behavior changed

If outcome verification has not happened, the correct status is ATTEMPTED, not DONE.

## Changelog rules

`CHANGELOG.md` is shared memory for future agents, not a list of optimistic implementation claims.

- Do not record failed attempts or unverified code as completed changes.
- Use `[VERIFIED]` for meaningful behavior proven before final production confirmation.
- Use `[PRODUCTION]` for meaningful behavior confirmed on production.
- If a previously recorded change is later shown not to work, correct the changelog/status rather than leaving a false success record.
- Minor formatting, typo-only or internal refactor commits do not require a changelog entry unless they materially affect behavior or operations.

## Key subsystem documentation

- Verification protocol: `docs/VERIFICATION_PROTOCOL.md`
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
