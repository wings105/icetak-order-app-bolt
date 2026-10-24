# iCetak System

Production repository for the iCetak / DecoCake order, payment, production, customer portal and operations ecosystem.

## Start here

For coding agents and maintainers, read `AGENTS.md` first.

The production branch is `production`. Do not assume `main` represents the current live system.

## Product Roadmap — work tracking and release history

- [Live Roadmap](https://shop.decocake.my/roadmap/) — public/approved feature status, owner-reviewed planning and acceptance checklists.
- [Roadmap Owner](https://shop.decocake.my/roadmap/?manage=1) — add ideas, edit summaries, priority, private/public visibility, progress and Markdown references.
- [Roadmap documentation index](docs/roadmap/README.md) — where to find the full feature specifications, 71-topic baseline, process and safety rules.
- [25 Oct 2026 — Shipping/Finance full discussion and Daily WhatsApp Report plan](docs/roadmap/ICETAK_SHIPPING_FINANCE_DAILY_REPORT_2026-10-25.md) — documented decisions, verified Supabase data, margin caveats and implementation checklist (IC-072–IC-074).
- [Master plan](docs/roadmap/ROADMAP_MASTER_PLAN_2026.md) and [release-coverage contracts](docs/roadmap/RELEASE_COVERAGE_2026.md) — feature-level scopes, current caveats and definition of done.
- [CHANGELOG.md](CHANGELOG.md) — verified production release history. Its tagged entries automatically appear in the roadmap Changelog tab **after a production build**; this does not auto-complete roadmap feature status.

For new work: record the intent and acceptance criteria in Roadmap, implement with subsystem docs, verify affected surfaces, then write the release evidence in CHANGELOG. Use branch `production` as source of truth.

## Main areas

- `src/` — customer-facing storefront / customer order portal code
- `public/` — customer/admin support pages and static assets
- `icetak-admin/` — Admin V2 application
- `supabase/` — Order System migrations, tests and Edge Functions
- `backend/` — backend integration/runtime helpers
- `scripts/` — regression checks, smoke checks and maintenance scripts
- `docs/` — architecture and subsystem documentation

## Backend topology

The ecosystem uses two live Supabase projects with different responsibilities:

- `icetak-order-system` (`buivecgahhmrhlmfujgt`) — canonical transactional/order backend
- `icetak-unified-inbox` (`uujcqcsfghqkukaydruc`) — conversation/inbox ingestion and chat-driven extraction backend

See `docs/ARCHITECTURE.md` and `docs/PRODUCTION_STATE.md` before backend work.

## Important documents

- `AGENTS.md` — mandatory operating instructions for AI/coding agents
- `docs/ARCHITECTURE.md` — ecosystem map and boundaries
- `docs/PRODUCTION_STATE.md` — current production snapshot and verification rules
- `docs/DECISIONS.md` — architecture decisions that should not be casually reversed
- `docs/DEPLOYMENT_RUNBOOK.md` — safe change/deploy workflow
- `CHANGELOG.md` — meaningful production-facing changes

Subsystem documentation under `docs/` remains authoritative for its own detailed contracts unless contradicted by newer live production state.

### Daily Business Report

Admin V2 → Daily Business Report: `https://shop.decocake.my/?admin=v2&view=daily-business-report`.
Internal Supabase scheduler checks every five minutes, queues yesterday's report at 08:30 MYT, and sends through WasapFlow to the configured admin. See [operations and metric definitions](docs/DAILY_BUSINESS_REPORT.md).
