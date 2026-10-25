# iCetak Roadmap AI Checker — mandatory operating rules

Owner instruction: 25 October 2026. Read this file **before checking any roadmap feature**.

Owner panel: https://shop.decocake.my/roadmap/?manage=1&tab=ai-checker  
Repository: `wings105/icetak-order-app-bolt`, branch `production`.  
Database: Order System `buivecgahhmrhlmfujgt`. Inbox evidence belongs to `uujcqcsfghqkukaydruc`.

## What the checker does

The checker is an operating protocol and durable audit trail for an AI invoked by the owner. Opening this tab does not launch an AI, scan every feature, call a model or create a scheduler. When the owner says “check feature X”, read its current acceptance criteria, log the start, inspect the affected system, then record the result and update that feature's evidence-based progress/priority. This owner instruction authorizes those scoped roadmap metadata updates; do not ask again. It does not authorize sending customer messages, creating provider orders, changing payments or fixing unrelated application code.

Use the connected Supabase tool or the signed-in owner form. Never put backend keys in the browser or repository. AI logs remain owner-only even when their feature is public.

## Mandatory order — start log BEFORE inspection

1. Read `AGENTS.md`, this README, `docs/VERIFICATION_PROTOCOL.md`, current production head and subsystem docs. Resolve exactly one feature UUID from the live roadmap. Read its current scope, checklist and existing review history. Looking up the item to select scope is preparation, not a completed audit.
2. Inspect its latest run and `icetak_roadmap_ai_events`. If a run is `running`, resume it. After two hours without a checkpoint it is flagged for attention, **not automatically failed or completed**. Explicitly close an abandoned run as `interrupted`, with a reason and next step, before starting another.
3. Call `start` with a new UUID, checker identity, exact scope, production ref and next step. Confirm the returned run and its `started` event exist **before inspecting feature implementation/live behavior**. Keep the run UUID for retries. Only one running review per item is allowed. Opening a card alone never records “checked”.
4. Check bounded evidence: relevant source and latest commits; live table/RPC/function/queue state where applicable; rendered UI/provider outcome when required. Read the system, not only an old changelog or another AI's “done” claim. Record what was **not** tested.
5. Save `checkpoint` after each meaningful evidence boundary, before changing tools/context, or when time is running out. Include references and a concrete next step. Do not claim a whole-board audit after inspecting a few items.
6. `finish` the run with outcome, evidence level, summary, evidence references and remaining action. Include only fields actually supported by evidence in the metadata update. This transaction updates the feature, appends a private progress note and closes the run with before/after snapshots. If there is no change, still finish and preserve the previous status/progress.
7. Read back the feature, run and end event. Tell the owner what was checked, resulting progress/priority, and remaining work. If blocked or interrupted, leave a useful handoff.

## Evidence and progress

| Value | Meaning |
|---|---|
| `not_checked` | Started/preparation only; cannot update progress |
| `source` | Source, documents or database reads; not proof of rendered/provider outcome |
| `controlled` | Actual requested outcome exercised in a valid controlled environment |
| `production` | Actual requested outcome verified on the deployed affected surface |

Outcomes: `running`, `verified`, `partial`, `blocked`, `failed`, `interrupted`. `verified` requires controlled/production evidence. For every non-verified final outcome, record a next step. A source-only priority review must finish `partial`, explicitly say it is priority triage only, and leave progress/status unchanged.

Progress is an estimate against the item's checklist, not a count of commits. Explain any increase or reduction. Keep `testing` while operational/hosted/provider acceptance remains unproven. `completed` and `100` must be supplied together, and require a verified production outcome, evidence and no remaining work. A build, deployment, changelog bullet, opened card or successful HTTP response alone is insufficient. A user's report that something remains broken overrides earlier success claims.

Every successful AI review stores its start/end timestamps (displayed in MYT), scope, checker, source ref, evidence, next step and complete feature snapshots. Append-only events preserve each start/checkpoint/end. Finished runs cannot be edited; corrections require a new run. Do not delete or rewrite old reviews.

## Priority and work order

| Label | Use |
|---|---|
| P0 · Kritikal | Confirmed active failure affecting order/payment integrity, security or production stoppage; cite current evidence |
| P1 · Buat dahulu | Daily order/design/payment reliability, missing-order protection, or near-finished operational work |
| P2 · Seterusnya | Useful improvements and new capability after critical daily operations |
| P3 · Kemudian | Exploratory/optional work with lower immediate impact |

