# iCetak System

Production repository for the iCetak / DecoCake order, payment, production, customer portal and operations ecosystem.

## Start here

For coding agents and maintainers, read `AGENTS.md` first.

The production branch is `production`. Do not assume `main` represents the current live system.

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
