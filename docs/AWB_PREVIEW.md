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

Each task title has a small Copy task name button on screen. One click copies the original full task title (including Unicode and line breaks) to the clipboard; Customize Name is not included. A transient Disalin ✓ status confirms success; denied/unavailable clipboard access shows a retry/manual-copy message. Refresh rebinds the controls. Copy buttons and feedback are hidden in print/PDF, retaining the existing A4 layout. No backend or external writes.

Print/Save PDF waits for all images to load, is disabled on image loading failure, and excludes toolbar/status. Missing preview items remain visible and are counted in the toolbar. This is a dynamic HTML page, not a stored PDF or automatic PDF attachment.

Print AWB fetches the matched task PDF, loads a local PDF blob in an offscreen iframe and calls that frame's print action directly. No new PDF tab is opened for the normal flow. The controls show loading and prevent duplicate clicks. Failure restores retry and offers an explicit Buka PDF fallback. A frame is retained until afterprint or the next print request; its object URL is revoked on cleanup. The existing reference Print / Save PDF still prints the current reference page.

The `awb-preview` v4 GET endpoint accepts `awb_task_id` only for a task already matched to the exact `order_id`. PDF retrieval uses the stored field, never a client-supplied URL. Only the existing iCetak S3 bucket or HTTPS ClickUp attachment domains are allowed; credentials, nonstandard ports and redirects are rejected. Bytes are limited to 10 MB, verified as PDF and returned with no-store and existing CORS headers. This avoids the S3 cross-origin restriction while preserving the original PDF bytes, pages and dimensions. No database or business writes.

Direct-print implementation checks: source/PDF failure and byte-limit regression checks; live proxy output byte-equals the original 57,843-byte task PDF and rejects an unrelated task. Controlled real-entry tests with a viewer stand-in cover print target, no new tabs, loading/retry, reference printing and mobile overflow. Hosted Chrome verifies the new button/loading flow, local PDF frame and returned print call with no new tab or relevant app errors. The native dialog itself is not exposed by this cloud browser, including for the existing reference-page print action; popup contents and physical output remain ATTEMPTED/unverified.

## Task action webhook

Owner requested one-click actions without task selection. Header `AWB/address printed` (`buton: 1`) and `COMPLETE` (`buton: 3`) fan out to every distinct task currently rendered. `FINISHED product Printed` (`buton: 2`) appears once beneath each task's image group, including multi-image tasks, and sends that task only. Up to three requests run concurrently. Task actions are separate from printing; all controls/status are excluded from A4/PDF.

Admin V2 Settings → **AWB Preview Actions** → **AWB Preview Action Webhook URL** uses `webhook-forward-settings` kind `awb_preview`. Only an active authenticated owner or an admin with `manage_admins` may get/save it. The setting is stored privately as `awb_preview_action_webhook_url`; the public preview returns availability and a signed grant, never the URL. Missing/blank URL leaves visible actions disabled with a setup hint. Saving a URL does not dispatch any task. Refresh the preview after saving/changing the setting.

Each outbound webhook is one HTTPS POST with exactly `{"buton":1,"task_id_clickup":"<task ID>"}` (buton varies 1/2/3). `buton` spelling is intentional. No order ID, token or URL is added to the webhook JSON. A stable `Idempotency-Key` header is included. The receiver should deduplicate that header and return 2xx once accepted. Success status means webhook acceptance, not proof of downstream ClickUp updates.

The public POST validates a one-hour HMAC grant bound to the exact order, task IDs and configuration version, then rechecks current task membership in the database. Browser-supplied destinations are never used. HTTPS public-domain URLs only, no credentials/IP literals/custom ports/fragments or redirects; 15-second destination timeout. Clearing/changing the setting invalidates earlier grants.

Private RLS/service-role-only `awb_preview_action_deliveries` and SECURITY INVOKER service-only claim/finish RPCs guard duplicate request IDs, pending deliveries, retries and a per-task/action rate limit. Known failed HTTP responses permit up to three attempts using the same ID. Already sent tasks are retained during a bulk retry; only failed tasks retry. Timeout/ambiguous receipts are marked unknown and do not auto-resend: check the automation first. Refresh creates a new manual action session; receipt deduplication is per request ID, not permanent business-status deduplication. Arbitrary external webhook delivery cannot guarantee exactly-once processing without receiver idempotency. No direct order/payment/ClickUp/WhatsApp writes are made by these actions.

2026-10-07 VERIFIED: actual standalone AWB entry in local Chromium exercised two-task header fan-out, per-task Finished scoping, one button per multi-image task, partial failure/retry-only-failed with identical request ID, duplicate click guards, unknown no-resend, unconfigured disabled state, existing clipboard, print/PDF control exclusion and mobile overflow. Actual Admin V2 Settings component exercised get/save/clear, load-error fail-closed retry and staff-hidden field using controlled Edge responses. Edge handler tests prove owner/permission boundary and exact outbound JSON; live transaction-rollback RPC tests prove exact membership, config binding, pending/sent dedup, stale/unknown no-resend, failed retry limits and private grants. Test receipts remain zero and production URL remains unconfigured. Root/Admin builds and existing AWB/PDF, WhatsApp opt-out/order-forward regressions pass. Deno check passes for new action/URL helpers; full entrypoint Deno check is blocked by esm.sh connection refusal in the local runtime. Browser plugin unavailable; regular Playwright used for controlled QA. Real destination delivery and authenticated hosted Settings session await a configured owner URL; no external webhook was sent during testing.

Rollback: clear the AWB Preview Action Webhook URL in Settings to disable actions and invalidate current page grants. Keep the private delivery receipts for audit. Reverting frontend/actions and restoring earlier Edge source is also possible; preserve current JWT modes and the existing print/reference behavior.

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
