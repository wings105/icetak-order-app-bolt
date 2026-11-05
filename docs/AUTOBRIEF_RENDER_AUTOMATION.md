# AutoBrief native render automation

## Contract

Order System owns the queue and source snapshots. `autobrief-render` runs server-side,
using the existing service-only ClickUp integration credential and scoped worker
authentication. There is no ChatGPT scheduler, Activepieces, Windows process, or new
AI call in this path. Existing AutoBrief workers are not replaced.

When AutoBrief completes with confirmation and confidence >=80, an audited trigger
queues that exact task. Earliest eligibility is confirmed_at + five minutes. A
meaningful wording revision waits another five minutes. A one-minute cron dispatcher
claims one job globally using a five-minute lease. Timing is therefore normally
five to six minutes plus rendering/provider latency, never an exact wall-clock SLA.

Only new confirmations after rollout are captured automatically. Existing confirmed
orders are not backfilled. A deliberately selected operational canary may be queued
by the private service-only `render_auto.enqueue(task_id,true)` function; it still
uses the original confirmation delay and all final source/task checks.

## Template readiness

The template must exist and have `config.automation.enabled=true`, with one mapping
for every unique template input. Configure this in Admin V2 → Render Templates →
AutoBrief → Render automatik, then save the template. Rules are stored in the same
versioned/audited template record; no SKU/style/font is hardcoded in the worker.

Input sources: greeting, name, age, name_age, wording, date, literal. Every mapping
has `required` and `default`; defaults are allowed only for greeting/literal.
Name means the name to print, never the buyer/account identity. `name_age` joins
the exact supplied name and age with a space; it never invents TURN, YEARS or TAHUN.
An optional empty age stays empty and its standalone text layer paints nothing.

The deterministic parser accepts explicit name/age/greeting/date labels, preserving
units and language. Explicit unlabelled wording is passed intact into one layer, or
exact matching lines into the configured dynamic layers. Ambiguous instructions,
too many lines, duplicate labels, media/extra artwork, preview requests, pending
changes and static-word patterns are held for review. Fixed pattern words require
manual review because they may change the customer's wording/language. This is
deliberately conservative; AutoBrief confirmation is not permission to translate.

YS0315 is configured with greeting default HAPPY BIRTHDAY and name_age; all artwork
and custom font settings remain in its Admin-managed template. Other templates
remain manual until their mappings are explicitly configured and enabled.

## Delivery and recovery

Before upload, read the actual ClickUp task again: same order, SKU, confirmed flag,
paid flag, ORDER LIST membership, exact wording and design-editing status. Recheck
the canonical paid/unshipped/noncancelled order, current AutoBrief, pending changes,
lease and template version after rendering. Stale work is held, not attached.

The existing Cloudflare renderer executes the shared Canvas engine using a short
HMAC-signed request. Its key remains in the Edge runtime. Output must be a valid
PNG at the exact template dimensions and <=16 MiB. No binary is stored in Postgres.

The deterministic attachment filename contains task, SKU and rendered-input/version
fingerprint. Read the task attachments before any write. Persist upload-start before
POST, store the receipt, then read back the attachment ID before completed. An
unknown POST result is reconciled by filename; it is never blindly resent. After
five failed attempts the job remains visible for operator intervention. Earlier
attachments are preserved. No customer message or task status change is sent.

Private jobs/events and settings have RLS, no anon/authenticated grants, and only
service access. Owner/Manage Admins log access uses the existing authenticated
`render-template` gateway action `auto-status`; its public GET reveals no job data.
The intentional service-only RLS tables have no user policies (deny by default).

## Verification

- `node --experimental-strip-types scripts/check-autobrief-render.mjs`: exact Malay
  wording/age units, name-only/optional fields, missing name, ambiguity, static
  pattern hold, paid/task/revision guards, signed output, one upload, receipt reuse,
  stale-source rejection and uncertain-POST handling using the actual worker.
- Live SQL rollback: trigger creates a queue row at least five minutes after a new
  confirmation; anon/authenticated cannot access the private queue/RPCs; no QA rows
  remain.
- Live operational canary: server dispatcher → renderer → actual ClickUp upload →
  attachment readback succeeded; the recorded input kept the supplied Malay age
  unit. The native cron subsequently ran successfully. No historical queue backfill.
- Frontend build and Admin source guard pass. Authenticated hosted mapping controls
  require separate rendered verification after the production source deployment.

Queue status and retry receipts are visible through Refresh log render. Unsupported
templates/details stay in review/skipped with a bounded reason; they are not claimed
as automatically supported.
