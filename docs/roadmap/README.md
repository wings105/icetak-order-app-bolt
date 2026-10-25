# iCetak Roadmap — Planning, Feature Contracts & Release Evidence

**Production URL:** https://shop.decocake.my/roadmap/  
**Owner editor:** https://shop.decocake.my/roadmap/?manage=1  
**Source branch:** `production` (not `main`).

## Start here

- **AI feature checks start with [AI_CHECKER_README.md](./AI_CHECKER_README.md)**: log before inspecting, checkpoint when interrupted, finish with evidence and priority/progress; never claim the whole roadmap was checked from a small batch.
- [Owner AI Checker log](https://shop.decocake.my/roadmap/?manage=1&tab=ai-checker) — next to Changelog, private review history and per-feature before/after state.
- [Master Roadmap (IC-001–IC-041)](./ROADMAP_MASTER_PLAN_2026.md) — initial business planning, feature scope, acceptance criteria and priority.
- [Changelog Coverage (IC-042–IC-071)](./RELEASE_COVERAGE_2026.md) — additional modules discovered from repo `CHANGELOG.md` and earlier feature discussions.
- [Shipping, Pricing, Profitability & Daily Business Report — 25 Oct 2026](./ICETAK_SHIPPING_FINANCE_DAILY_REPORT_2026-10-25.md) — 727-line complete discussion and backend specification for IC-072, IC-073 and IC-074.
- [Shopee Ads API tests](./SHOPEE_ADS_API_TESTS_20261023.md) — read-only endpoint evidence, keyword examples and limitations.
- [Production CHANGELOG](../../CHANGELOG.md) — chronological **technical release evidence**, distinct from the roadmap planning statuses.
- [AGENTS.md](../../AGENTS.md) — engineering safety and required verification policy.

## Which data is authoritative?

| Record | Meaning | When updated |
|---|---|---|
| `public.icetak_roadmap_items` | Feature planning/status, summary, scope, acceptance checklist, visibility | Owner review or explicitly authorized changes |
| `public.icetak_roadmap_updates` | Human-entered progress notes by feature | Operator edits |
| `public.icetak_roadmap_ai_runs` | Latest and historical owner-only AI review sessions with scope, evidence and resume instructions | Start/checkpoint/finish RPC |
| `public.icetak_roadmap_ai_events` | Append-only start/checkpoint/end snapshots, independent of release changelog | Generated atomically by review transitions |
| `CHANGELOG.md` | Versioned evidence of production/backend/frontend releases | After verified engineering work |
| `public/roadmap-changelog.json` | **Generated build output** reflecting `CHANGELOG.md`; no DB write | Every production build |
| `docs/roadmap/*.md` and subsystem docs | Long-form specifications, caveats and acceptance conditions | During planning, testing and release |

**Important:** A production changelog entry **must not automatically mark a roadmap item Completed**. Controlled tests, hosted deployment, and real operator acceptance are distinct evidence. Use `Testing` when verification is incomplete.

## Publishing a new roadmap feature

1. Create/edit feature via Owner Roadmap (`?manage=1`) with one-line summary, key bullet points, acceptance checklist, category, priority and reference URL.
2. Choose Public only for information safe for everyone. Customer identity, internal tokens, financial details and private operational settings remain owner-only.
3. Record design/implementation in the relevant docs. Leave a blank target date unless committed.
4. On a verified release, document scope/evidence in `CHANGELOG.md` and deploy `production`.
5. Deployment regenerates `/roadmap-changelog.json`; the public Changelog tab displays the latest technical entries without manual copying.
6. Owner reviews acceptance and updates the feature status/progress separately.

## Read-only automatic release feed

The production npm build runs `node scripts/generate-roadmap-releases.mjs` before Vite. It extracts tagged release bullets from `CHANGELOG.md`, uses a deterministic topic-code mapping, and publishes a static JSON file. This is **not** a scheduled Supabase job and does not call Shopee, ClickUp, WhatsApp or payment APIs.

A newly edited changelog appears on the roadmap **after the relevant production deployment**, not at the instant a Git commit is created.

## Coverage

Baseline imported 23 October 2026: 41 initial topics plus 30 additional top-level modules = **71 original roadmap items plus 3 planned items (IC-072–IC-074) = 74 items**. The release feed indexes tagged changelog bullets independently. This is a managed inventory of known features, not a claim that every historical conversation or undocumented change is exhaustively captured.

To add missing work, create a new feature rather than editing a vaguely related feature into something different. Keep older entries for traceability.
