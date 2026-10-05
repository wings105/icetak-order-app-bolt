# AWB order reference preview

Route: `https://shop.decocake.my/?awbpreview=<ORDER ID / customer name>`.

Owner-approved public internal print reference. Exact custom-field order ID lookup; no login, AI, generation job, or Activepieces round trip on page open. The page returns task ID, title, Customize Name, set, image URLs and the task's AWB PDF link. Raw payloads, prices and credentials are not exposed. The AWB document itself contains delivery details and is accessed through its existing link.

## Data

`clickup_webhook_events` insert -> `capture_clickup_awb_preview` trigger -> private/RLS-enabled `clickup_awb_preview_tasks` projection -> public `awb-preview` Edge Function -> standalone frontend entry.

The migration seeds the derived cache from existing raw events without modifying orders, webhook history, ClickUp, payment or notification state. Subsequent full task snapshots update order membership/title/set/attachments only if their task timestamp is not older. Image comments update independently by comment timestamp. Moving a task to another order ID removes it from the old preview.

Image rule: every image in the latest image-bearing comment, preserving comment order. Text/PDF-only comments retain the last image comment. Duplicate URLs are removed. Deleted attachments in the current full snapshot are suppressed. Without captured image-comment history, show the latest image attachment only; historical attachment lists cannot reliably identify a multi-image revision. No AI classification or image downloads/proxying. Only HTTPS ClickUp attachment URLs are returned. Comment deletion events without a revised full image comment are not reconstructed from ClickUp history.

The upstream Get Task snapshot is required to include custom_fields and attachments. Updates are visible after the existing ingestion flow receives them and the page is opened/refreshed.

AWB links come from `AWB link` (field ID `8a8589f6-5a80-493c-902b-0ed8da4584be`) in each matched task's latest complete webhook snapshot. The service-only `get_clickup_awb_links(text[])` RPC performs at most 200 indexed per-task lookups using the existing full-snapshot index. It performs no history scan, backfill or business-record writes. Empty/removed fields remain empty; HTTPS URLs without embedded credentials only are returned. Duplicate links across tasks are shown once. Different links get numbered Print AWB controls.

## Layout

One task per cell, 4x4 grid, up to 16 tasks per A4 sheet. More tasks produce another A4. Multiple images share the task quadrant. Wrapped task title followed by the Customize Name value (omitted when empty), image contain sizing, 10mm sheet padding and 3mm grid gaps. Empty set is accepted; numeric sets sort first. Missing images show `Preview belum ada`.

Print/Save PDF waits for all images to load, is disabled on image loading failure, and excludes toolbar/status. Missing preview items remain visible and are counted in the toolbar. This is a dynamic HTML page, not a stored PDF or automatic PDF attachment.

Print AWB fetches the matched task PDF, loads a local PDF blob in an offscreen iframe and calls that frame's print action directly. No new PDF tab is opened for the normal flow. The controls show loading and prevent duplicate clicks. Failure restores retry and offers an explicit Buka PDF fallback. A frame is retained until afterprint or the next print request; its object URL is revoked on cleanup. The existing reference Print / Save PDF still prints the current reference page.

The `awb-preview` v4 GET endpoint accepts `awb_task_id` only for a task already matched to the exact `order_id`. PDF retrieval uses the stored field, never a client-supplied URL. Only the existing iCetak S3 bucket or HTTPS ClickUp attachment domains are allowed; credentials, nonstandard ports and redirects are rejected. Bytes are limited to 10 MB, verified as PDF and returned with no-store and existing CORS headers. This avoids the S3 cross-origin restriction while preserving the original PDF bytes, pages and dimensions. No database or business writes.

Direct-print implementation checks: source/PDF failure and byte-limit regression checks; live proxy output byte-equals the original 57,843-byte task PDF and rejects an unrelated task. Controlled real-entry tests with a viewer stand-in cover print target, no new tabs, loading/retry, reference printing and mobile overflow. Hosted Chrome verifies the new button/loading flow, local PDF frame and returned print call with no new tab or relevant app errors. The native dialog itself is not exposed by this cloud browser, including for the existing reference-page print action; popup contents and physical output remain ATTEMPTED/unverified.

## Verification

2026-10-05 direct-print correction: PR #75 release `506dcf7ae72a122e878636906cb453043fa45ae3` passed Workers Builds and GitHub guard; worker version `87e8e039-530a-4cd1-9933-7d97a9b36d1b`. `awb-preview` v4 is ACTIVE with exact source readback. PRODUCTION browser at the exact order URL shows Print AWB as a button, loading while the PDF is retrieved, then returns from the PDF frame print call without opening a new tab. Existing Print / Save PDF remains separate. Browser logs show only extension metadata errors. Initial stale HTML required a hard refresh after deployment. The cloud browser exposes neither native print dialog (AWB or reference); native popup layout and physical printing are not claimed. Screenshot `awb-direct-live-1791213245194.jpg` records the live toolbar/status.

2026-10-05 original link-based Print AWB: VERIFIED in the real standalone entry with the live response for `261005SQ0C3Y1F` / `14zbjdpktr8` and controlled duplicate/multiple/missing/unsafe-link cases. Desktop/mobile popup destination, Refresh, reference print exclusion and console checks passed. Private RPC grants and request bounds verified live; the one-task lookup took approximately 12ms. `awb-preview` v3 was active and returned the existing AWB PDF. PRODUCTION: PR #74 release `d1b697d` passed Cloudflare Workers Builds and GitHub guard. Worker version `1892364c-bc12-4628-b7d4-5d5a8312f6ce`. Production browser shows Print AWB, one task/design and a separate reference print control; clicking opens `awb_order_14zbjdpktr8.pdf` on the existing S3 URL. No relevant app console errors (only browser-extension metadata errors). Physical printer output was not exercised.

- `node --experimental-strip-types scripts/check-awb-preview.mjs`
- `node --experimental-strip-types scripts/check-awb-pdf.mjs`
- `npm run build`
- Read-only API smoke: order `260924U9ED78FC` => two tasks, image counts 1 and 2; `IC260922-7118` => two tasks, image counts 0 and 1.
- Transactional projection test: newer task membership survives an older out-of-order update; test transaction rolled back.
- Rendered production verification is recorded in CHANGELOG only after observed.

Rollback: remove the index.html route branch to disable frontend access; disable/delete the awb-preview Edge Function for public access. Projection can remain private. Drop only the new trigger to stop derived updates; never alter existing ingest or production workflow triggers.
