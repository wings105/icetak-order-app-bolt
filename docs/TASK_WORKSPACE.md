# Task Workspace — Admin V2

Status: backend and hosted delivery PRODUCTION; controlled Admin V2 desktop/mobile VERIFIED. Signed-in hosted staff use remains unexercised.

Route: `https://shop.decocake.my/?admin=v2&view=task-workspace`.

## Design desk — 21 October 2026

Task details now open a read-first design desk with adjacent original messages, asset copy/download/recovery and native production handoff. See [TASK_DESIGN_DESK.md](TASK_DESIGN_DESK.md) for current UI, auth/media behavior, verification and remaining external integrations. The release records below describe their historical versions.

## Per-task readiness brief — simple customer rules, 20 October 2026 MYT

Clear customization is sufficient for `Confirmed · Ready designer` with high categorical confidence and `Sistem · detail customer lengkap`. The old ClickUp Confirmed checkbox, paired name + age, material/colour/size and same-design checkbox are not mandatory customer-detail gates. Known order specifications still appear in the brief; unknown specifications are left blank. Completeness is the required-content field ratio, not an AI probability.

| Product | Sufficient customer content |
| --- | --- |
| Cake topper / artpaper / mirror gold | Name, age, or custom wording in checkout note or matched chat; any one is enough |
| Edible / wafer | Wording only, one image only, or image plus wording; order size/shape are reused when present |
| Acrylic | Wording only, reference image plus wording, or supplied finished-design image alone |

An inbound image does not need a caption or an additional “use this image” instruction. Known payment receipts/order screenshots, outbound/history and out-of-scope messages remain excluded. An acrylic image explicitly labelled as a reference without wording needs review; an uncaptioned supplied design is accepted. A custom topper image still needs name, age or wording. Multiple unselected images, conflicting wording and unresolved customer alternatives require admin review. Explicit customer corrections replace older wording; complementary name/age may fill the same brief. Customer instructions are preserved with evidence. Exact task/item customization and canonical checkout reference images are supported. Standard/template work still needs an explicit template identifier.

Each row shows readiness, missing fields, completeness and confidence. Filters separate review, missing information, confirmed designer work and ready print/cut. The drawer presents editable wording, selected artwork, specifications, field provenance and scoped customer evidence, plus copy/re-read and comparison with earlier saved values. Brief editing has unsaved-close protection and cannot race native work editing/upload.

The server reuses exact task/item matching from `admin-ai-dashboard/order-details.ts`. Generic multi-item chat is never allocated by array position. Automatic context now uses a narrow private `task-brief-media` context action and service-only invoker `icetak_task_brief_context`; rare saved manual bindings retain existing current-identity validation and their explicit time ranges. Automatic exact order/session links may include up to seven days before order placement and subsequent current-session messages. Previous closed-order cutoffs apply across linked WhatsApp/Shopee conversations; unknown earlier boundaries or concurrent orders suppress expansion. Closed orders are unusable. Reads are bounded to 120 messages per binding, with truncation requiring review. This does not change the CRM/draft extraction context contract or ingest older provider history.

`task_workspace_briefs` and `task_workspace_brief_events` remain service-only RLS tables. Save/confirmation requires active owner, edit_order, manage_customers or manage_admins plus workspace read permission. The server derives actor, recomputes the current fingerprint, validates native assets/final-file ownership and uses versioned audited/idempotent saves. Mapping conflicts, unavailable order/chat reads, missing required content and closed/shipped orders cannot be confirmed. A deliberate current-source admin check can resolve extraction uncertainty. Automatic completeness is evaluated on read and, from 20 October 2026, persisted by the independent task-detail worker. Automatic observations do not create admin confirmations or change provider/customer approvals. See ORDER_DETAIL_AUTOMATION.md.

Source/chat/file revisions expire saved manual values and QC. Previous values remain available for comparison. Clear current customer content is automatically evaluated again, so a harmless revision need not demote an otherwise complete brief. A changed-source save still returns 409 and preserves browser edits. Fingerprints include `task-brief-simple-v1`; rotating signed URLs do not change them. Cross-project reads are observations rather than a distributed transaction; a message arriving after the final pre-save read is caught on the next read.

Ready print/cut additionally requires an explicitly selected private final task file, recorded artwork QC and customer approval when required. Receiving an image is enough for customer-detail completeness even when its preview is unavailable; an explicit access warning remains visible for production. The private cached-media signer signs only ready cached images and does not fetch provider media, send messages or mutate ingestion state. Native files use stable task-file IDs and short-lived URLs. Credentials remain server-side.

Backend: `task-workspace` v9 (JWT + active admin) and `task-brief-media` v2 (private bridge-token authentication). Exact deployed-source readback and unauthenticated 401 checks passed. Both append-only Inbox migrations are applied; wrapper EXECUTE is service_role only, invoker security with empty search_path. A real authenticated Order→Inbox context read returned scoped messages for 30 requested orders. Live cutoff verification found 14 prior boundaries (10 across channels), with zero expanded-scope violations; closed requests returned zero usable bindings/messages.

Controlled actual Admin V2 App at 1700×1000 and 390×844 used 64 current source tasks plus four isolated cases. Automatic acrylic wording, topper checkout name, edible/wafer caption-free pre-order image readiness, high confidence without Confirmed/same-design checks, unchanged complete content after upload, explicit final/QC print readiness, conflicting chat/stale-save 409 preserving edits, unsaved-close protection, filters, retained rows after failure, viewer denial and mobile overflow passed with zero page errors. Browser plugin unavailable; local Playwright used. No real customer/task/provider mutation was needed. Product-rule/source-adapter/gateway/media-context tests, existing order detail/stock/acrylic guards, Admin TypeScript/build and storefront/Inbox build passed. Hosted frontend delivery for this revision is confirmed below; signed-in hosted staff mutations and positive cached-image downloads remain unexercised. Earlier release evidence describes its historical rule set.

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

## Simple-rule hosted delivery — 20 October 2026 MYT

PR #102 merged as `fe2f500bdb53f27bb0167afdd78801f63b18a33c`, exact tested tree `8fcce9b35699407c87f591145cf1b5cff7e5f053`. Feature Cloudflare build `976851a2-f654-44b2-8ee6-a215a8a90d57` and production build `af1aa5eb-345c-44bb-9b7c-8dcfb07bafae` succeeded; feature/production guards passed. The public domain serves `main-BdVh7C1e.js` → `admin-v2-route-ByvZSAx-.js` → `App-DNBpQdtv.js` → `TaskWorkspace-B6W2Xtj-.js`. All eight current brief/automatic-recheck/optional-same-design labels are present; `TaskWorkspace-EyI9We9s.css` is byte-identical to the tested build. Cloud browser reload of the exact route loads the new entry and renders secure Admin Login; observed console error is the existing browser-extension metadata warning. Signed-in hosted staff actions remain unexercised.

Final backend `task-workspace` v9 and Inbox `task-brief-media` v2 have exact source/auth readback. Controlled actual UI additionally verifies custom-topper image-only remains missing wording and explicitly labelled acrylic reference-only requires review, while supplied uncaptioned acrylic artwork is accepted by the product matrix. Inbox migration history records preorder context as `20261019171333` and cross-channel cutoff as `20261019222601` (MCP application timestamps; repository SQL filenames retain creation timestamps). No production customer/task/message records were changed for verification.
