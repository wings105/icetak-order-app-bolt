# AWB order reference preview

Route: `https://shop.decocake.my/?awbpreview=<ORDER ID / customer name>`.

Owner-approved public internal print reference. Exact custom-field order ID lookup; no login, AI, generation job, or Activepieces round trip on page open. The page returns task ID, title, Customize Name, set, image URLs, SKU and the task's AWB PDF link. Raw payloads, prices and credentials are not exposed. The AWB document itself contains delivery details and is accessed through its existing link.

## Data

`clickup_webhook_events` insert -> `capture_clickup_awb_preview` trigger -> private/RLS-enabled `clickup_awb_preview_tasks` projection -> public `awb-preview` Edge Function -> standalone frontend entry.

The migration seeds the derived cache from existing raw events without modifying orders, webhook history, ClickUp, payment or notification state. Subsequent full task snapshots update order membership/title/set/attachments only if their task timestamp is not older. Image comments update independently by comment timestamp. Moving a task to another order ID removes it from the old preview.

Image rule: every image in the latest image-bearing comment, preserving comment order. Text/PDF-only comments retain the last image comment. Duplicate URLs are removed. Deleted attachments in the current full snapshot are suppressed. Without captured image-comment history, show the latest image attachment only; historical attachment lists cannot reliably identify a multi-image revision. No AI classification or image downloads/proxying. Only HTTPS ClickUp attachment URLs are returned. Comment deletion events without a revised full image comment are not reconstructed from ClickUp history.

The upstream Get Task snapshot is required to include custom_fields and attachments. Updates are visible after the existing ingestion flow receives them and the page is opened/refreshed.

AWB links come from `AWB link` (field ID `8a8589f6-5a80-493c-902b-0ed8da4584be`) in each matched task's latest complete webhook snapshot. The service-only `get_clickup_awb_print_fields(text[])` RPC returns AWB URL and SKU from the same snapshot and performs at most 200 indexed per-task lookups using the existing full-snapshot index. It performs no history scan, backfill or business-record writes. Empty/removed fields remain empty; HTTPS URLs without embedded credentials only are returned. Duplicate links across tasks are shown once. Different links get numbered Print AWB controls.

## Layout

One task per cell, 4x4 grid, up to 16 tasks per A4 sheet. More tasks produce another A4. Multiple images share the task quadrant. Wrapped task title followed by the Customize Name value (omitted when empty), image contain sizing, 10mm sheet padding and 3mm grid gaps. Empty set is accepted; numeric sets sort first. Missing images show `Preview belum ada`.

Each task title has a small Copy task name button on screen. One click copies the original full task title (including Unicode and line breaks) to the clipboard; Customize Name is not included. A transient Disalin ✓ status confirms success; denied/unavailable clipboard access shows a retry/manual-copy message. Refresh rebinds the controls. Copy buttons and feedback are hidden in print/PDF, retaining the existing A4 layout. No backend or external writes.

Print/Save PDF waits for all images to load, is disabled on image loading failure, and excludes toolbar/status. Missing preview items remain visible and are counted in the toolbar. This is a dynamic HTML page, not a stored PDF or automatic PDF attachment.

Print AWB fetches the matched task PDF, loads a local PDF blob in an offscreen iframe and calls that frame's print action directly. No new PDF tab is opened for the normal flow. The controls show loading and prevent duplicate clicks. Failure restores retry and offers an explicit Buka PDF fallback. A frame is retained until afterprint or the next print request; its object URL is revoked on cleanup. The existing reference Print / Save PDF still prints the current reference page.

The `awb-preview` v4 GET endpoint accepts `awb_task_id` only for a task already matched to the exact `order_id`. PDF retrieval uses the stored field, never a client-supplied URL. Only the existing iCetak S3 bucket or HTTPS ClickUp attachment domains are allowed; credentials, nonstandard ports and redirects are rejected. Bytes are limited to 10 MB, verified as PDF and returned with no-store and existing CORS headers. This avoids the S3 cross-origin restriction while preserving the original PDF bytes, pages and dimensions. No database or business writes.

Direct-print implementation checks: source/PDF failure and byte-limit regression checks; live proxy output byte-equals the original 57,843-byte task PDF and rejects an unrelated task. Controlled real-entry tests with a viewer stand-in cover print target, no new tabs, loading/retry, reference printing and mobile overflow. Hosted Chrome verifies the new button/loading flow, local PDF frame and returned print call with no new tab or relevant app errors. The native dialog itself is not exposed by this cloud browser, including for the existing reference-page print action; popup contents and physical output remain ATTEMPTED/unverified.

