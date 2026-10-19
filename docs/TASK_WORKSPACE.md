# Task Workspace — Admin V2

Status: backend and hosted delivery PRODUCTION; controlled Admin V2 desktop/mobile VERIFIED. Signed-in hosted staff use remains unexercised.

Route: `https://shop.decocake.my/?admin=v2&view=task-workspace`.

## Per-task readiness brief — 20 October 2026 MYT

Status: backend and hosted readiness delivery PRODUCTION; controlled Admin V2 UI VERIFIED. task-workspace v4 and task-brief-media v1 have exact deployed source/auth readback. Signed-in hosted staff actions remain unexercised.

Each row has readiness, exact missing fields, completeness percentage and evidence confidence. Filters separate review, missing information, confirmed designer work and ready print/cut. The drawer puts an editable production brief before source facts/files, with field provenance, exact wording, selected artwork, scoped customer evidence, copy brief, stale brief comparison and explicit re-read. Brief editing participates in unsaved-close protection and cannot race native work editing/upload.

| Product | Mandatory specification |
| --- | --- |
| Edible / wafer | Product, quantity, size, shape, design requirement, then selected image, exact wording/name+age or explicit template code as required |
| Acrylic | Product, quantity, size, material, colour, design requirement and its required content |
| Topper | Product, quantity, size, material, design requirement and its required content |

Several units/sets require a recorded same-design observation; different designs must remain separate tasks. Dimensions such as 5 × 5 inch are not quantities. Unknown specifications are not guessed. Mirror Gold alone does not establish acrylic. Standard/template work still needs an explicit template/instruction identifier. Completeness is a field ratio, not an AI probability. Confidence is high for complete currently confirmed briefs, medium for complete unconfirmed extraction, and low for missing/conflicting/unavailable evidence.

Automatic Confirmed requires complete requirements plus the existing exact task Confirmed checkbox or a current complete saved admin detail check. An inferred specification, attachment, production stage or payment alone cannot confirm a brief. A native admin confirmation can resolve extraction ambiguity after reviewing the current task and evidence. Mapping conflicts, unavailable order/chat reads, missing required fields and closed/shipped orders cannot be confirmed. The UI's confirmation is an internal observation, not a provider/customer approval or permission to charge, ship or alter stock.

The gateway reuses `admin-ai-dashboard/order-details.ts` and its current identity/session boundaries. An exact unique task-to-item SKU or the existing single-item/single-task rule permits chat extraction; generic multi-item chat is never allocated by array position. For a single exactly assigned item/session, explicit Saiz/Size, Warna/Colour, Material/Bahan, Qty/Kuantiti and Bentuk/Shape labels also fill specifications with evidence; dimensions require a unit or paper-size code. Exact production components also supply their own item specification. Automatic chat uses the narrow existing `order_details` bridge; rare saved manual bindings retain the existing full current-identity validation. Only extracted task evidence reaches task users, not whole conversations. Explicit selected image instructions are required; receipts, reference screenshots, history, outbound and other-session images cannot fill artwork. Readiness fingerprints include a rule version so stricter extraction changes cannot retain an older confirmation.

`task_workspace_briefs` and `task_workspace_brief_events` are service-only RLS tables. Confirm/save requires an active owner, edit_order, manage_customers or manage_admins plus workspace read permission. Production-only approve_production users retain work/upload access but cannot attest admin detail checks. The server derives actor, recomputes current task/order/chat fingerprint, validates all fields, native asset ownership and final-file IDs, then invokes a versioned audited/idempotent save. SQL rechecks active permissions, native version, current database source token and active task. Exact retries return one prior result; changed-payload request reuse is rejected.

Source/item/saved-detail changes, new scoped inbound revisions or task-file changes invalidate old confirmation. Previous values remain visible for comparison and are not silently carried into the new source brief. Reads never mass-create confirmed records. Because order and chat live in separate projects, a customer message can arrive after the final pre-save read; the next read invalidates that observation. This is conservative fingerprinting, not a cross-project transaction.

