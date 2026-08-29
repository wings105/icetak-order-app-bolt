# iCetak Verification Protocol

Purpose: prevent coding agents from claiming a change is complete when code was edited but the requested behavior was never proven.

This protocol applies to Codex, Claude, Bolt and any other coding agent or maintainer working on iCetak.

## 1. Status model

Every requested change has one of these statuses:

### ATTEMPTED

Implementation exists, but the requested outcome has not been demonstrated.

Valid wording:

- `Implemented; not yet verified.`
- `Patch committed; production behavior not confirmed.`
- `Build passes; rendered result still needs verification.`

Invalid wording at this stage:

- `Done`
- `Fixed`
- `Working`
- `Live`
- `Completed`

### VERIFIED

The actual requested outcome was observed on the affected surface or a valid controlled equivalent.

Verification must be outcome-oriented, not implementation-oriented.

### PRODUCTION

The change is in the production source/runtime and a production smoke check confirms the requested outcome.

## 2. What counts as evidence

### UI / visual changes

Good evidence:

- open the actual rendered page/component
- confirm the correct route/build is being served
- observe the requested visual or interaction change
- when tooling supports it, capture a screenshot or rendered inspection

Not enough by itself:

- CSS/TSX/HTML was edited
- selector appears correct in source
- build succeeded
- commit/PR merged

Example: `make SPX/J&T/NinjaVan label larger` is VERIFIED only after the actual customer/admin surface shows a larger label. Seeing a larger font-size in source is ATTEMPTED only.

### Backend / API / Edge Function

Good evidence:

- execute the relevant safe request/event
- verify expected response
- verify resulting database/audit/queue state
- verify no unexpected duplicate or unrelated side effect

Not enough by itself:

- function deployed successfully
- endpoint returned HTTP 200
- code review suggests the branch should execute

### Database / migration

Good evidence:

- migration is present/applied where intended
- schema/function/index state is queried afterward
- relevant data behavior is tested safely
- bounded backfills are checked for unintended changes

Not enough by itself:

- SQL command reported success

### Payment / QRPay

Verification should include the relevant combination of:

- intended order/draft identity
- exact amount/session behavior
- ambiguous/unmatched behavior
- retry/idempotency behavior
- no false match to unrelated order/draft
- audit/recovery state

### WhatsApp / notification automation

Verification should include the relevant combination of:

- intended recipient identity
- master guard
- per-order opt-out
- session/window constraints
- duplicate-send prevention
- actual queue/log/send state

### ClickUp / external integration

Verification should include:

- intended source record
- expected external record/task
- stable IDs/linkage
- idempotent retry behavior
- no duplicate task/event

## 3. User verification has priority

If the user checks the real system and says the requested change is absent or broken:

1. Immediately revoke any earlier `done`, `verified`, or `working` claim for that change.
2. Treat the status as ATTEMPTED/FAILED.
3. Do not add a new success entry to `CHANGELOG.md`.
4. If a false changelog success already exists, correct it in the next change.
5. Investigate why the patch did not reach the real surface before editing the same code again.

The user's observation of the real target surface is stronger evidence than an agent's inference from source code.

## 4. Failed verification troubleshooting order

When source was changed but the real outcome did not change, inspect in this order as applicable:

1. Correct repository and branch — is the work actually based on current `production`?
2. Correct source file — is another component/page/runtime owning the rendered behavior?
3. Commit state — is the expected commit present on the target branch?
4. Deployment state — did the deployment run and serve that commit?
5. Build artifact — was the relevant app/package rebuilt?
6. Route/domain — is the user checking the same deployed surface the code change targets?
7. Cache/service worker/CDN/browser cache — is stale output being served?
8. Runtime configuration/feature flag — is the changed path enabled?
9. CSS specificity/responsive selector/state — is another rule overriding the visual change?
10. Backend version/project — was the correct Supabase project/function changed?
11. Data/state preconditions — is the tested record actually entering the changed branch?

Do not repeatedly make larger arbitrary edits until this chain is investigated.

## 5. Changelog policy

`CHANGELOG.md` stores reliable cross-agent memory.

### Do not record as completed

- speculative fixes
- code-only attempts
- failed tests
- work that the user says is still not working
- deployment attempts without outcome verification

These remain visible through Git commits/PRs and handoff notes.

### Record meaningful verified work

Use one of these prefixes:

- `[VERIFIED]` — outcome has been proven, but final production confirmation is not yet established.
- `[PRODUCTION]` — outcome has been confirmed on production.

Example:

`- [PRODUCTION] Customer tracking courier badges render larger and visually distinct for SPX, J&T and NinjaVan; confirmed on the production order-detail surface.`

Avoid vague entries such as `Fixed tracking UI` when the exact outcome can be stated.

## 6. Handoff format for unfinished work

When an agent must stop before verification, leave a concise handoff in the commit/PR/task description:

```text
Status: ATTEMPTED
Requested outcome: ...
Changed: ...
Checks passed: ...
Outcome verification: NOT DONE / FAILED
Observed issue: ...
Next check: ...
Deployment state: ...
```

This is preferable to polluting `CHANGELOG.md` with failed work.

## 7. Completion report

When telling the user a change is complete, include the evidence level naturally:

### ATTEMPTED example

`Code change is committed and build passes, but I have not verified the actual production page yet.`

### VERIFIED example

`Verified on the rendered admin page: the courier labels now use the requested larger treatment.`

### PRODUCTION example

`Merged/deployed and smoke-checked on production: the courier labels are visibly larger on the customer tracking page.`

## 8. Rule of thumb

**Tests should prove the user's requested result, not merely prove that the agent successfully edited code.**
