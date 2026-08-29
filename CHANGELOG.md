# Changelog

This file is reliable shared memory for meaningful production-facing or architecture-level changes. It is not intended to mirror every commit or every coding attempt.

## Status policy

Only record a change here when it has reached one of these evidence levels:

- `[VERIFIED]` — the requested outcome has been tested and observed, but final production confirmation is not yet established.
- `[PRODUCTION]` — the change is in the production source/runtime and the requested outcome has been smoke-checked successfully on production.

Do **not** record speculative fixes, code-only attempts, failed verification, or changes the user reports as still not working as completed items. Those belong in commits/PR handoff notes until they are proven.

If a previously recorded success is later disproved, correct its status/entry rather than preserving a false success record.

See `docs/VERIFICATION_PROTOCOL.md`.

## 2026-08-30 — [PRODUCTION] Evidence-based completion and AI handoff policy

- Added the mandatory `ATTEMPTED -> VERIFIED -> PRODUCTION` work-status model for all coding agents.
- Agents may no longer claim `done`, `fixed`, `working` or `live` from a code edit/build/merge alone.
- Added outcome-specific verification rules for UI, backend, database, payments, WhatsApp, ClickUp and deployment work.
- Added explicit handling for cases where the user checks the real system and reports that a claimed change is absent or broken: the work returns to ATTEMPTED/FAILED until re-verified.
- Added a troubleshooting order for source/deploy/cache/route/runtime mismatches before repeating arbitrary patches.
- Changelog entries are now reserved for meaningful VERIFIED or PRODUCTION outcomes; failed attempts remain in Git/PR handoff history.
- Added a non-blocking PR documentation reminder so missing verification/changelog review is surfaced as a warning rather than preventing work.
- No application logic, database schema, Edge Function behavior or live business workflow is changed by this policy release.

## 2026-08-29 — [PRODUCTION] AI portability / project memory

- Added repository-level `AGENTS.md` as the mandatory entry point for coding agents.
- Added ecosystem architecture documentation covering customer app, Admin V2, Order System, Unified Inbox, ClickUp, WhatsApp, QRPay, payments and shipping.
- Recorded the two live Supabase project boundaries so agents do not modify the wrong backend.
- Recorded `production` as the live code reference and documented that `main` must not be assumed equivalent.
- Added architecture decisions for draft-first order creation, order-session boundaries, fail-closed payment matching, WhatsApp guardrails and integration ownership.
- Added a deployment/change runbook and cross-AI handoff procedure.
- No application logic, database schema or live function behavior changed in this documentation release.

## 2026-08-27 — Customer tracking display

- Production customer tracking UI improved courier label visibility.

## 2026-08-26 — QRPay and WhatsApp safety hardening

- QRPay unmatched payment reconciliation hardened to fail closed rather than force an uncertain match.
- Per-order WhatsApp opt-out behavior hardened for automatic sends.

## 2026-08-24 to 2026-08-26 — Pickup / tracking controls

- Pickup bundle receipt/review and QRPay linkage work added.
- Per-shipment/per-order automatic tracking notification controls hardened.
- SPX pickup-hold mapping preserved as in-transit behavior where intended.

## 2026-08-21 to 2026-08-22 — Session isolation, AI learning and pickup counter

- Order-session isolation and draft lifecycle boundaries introduced/hardened.
- Weekly AI learning control-center infrastructure added.
- Pickup counter bundle checkout, payment/notification and void-related backend flows added.

## 2026-08-19 to 2026-08-20 — Draft/admin and WhatsApp window operations

- Customer shop checkout/draft flows extended.
- Admin WhatsApp window monitoring added.
- Manual draft/payment flow and late QR/counter reconciliation improved.

## 2026-08-13 to 2026-08-16 — Unified draft engine and payment recovery

- Unified order sessions and draft-first lifecycle established for QRPay, chat/prepaid and pickup flows.
- Draft pricing, address validation, customer checkout and payment linking/recovery iteratively hardened.
- Shipping/payment attention paths added for operational recovery.

For exact implementation history, inspect Git commits and Supabase migration history on the relevant production system.
