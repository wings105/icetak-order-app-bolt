# AI QC Topper

Order System owns this forward-only pilot after AI Designer Topper completes.
The existing `render_auto.jobs` completed transition queues one QC record per
render attachment/source and QC rules version. Initial scope is YS0312/YS0315.
No historical backfill; the explicitly selected pilot is separately audited.

The service reads the live task, current AutoBrief, paid/open canonical order,
confirmed template, exact attachment, and the existing native Task Workspace
source/session/readiness calculation. That reader is pinned from its v23 bundle
under `ai-qc/vendor`; its live application is not overwritten. Customer evidence
comes from native raw order notes and scoped inbound messages, not just AutoBrief.
Missing/ambiguous/truncated evidence, unresolved readiness or requested review holds.

Vision receives actual PNG and confirmed raw artwork, layer boxes and customer
sources using the existing runtime key, store:false and a strict per-layer ID
schema. Raw artwork is expected to differ by the requested custom text. Issues
are defects only. Each dynamic layer, including an empty label, must be read.
The server compares every observed layer to the expected rendered text; a model
PASS/confidence claim alone cannot approve missing/wrong/extra layer text.
PNG signature/dimensions, exact field mapping, source/version/receipt and fresh
post-vision evidence fingerprints are checked independently. Cropped text images
are not yet included: unreadable full-image text must hold rather than be guessed.

Decisions PASS/HOLD/FAIL/RETRY are private, versioned and audited. Approval binds
SHA256 of actual bytes, attachment ID, template version and source fingerprint.
Provider failures retry at most three times, expired final leases become HOLD.
No customer messages are sent. Log access uses the existing authenticated owner/
Manage Admins render-template gateway and Render Templates → AI QC Topper.

## Printing boundary

Pilot mode records decisions and **does not auto-release printing**. Existing
manual production operations remain available. Observe/review a representative
20–30 orders before considering automatic release. This is an acceptance step,
not a claim that a self-reported confidence score is calibrated.

The implemented auto-release path (disabled in the pilot) persists a PASS audit
before registering an immutable private task-workspace PNG, selecting that exact
file in the native brief, setting artwork QC, recalculating native readiness and
calling the same native workspace handoff RPC. It never manufactures customer
approval or changes ClickUp task status. Native receipt keys reconcile an unknown
handoff result without a duplicate. Human/operator permission and all source/
version checks remain. Source changes invalidate native brief readiness.

## Verification

- Actual OpenAI vision pilot read exact name, number and original unit; rules v3
  returned PASS after two safely held calibration defects. Earlier records remain.
- `scripts/check-ai-qc.mjs` executes actual worker inspection and release with
  controlled transports: strict request schema, exact text, blank labels,
  missing evidence, source change, provider failure, native final-file/brief
  readiness handoff and duplicate receipt reconciliation.
- `supabase/tests/ai_qc_rollback.sql` proves private ACLs, deduplicated queue,
  stale lease rejection, changed-output HOLD and append-only decision events.
- TypeScript, Admin source guard, native render regressions and full build pass.
- Real native auto-release remains unverified/disabled; fresh rollout trigger and
  longer calibration remain operational acceptance rather than Completed/100%.
