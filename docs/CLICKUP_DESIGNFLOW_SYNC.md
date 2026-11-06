# AI Designer / QC ClickUp field receipts

Order System `render_qc.field_sync` is a private durable outbox. New native render
completion with a verified attachment queues Review customer → Render ai. QC
PASS/released, HOLD, FAIL and RETRY queue designflow → the corresponding existing
Ai QC pass/hold/fail/retry option, including pilot-mode results. No task-status or
printing-mode setting is changed. Historical records are not backfilled globally.

Verified ORDER LIST 18375902 definitions:

| Field | Field ID | Option | Option ID |
|---|---|---|---|
| Review customer | 01cec4ef-a30b-443d-a43a-9ab09835b78c | Render ai | 49c8b202-d985-4fa2-aae6-658ccca96433 |
| designflow | 4cdb78bd-4fc4-4fd6-a1dd-5b6b01ea4110 | Ai QC pass | 093279a0-80a5-49ea-bec8-a25981a87937 |
| designflow | same | Ai QC hold | 60798603-fc52-43d3-91dd-b7e2e5396636 |
| designflow | same | Ai QC fail | 1f772f47-060b-49f4-9241-f2b1f7fa7471 |
| designflow | same | Ai QC retry | 9cccc7fb-0057-4c10-abd8-be6a416da06b |

Only the latest QC run for the exact current render attachment/source can update
the field. The unique task+field row supersedes older desired values. Leases and
revisions reject stale acknowledgements. The worker checks current source, active
topper task membership, attachment and live dropdown definitions before posting an
option UUID. It reads the task again before recording success. Unknown POST results
retry by reading first; an already-correct field does not receive another POST.

The native one-minute dispatcher retries up to five attempts then leaves a visible
blocked receipt. Tokens stay in the existing runtime setting; private tables/RPCs
are not available to ordinary clients. No custom field option is created or renamed.

Verification: actual selected completed render/QC job synchronized both existing
fields and ClickUp plugin readback confirmed the labels. Actual-worker controlled
tests cover all five mappings, existing numeric values, no duplicate write, changed
metadata, superseded source, unknown POST and closed-task rejection. Native SQL
rollback proves ACLs, deduplication, lease and revision guards. Forward trigger
acceptance on a naturally occurring future job remains separate from this selected
canary. The field labels do not change pilot printing-release policy.
