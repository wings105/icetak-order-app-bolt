# Task Workspace side panel — 23 October 2026 MYT

Status: backend and frontend delivery PRODUCTION; actual bundled Admin V2 desktop/mobile behavior VERIFIED with controlled transport. Real signed-in hosted provider mutations, native Photoshop paste and physical printing are not exercised by the automated tests.

Route: `https://shop.decocake.my/?admin=v2&view=task-workspace`.

## Operator flow

Task clicks open one non-modal panel on the right. The original filtered list remains interactive and highlights the selection. Desktop width starts at 560 px, supports pointer/keyboard resize from 440 to 850 px and remembers the preference. Phones use the full viewport. Direct task links, filter/scroll preservation, stale-response guards, dirty-work navigation protection and active mutation locks remain in place.

The task name has a small copy icon. Status ClickUp and Complete task, Review customer, Finished product Printed / AWB-address shortcuts, Print AWB and Print Reference Order have priority placement. The action area stays visible while scrolling fields, attachments or chat. Searchable, keyboard-accessible dropdowns display the current provider options and colours; choosing an option immediately saves and verifies it. Complete uses the actual `complete` provider status for the selected task. Status and review remain separate from canonical payment, shipping or order completion.

Compact copyable fields show exact order reference, phone/WhatsApp shortcut, username, product job labels (including Artpaper), due date, all set labels, SKU and original multiline wording. Unknown values remain blank. Live ClickUp custom fields take precedence over the existing exact-linked snapshot enrichment.

## Displayed original images — 23 October correction

The gallery now renders the original attachment bytes in each image element, scaled only by CSS. Browser right-click → Copy image therefore uses the original pixel dimensions. Originals load as tiles approach the viewport through the existing authenticated asset read, then remain in the tile cache for Copy gambar, zoom and download. The copy control waits until the original is ready and does not make another provider/API request. Failed reads offer retry; object URLs are released when tiles unmount. Provider thumbnails are never displayed as a fallback.

Verified on the actual root-built Admin V2 with controlled transport: the displayed image source is byte-identical to the 1200×800 original, no 90×60 thumbnail request occurs, and the clipboard contains 1200×800 pixels. Copy uses zero extra asset requests (72 ms in the controlled browser; real PC timings vary). Desktop/mobile, existing dropdown/Complete/upload/print and native file-download flows pass with no page errors. Admin TypeScript and the complete production build pass. Hosted delivery evidence is recorded in the correction PR; native Photoshop paste remains unexercised.

## Provider actions and source refresh

Order `task-clickup` retains JWT verification, verified active admin identity and existing task membership/permissions. It reuses the owner-configured private API token. No credential is returned to the browser.

The single additional mutable field is Review customer, UUID `01cec4ef-a30b-443d-a43a-9ab09835b78c`. Option IDs are derived from the current task definition, including the numeric-zero first-option case; blank uses the provider's field-removal endpoint. Field and task revision/value checks precede a write. A second provider read verifies success. The existing private `task_clickup_actions` ledger now permits `field`, preserves server-derived actor/expected old value/new value, exact-request replay and cross-Inbox task locking, and permits safe retries of a known rejected pre-dispatch action. Unknown results require receipt reconciliation rather than automatic resend. The service-only invoker/grants/RLS boundaries remain unchanged.

Verified full provider snapshots pass through the existing work and raw-event projections. This keeps task groups, review and print/reference caches current after internal actions. A verified direct design attachment and its verified link-comment metadata feed the existing latest-image-comment print projection. The standalone AWB page, its webhook settings and its external action contracts are unchanged.

## Attachments and output

The initial gallery reads all current task attachments and File custom-field attachments. Task comments are paged in provider order (25 per request); a visible load-older control makes the rest available. Rich image/attachment blocks are supported. Stable attachment IDs and URL paths deduplicate overlapping sources. A comment-only image retains its page cursor for an authorized original reread. No gallery attachment is silently selected as a native final/QC file.