Ready print/cut additionally requires an explicitly selected private task file, recorded artwork QC and a source or manually observed customer approval when required. Arbitrary task attachments are not automatically final artwork. Private native image references use stable task-file IDs and short-lived URLs. Selected WasapFlow images use a new server-only read-only Inbox `task-brief-media` cache signer, authenticated with the existing private bridge token. It signs only ready cached image records; unavailable originals block image readiness and ask for an original upload. It does not send, fetch provider media or mutate messages/media status. Signed URL rotation is excluded from fingerprints. Both task and Inbox credentials stay server-side.

Verification: real current 59-task / 51-order read and bounded exact session context inspection; source-only evaluation; rolled-back live confirmation/version/audit/idempotency/stale-source/nonstaff checks (zero QA brief/audit rows remain); actual gateway permission, actor, stale fingerprint, native asset, changed-payload retry and upload tests; selected-artwork and item/session/conflict/quantity/read-failure tests; media signer unauthorized/invalid IDs/non-image/positive signing in controlled tests. Deployed source readback is exact (10 task files, 1 media file), JWT true on task-workspace, anonymous requests rejected on both functions. A real server-authenticated media request returned available=false for an uncached active-session image, as required. A positive hosted cached-image download and signed-in hosted staff mutations remain unexercised.

Actual Admin V2 App UI at 1700×1000 and 390×844, using 59 live-source tasks plus four isolated controlled product cases: readiness counts/filtering, 100%-complete medium-confidence review, admin confirmation, new-file expiry, final/QC print-ready, stale-chat 409 preserving edits, unsaved-close protection, edible direct artwork, wafer same-design gate, topper source confirmation, retained rows on read failure, viewer denial and mobile overflow checks passed, with zero page errors. No real customer/task/provider mutation was used. Existing order detail model checks, stock/acrylic/workspace/readiness/source guards, Admin TypeScript/build and storefront/Inbox build passed. The unrelated pre-existing order-details gateway harness fails resolving its ../_shared import from /tmp; no regression claim is made for that harness.

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

## Hosted delivery — 20 October 2026 MYT

PR #100 merged as f9bc1af1c439223600ded6807a87ffb2c22a7d5e; release tree 1bd777aa1a66cb337d9fd289e503014e8750814d exactly matches the verified local tree. Cloudflare production build e2088eb1-5500-406c-8d49-5168b182250d succeeded. Domain serves main-tnWipl7A.js, App-DiTBJqOE.js and TaskWorkspace-b5a-p2vR.js; route and work/upload labels are present, and TaskWorkspace-Di3yW633.css is byte-identical to the tested CSS. JS bundler wrappers/import aliases differ from the local build, so byte identity is not claimed.

Local Chromium could not reach the hosted domain (ERR_EMPTY_RESPONSE); cloud-browser smoke of the exact route reached secure Admin Login. No app error was observed; existing multiple-GoTrue-client and extension-metadata warnings remain. GitHub Actions guard/reminder and the config-triggered existing shipping deployment were still queued at observation; equivalent local guard checks (stock, acrylic, source, Vite smoke and full build) passed. Authenticated hosted workspace interactions and real Storage upload/download remain unexercised.


## Readiness hosted delivery — 20 October 2026 MYT

PR #101 merged as 90e0208a8659da13dd7f91e92d29b77f6d24fc2b, exact tested tree 3f98ee73b62fdc6d328f329a5ce5a95ff0747c3c. Feature build 3015c798 and production Cloudflare build 957adbae-96df-4f5b-b6f3-1a3d6ae581f3 succeeded; feature and production guards passed, including new readiness/workspace checks. Public domain serves main-9Hr6vaoH.js → admin-v2-route-CeXv1Vi3.js → App-CWQzVNpg.js → TaskWorkspace-ZJPdvPEh.js. All five brief/confirmation/re-read/stale-comparison labels are present; TaskWorkspace-EyI9We9s.css is byte-identical to the tested root build. Cloud browser reload of the exact route reaches secure Admin Login without an application error; pre-existing extension-metadata and duplicate GoTrue warnings persist. Backend v4 additionally verifies explicit labelled chat specifications and rule-version expiry; no frontend changes were made for this follow-up. Signed-in hosted staff changes and positive cached-image downloads remain unexercised.