## Native ClickUp task actions — 30 October 2026

The standalone page now sends its three fixed actions to the existing `awb-preview` backend, which uses the private `clickup_designer_api_token` and ClickUp API directly. The external webhook setting is no longer read or invoked by this route; its historical Settings record is retained for rollback only.

| Button | Provider mutation | Scope |
|---|---|---|
| AWB/address printed (`buton: 1`) | Review customer option named `AWB/address printed` | Every task rendered in the order |
| FINISHED product Printed (`buton: 2`) | Review customer option named `FINISHED product Printed` | Only the task under that button |
| COMPLETE (`buton: 3`) | Actual list status named `complete` | Every task rendered in the order |

Review customer field ID is shared with `task-clickup/panel.ts`. Resolve the exact option ID from the live task rather than hardcoding dropdown positions. The browser cannot supply an arbitrary field, value, status, provider URL or credential. Validate current task ID, ORDER LIST membership and live order reference before writing. Read back the requested value/status and project that verified snapshot into the existing work and webhook-derived caches before reporting success. Already-matching state is verified without another provider write.

Preserve exact-order one-hour HMAC grants, fresh configuration version, private RLS receipts, stable request IDs, bounded retries and maximum three concurrent tasks. Migration `awb_native_clickup_actions` binds new claims to the native API connection revision and invalidates old webhook grants. Ledger triggers serialize per-task AWB, designer and Inbox actions using the existing task advisory lock. Ambiguous writes/readback failures remain unknown and are not automatically resent. `sent` in a native-version AWB receipt means verified ClickUp state and completed projections; historical webhook receipts retain their original delivery-only meaning.

Frontend messaging reports ClickUp updates. Printing, Refresh, Copy, image/PDF retrieval and A4 layout retain their existing separate behavior. Backend retains JWT false with its existing scoped signed POST grant. No new login bypass, customer send, payment or fulfillment command is introduced.

Controlled evidence: `node --experimental-strip-types scripts/check-awb-native.mjs` and existing AWB actions/preview/PDF + task-clickup regressions pass. Tests exercise exact field/status API requests, provider readback/projection, no-op, stale membership, missing options, rejected writes, timeout, 5xx, readback mismatch and duplicate receipts. Native transaction-rollback checks prove scoped claims, concurrency exclusion, stable deduplication, bounded retries, old-grant rejection and private RLS/grants. Full build passes. Hosted Chrome successfully executed Complete on an already-complete exact-order task without another provider write; the native-version receipt is sent/200 with one attempt. This proves live provider read/verification/projection and button transport. Actual field/status transitions were verified with controlled provider transport; physical printer and a fresh live operator transition remain pending.

Historical webhook implementation and prior production evidence remain in Git history before this change.

## Verification

2026-10-08 title copy: VERIFIED in the actual standalone entry with real local Chromium clipboard reads. Exact long titles, Unicode/newlines/literal HTML text, task 17 on sheet 2, keyboard Enter, Refresh, denied-permission retry, desktop/mobile and print/PDF control exclusion pass. Build and existing preview regression pass. PRODUCTION: PR #77 release `a1cc728dcdfa871473f6d2af72be58c2ea89d27c` passed Workers Builds and guard; Cloudflare version `ae7fde23-804c-4333-816f-2e8edf44bb9c`. Hosted Chrome at the exact order URL shows the title icon and a click resolves the clipboard write with Disalin ✓. No relevant app console errors; only extension metadata errors. Native clipboard bytes were verified in local Chromium; the cloud clipboard-read adapter did not expose them. A hard refresh cleared stale HTML after deployment. Screenshot `awb-copy-name-1791391251995.jpg` records the production icon and success status. Browser plugin not available; regular Playwright used for local controlled checks.

2026-10-05 direct-print correction: PR #75 release `506dcf7ae72a122e878636906cb453043fa45ae3` passed Workers Builds and GitHub guard; worker version `87e8e039-530a-4cd1-9933-7d97a9b36d1b`. `awb-preview` v4 is ACTIVE with exact source readback. PRODUCTION browser at the exact order URL shows Print AWB as a button, loading while the PDF is retrieved, then returns from the PDF frame print call without opening a new tab. Existing Print / Save PDF remains separate. Browser logs show only extension metadata errors. Initial stale HTML required a hard refresh after deployment. The cloud browser exposes neither native print dialog (AWB or reference); native popup layout and physical printing are not claimed. Screenshot `awb-direct-live-1791213245194.jpg` records the live toolbar/status.

