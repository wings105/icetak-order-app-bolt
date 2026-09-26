# AWB order reference preview

Route: `https://shop.decocake.my/?awbpreview=<ORDER ID / customer name>`.

Owner-approved public internal print reference. Exact custom-field order ID lookup; no login, AI, generation job, or Activepieces round trip on page open. The page returns only task ID, title, set and image URLs. Raw payloads, contact details, prices and credentials are not exposed.

## Data

`clickup_webhook_events` insert -> `capture_clickup_awb_preview` trigger -> private/RLS-enabled `clickup_awb_preview_tasks` projection -> public `awb-preview` Edge Function -> standalone frontend entry.

The migration seeds the derived cache from existing raw events without modifying orders, webhook history, ClickUp, payment or notification state. Subsequent full task snapshots update order membership/title/set/attachments only if their task timestamp is not older. Image comments update independently by comment timestamp. Moving a task to another order ID removes it from the old preview.

Image rule: every image in the latest image-bearing comment, preserving comment order. Text/PDF-only comments retain the last image comment. Duplicate URLs are removed. Deleted attachments in the current full snapshot are suppressed. Without captured image-comment history, show the latest image attachment only; historical attachment lists cannot reliably identify a multi-image revision. No AI classification or image downloads/proxying. Only HTTPS ClickUp attachment URLs are returned. Comment deletion events without a revised full image comment are not reconstructed from ClickUp history.

The upstream Get Task snapshot is required to include custom_fields and attachments. Updates are visible after the existing ingestion flow receives them and the page is opened/refreshed.

## Layout

One task per A4 quadrant (A6 allocation), 2x2 grid, up to four tasks per sheet. More tasks produce another A4. Multiple images share the task quadrant. Wrapped titles, image contain sizing, 10mm sheet padding and 6mm grid gaps match the approved sample. Empty set is accepted; numeric sets sort first. Missing images show `Preview belum ada`.

Print/Save PDF waits for all images to load, is disabled on image loading failure, and excludes toolbar/status. Missing preview items remain visible and are counted in the toolbar. This is a dynamic HTML page, not a stored PDF or automatic PDF attachment.

## Verification

- `node --experimental-strip-types scripts/check-awb-preview.mjs`
- `npm run build`
- Read-only API smoke: order `260924U9ED78FC` => two tasks, image counts 1 and 2; `IC260922-7118` => two tasks, image counts 0 and 1.
- Transactional projection test: newer task membership survives an older out-of-order update; test transaction rolled back.
- Rendered production verification is recorded in CHANGELOG only after observed.

Rollback: remove the index.html route branch to disable frontend access; disable/delete the awb-preview Edge Function for public access. Projection can remain private. Drop only the new trigger to stop derived updates; never alter existing ingest or production workflow triggers.
