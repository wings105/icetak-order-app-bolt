# Task Workspace — Admin V2

Status: backend read/save VERIFIED; controlled Admin V2 desktop/mobile VERIFIED. Hosted release pending.

Route: `https://shop.decocake.my/?admin=v2&view=task-workspace`.

The owner's two ClickUp screenshots define the reference: compact dark grouped task tables, coloured status headings/counts, separate set rows and work tabs. The existing Admin V2 shell is retained. This is an operational page, not a standalone Site.

## Ownership and coverage

`task-workspace` is a JWT + active-admin Edge gateway in Order System `buivecgahhmrhlmfujgt`. Its service-only invoker RPC reads the existing `ai_clickup_work_snapshots` and bounded latest complete raw task payloads. Exact stored order/component/marketplace links enrich phone, customer, wording, due/ship-by, payment and fulfillment. Names/phones do not create new order links. No browser key can access native work tables/RPCs directly.

One row remains one ClickUp Task ID even for several sets sharing an Order ID. Source ORDER LIST statuses exclude Lain2, Prospect and terminal tasks; deleted events suppress stale rows. Completed native work remains in Selesai while its source task is in ORDER LIST. Source-terminal history is accessible by an exact task detail read but is not a complete historical list. The workspace currently covers tasks already projected from ClickUp, not orders whose task has never been created/linked. Missing fields remain unknown.

All task sources are loaded in one bounded read (1,000; truncation visible) before local search/filter/count/sort. List refresh is every 30 seconds on visible pages, paused while detail is open. Failure retains rows with an explicit stale-data error. Phone/SKU/wording/review/courier columns can be toggled locally. Native task status is visibly labelled iCetak; source status is separately shown in detail.

## Native work

Staff may take a task, assign an active PIC, save work notes/status, upload PNG/JPG/WebP/PDF up to 15 MB and review an activity history. Reading requires owner, `view_orders`, `edit_order`, `approve_production` or `manage_admins`; writes require owner, `edit_order`, `approve_production` or `manage_admins`.

New private RLS tables: `task_workspace_state`, `task_workspace_events`, `task_workspace_files`. The gateway derives the actor from verified Auth identity and rechecks current permissions. The SQL save rechecks the active actor, serializes task/request locks, rejects stale native versions and source revisions, validates assignees/status/lengths, and atomically records work + audit + upload metadata. Retrying the same save request is idempotent; a different payload cannot reuse its request ID. Source updates invalidate a native status override, while assignment, notes and files remain available. This conservative choice avoids an old workspace stage masking newer source work.

The distinct private `task-workspace` Storage bucket has no browser policies. The server checks file signatures and size, stores immutable object paths and returns 15-minute signed URLs only after staff authorization. A storage upload followed by an indeterminate database timeout is retained rather than risking deletion of a committed task file. Failed uncommitted uploads may require later orphan cleanup. Upload retries are not advertised as exactly once.

Native status/files/notes are internal work facts. They do not update ClickUp, customer review artwork, canonical component progress, payments, stock or fulfillment, and do not send messages. Order shortcuts reuse existing Admin V2 surfaces. Publishing customer review, physical fulfillment and bidirectional ClickUp writes remain separate future integrations; do not imply they happen from Simpan kerja.

## Verification — 19 October 2026

- Live read returned 57 distinct tasks: Acrylic 23, Design Edible 20, Design Topper 9, New Custom 4, Ready Stock 1; exact canonical/marketplace enrichment and separate set rows observed. Counts are a time snapshot.
- Rolled-back live SQL proved save/version increment, exact retry/one audit, stale version rejection, newer-source precedence/rejection and nonstaff denial. No QA row, native saved work or file remained afterward.
- `npm run check:task-workspace` executes the actual gateway in a controlled fetch harness: active/nonstaff/user auth, read/write permission separation, verified actor, sanitised attachment DTO, invalid action/task/version/patch, file signature validation and upload routing.
- Actual Admin V2 App at the exact route, 1700×1000 and 390×844, with the real read DTO and controlled APIs: counts, Acrylic filter, exact search, separate sets, take/PIC/note/status, upload, saved detail reload, work grouping, complete separation, columns, dark/light, refresh failure/retry, unsaved close and viewer-disabled controls passed. Zero page errors. Browser plugin unavailable; local Playwright Chromium used. No actual customer task/order/payment/provider write was performed in QA.
- Visual review against both owner screenshots: dark background, dense horizontal tables, coloured status groups, tabs/counts, compact badges and separate set rows preserved; existing Admin sidebar and a right detail drawer are deliberate extensions. Horizontal scrolling is contained within tables; mobile shell transition was allowed to settle before capture. Global light table headers were explicitly scoped out. No generative assets are needed for this existing code-native reference UI.
- Root/storefront/Inbox build, Admin TypeScript/build and Admin V2 source guard passed. A pre-existing unknown-to-ReactNode guard in OrderItemStructuralEditor was made boolean to unblock Admin TypeScript without changing its behavior.
- Migration `20261019154503_task_workspace.sql` applied; gateway v1 ACTIVE with JWT true and exact two-file source readback. Anonymous POST returns 401. Private bucket and service-only grants read back. Advisors report expected INFO-only no-policy notices for these three service-only tables (no browser grants); unrelated existing findings were not changed.

Hosted signed-in staff use and a real authenticated Storage upload/download are not yet exercised. Do not describe those as production verified solely because a build or deployment succeeds.

Rollback: remove the Task Workspace route/sidebar and disable the gateway. Existing work tables/files may remain private for recovery; no source order/task/provider changes require reversal.