Small thumbnails are display-only. Copy fetches the exact selected original, preserves native pixel dimensions and converts a non-PNG image to PNG only for the system clipboard. Download preserves original bytes and filename, including native PSD/AI/PDF files. Original retrieval derives its URL from current task evidence; client URLs are never trusted. HTTPS ClickUp attachment hosts, redirects, streaming size limits (50 MB), image signatures and no-store binary responses are enforced. Clipboard conversion is bounded to 40 million pixels and has a download fallback.

The dedicated output area accepts paste/drop/select plus an optional comment, then sends the original multipart file directly through `task-clickup` into ClickUp. PNG/JPEG/WebP/PDF signatures and the 15 MB limit use the existing Inbox binary inspector. Only hashes, provider references and delivery receipts persist; these bytes do not enter Supabase Storage or Postgres. Attachment membership and the linked comment are read back. Uncertain delivery cannot blindly upload again. The separately labelled native file/QC area still supports the pre-existing private draft/final workflow.

## Printing

Both controls stay in the panel; they never navigate to `awbpreview`.

- Print AWB reuses the existing original-PDF proxy and `printAwbPdf` iframe helper. Shared links print once; additional distinct AWBs have explicit numbered buttons.
- Print Reference Order reads all tasks of the exact same order through the existing read-only preview endpoint, then uses the same A4 4-by-4 layout/CSS, latest design-image selection, title and customization. More than 16 tasks produce more sheets. Controls never appear on the printed sheet. Image-load failures prevent printing and offer retry.

No printing action changes Review customer, status or an external webhook by itself.

## Verification

- Root/storefront/Inbox build and Admin TypeScript/build pass. Root Vite now deduplicates React/React DOM so a checkout with both root and Admin dependencies uses one mounted React runtime.
- Existing workspace, readiness, detail automation, task design/media, AI Dashboard, Inbox ClickUp and AWB-action regressions pass.
- `check:task-clickup` covers permissions, provider option/field allowlists, zero-valued dropdowns, stale writes, field clear/readback/replay, exact Complete, direct image bytes/no Storage, native download bytes, rich comment attachments, deduplication, original/thumbnail separation, safe redirects, unknown recovery and verified-design print projection.
- Actual root-built Admin V2 at its exact route: 1700x1000, 390x844 and a read-only 1366x900 session. Observed non-modal list switching/highlighting, persisted resize, copy SKU/multiline wording, a 1200x800 clipboard image from a 90x60 thumbnail, byte-identical PSD download, dropdown search/autosave and exact task IDs, Complete removing only the selected active row, older-comment loading, direct-upload FormData original bytes, unsaved-switch protection, mobile chat and pinned actions, viewer write denial and no page errors.
- Both iframe print calls are observed. The reference document contains both order sets and exact A4 grid rules without action controls. The fetched AWB PDF is byte-identical; a test-only HTML viewer stand-in covers the native PDF viewer handoff because the serverless browser has no PDF plugin. Real printer dialogs/physical output and Photoshop are outside this evidence.
- Live migration `task_panel_review_actions` is applied. Native rollback verifies actor/membership, review-only allowance, duplicate/conflict/busy behavior, safe known-rejection retry and unknown no-resend. Remaining QA receipts: zero. Browser INSERT/EXECUTE remains denied, RLS enabled, invoker security retained. Security advisors introduce no new findings.
- Deployed function source/auth readback and anonymous 401 are checked; no real customer task, order, payment, provider send or design upload was used for verification.

## Hosted release

PR #119 merged as `f31be77b761b75ebb61fd18fcf97222f1cf02417`; production guard and Workers Builds passed. Build `3c9ab9fc-6926-4599-85a1-a63f116019d0` deployed Cloudflare version `5e52113a-d7b9-4431-bf8b-ae945f1ef0c4`. Browser reload of the exact Task Workspace route observed `main-DcNf6QDu.js` and `admin-v2-route-XVOMPJCr.js`, followed by the expected Admin V2 login gate with no application errors. This confirms hosted delivery; it does not extend the controlled interaction evidence to real signed-in provider writes.

## Rollback

Revert the frontend release to return to the previous design desk. The narrow additive ledger allowance can remain private. Restore the previous `task-clickup` function bundle if necessary; retain JWT true and existing receipts. The standalone AWB page and automation need no rollback.