Use `work_type`: `fix`, `verify`, `build`, `improve`. Record `priority_reason` with impact, dependency and why it precedes other work. `priority_rank` sorts smaller first **within the same P level**. Default rank is 100; an explicit number is planning order, not a delivery date. Completed work goes behind unfinished work. Ties use fix → verify → build → improve, then title. Do not label an unconfirmed problem P0 just because a document is old. Verify stale assumptions first.

The owner board defaults to priority order and has priority/work-type/check-status filters, a “never checked first” sort and a top queue. The AI Checker tab has exact item filtering, bounded paged history and per-run event details. Latest review coverage is queried per feature independently of history pagination.

## RPC contract and safe SQL examples

Public RPCs are **SECURITY INVOKER**, owner-authenticated/service-only writes with RLS. Anonymous users cannot read or write these logs. Event triggers generate the audit trail; do not insert audit events directly. Backend callers use the same lifecycle API as the UI.

```sql
-- Preparation: current queue and latest per-item reviews, not just the last N events.
select id,title,status,progress,priority,priority_rank,work_type,priority_reason,
       acceptance_criteria,reference_url,updated_at
from public.icetak_roadmap_items
order by (status='completed'),priority,priority_rank,title;
select * from public.icetak_roadmap_ai_latest();
-- Read the selected item's older reviews / checkpoints with bounded limits.
select * from public.icetak_roadmap_ai_runs
where item_id='<FEATURE_UUID>' order by started_at desc limit 20;
select * from public.icetak_roadmap_ai_events
where run_id='<RUN_UUID>' order by id;

-- Generate RUN_UUID once in your client, retain it, and reuse it after transport failure.
select public.icetak_roadmap_ai_check('start','<RUN_UUID>','<FEATURE_UUID>',
 '{"checker":"Codex / owner request","scope":"Check the selected feature checklist against production backend and UI","source_ref":"production@<COMMIT>","next_action":"Read scoped live state, then exercise safe UI path"}'::jsonb);

select public.icetak_roadmap_ai_check('checkpoint','<RUN_UUID>',null,
 '{"verification_level":"source","summary":"Relevant live RPC and source inspected; hosted flow still pending","evidence":["path/to/file at <COMMIT>","RPC read result and timestamp"],"next_action":"Open the hosted affected flow and test expected outcome"}'::jsonb);

-- Omit progress/status/priority entirely when the evidence does not justify changing them.
select public.icetak_roadmap_ai_check('finish','<RUN_UUID>',null,
 '{"outcome":"partial","verification_level":"controlled","summary":"Controlled flow passed; hosted operator acceptance is still pending","evidence":["Exact test command, expected result and observed outcome"],"next_action":"Verify signed-in hosted operator flow","status":"testing","progress":80,"priority":"p1","priority_rank":20,"work_type":"verify","priority_reason":"Used in daily production; confirm acceptance before optional new features"}'::jsonb);
```

Retried `start`/`finish` with the same UUID return the existing run without another mutation. Read back to resolve uncertain transport outcomes. A completed UUID cannot be reused for a new audit. Duplicate checkpoint requests may append the same observation; they cannot update roadmap progress. Checkpoints are append-only observation boundaries, not downstream side effects.

If the feature's `updated_at` changed since start, a finish that would change metadata returns `conflict: true`. It appends a conflict checkpoint and leaves the run open; **no proposed feature fields are saved**. Reread, close that run as `interrupted` without metadata fields, then start with a new UUID/fresh snapshot. Do not bypass this by a direct table update.

Manual owner edits remain available separately and are not automatically labelled AI verification. An audit or verification-only request does not authorize a feature rewrite. Preserve visibility, acceptance criteria and unrelated owners' commits. Keep customer identity, exact private amounts and secrets out of public notes and all checked-in docs.

## Batching and handoff

For “check all”, first read coverage and priority; declare a small batch (normally 3–5 items), finish/log each independently, then continue if time allows. Prefer open failed/blocked/high-priority items before optional ideas. At the end report checked UUIDs, unresolved runs, untouched item count and next suggested batch. Never fabricate checks for untouched items. No automatic scheduling is installed by this feature.

Validation details for this implementation belong in the production changelog and release handoff; a priority-triage record is not evidence that its underlying feature works.