2026-10-05 original link-based Print AWB: VERIFIED in the real standalone entry with the live response for `261005SQ0C3Y1F` / `14zbjdpktr8` and controlled duplicate/multiple/missing/unsafe-link cases. Desktop/mobile popup destination, Refresh, reference print exclusion and console checks passed. Private RPC grants and request bounds verified live; the one-task lookup took approximately 12ms. `awb-preview` v3 was active and returned the existing AWB PDF. PRODUCTION: PR #74 release `d1b697d` passed Cloudflare Workers Builds and GitHub guard. Worker version `1892364c-bc12-4628-b7d4-5d5a8312f6ce`. Production browser shows Print AWB, one task/design and a separate reference print control; clicking opens `awb_order_14zbjdpktr8.pdf` on the existing S3 URL. No relevant app console errors (only browser-extension metadata errors). Physical printer output was not exercised.

- `node --experimental-strip-types scripts/check-awb-preview.mjs`
- `node --experimental-strip-types scripts/check-awb-pdf.mjs`
- `npm run build`
- Read-only API smoke: order `260924U9ED78FC` => two tasks, image counts 1 and 2; `IC260922-7118` => two tasks, image counts 0 and 1.
- Transactional projection test: newer task membership survives an older out-of-order update; test transaction rolled back.
- Rendered production verification is recorded in CHANGELOG only after observed.

Rollback: remove the index.html route branch to disable frontend access; disable/delete the awb-preview Edge Function for public access. Projection can remain private. Drop only the new trigger to stop derived updates; never alter existing ingest or production workflow triggers.

## SKU below Finished (2026-10-08)

User requested the ClickUp **SKU** custom field beneath each task's Finished button with a one-click copy icon. The field is `short_text`, known ID `34c62cbb-c174-42e8-9c50-8301f68269a8` (exact SKU name fallback for other lists). The private bounded `get_clickup_awb_print_fields(text[])` reads SKU and AWB link together from the latest complete snapshot, preserving the existing indexed per-task lookup and 200-task bound. `get_clickup_awb_links(text[])` is retained unchanged for compatibility. No projection/history backfill or business writes. Removed/missing/non-string SKU returns empty; valid strings preserve original whitespace and characters. Only SKU joins the existing minimal public preview response; raw custom fields remain private.

The screen shows `SKU: <value>` plus Copy SKU below Finished, once per task. Copy writes only the original SKU value (without the label) and reports SKU disalin ✓; clipboard failure restores retry/manual-copy guidance. Blank/whitespace SKU hides the row. SKU/copy remain screen-only inside the existing print-hidden action area. Title copy and webhook actions are preserved; copying never sends a webhook.

VERIFIED: actual standalone entry in local Chromium, desktop 1280×1000 and mobile 390×844, tested exact real clipboard bytes for melody cupcake and Unicode/HTML/newlines/whitespace, task 17 on sheet 2, blank SKU, keyboard, Refresh, denial/retry and original title copy. Print/PDF hides the entire SKU/action area and retains A4; no action POST or app error during copy QA. Browser plugin unavailable, regular Playwright used. Root/Inbox builds and preview/PDF/action regressions pass; changed preview helper passes Deno check. Live private RPC returns melody cupcake for task 14zbjdpktr8, preserves its old AWB URL, deduplicates task IDs, rejects >200 IDs, and has service_role-only execution (anon/authenticated denied). The one-task live query took 3.552 ms. No new security advisor finding for the RPC.

PRODUCTION: PR #79 release `818130dfbef0074d6db76a5b23505e8f5546abf7` passed Workers Builds and GitHub guard; Cloudflare version `642b7957-460b-4b0e-806a-d6c8d1bf6d6f`. `awb-preview` v6 ACTIVE retains JWT false and signed POST grants; all five deployed source files match readback. Safe live GET returns the real SKU and retains the original 57,843-byte PDF. Hosted Chrome at the exact production order URL shows SKU: melody cupcake beneath Finished and Copy SKU resolves with SKU disalin ✓. Native clipboard bytes were verified locally; the cloud clipboard adapter does not expose them. Only browser-extension metadata errors appeared. The initial tab loaded old frontend HTML; reloading after the new deployment became available showed the new controls. Screenshot `awb-sku-copy-1791425360219.jpg` records the production row/icon. The user has configured the private webhook URL; visible actions are enabled, but SKU QA never clicked an action or sent a webhook. SKU changes appear after the existing upstream ClickUp snapshot ingestion and preview Refresh.
