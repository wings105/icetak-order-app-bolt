# Acrylic & Artpaper production

Status: controlled Admin V2 VERIFIED; backend deployed; hosted delivery pending release.

Route: `https://shop.decocake.my/?admin=v2&view=acrylic-production`.
Sidebar: **Production Acrylic**. Existing admin login and owner / view_orders / approve_production access required.

## Operator flow

Default: **Acrylic → Sedia cut**. Material buttons separate Acrylic and Artpaper; colour buttons filter task cards for the material currently loaded. Review and Menunggu design show upcoming work; Semua peringkat combines the three. Each card retains its actual ClickUp Task ID, original task title, order reference, set, colour, size, quantity and due date. Different tasks sharing an Order ID are never collapsed. Search matches title, order, SKU, size and set. Design buttons open a keyboard-accessible zoom dialog and an explicit original image link.

Only CF **job** selections `Acrylic cake topper` and `Artpaper` qualify. Ordinary Cake topper, Edible and Wafer jobs are excluded even at Cake Topper - Printing. Active statuses are `acrylic`, `artpaper`, `review` and `cake topper - printing`; other statuses disappear on the next read. Dual-material jobs appear under Semua material with a review warning.

No task completion, ClickUp write, customer notification or stock consumption is added. Stock remains controlled by canonical fulfillment events.

## Existing raw data path

Existing ClickUp task-update ingestion → `clickup_webhook_events` / `ai_clickup_work_snapshots` and `clickup_awb_preview_tasks` → service-only SECURITY INVOKER `icetak_acrylic_production_snapshot()` → JWT + active-admin checked `acrylic-production` → Admin V2.

The SQL read uses indexed latest complete per-task snapshots to resolve job options by ID/orderindex, task SKU, optional colour/size/quantity fields and due date. Existing work snapshots supply current status/title/order/set. Deleted tasks are suppressed. The existing image projection/helper supplies every current image from the latest captured image-bearing comment, or the latest image attachment. Only approved HTTPS ClickUp image URLs are returned; deleted images are suppressed. Missing images are explicitly shown, never replaced by a marketplace product thumbnail. Upstream must deliver the complete Get Task snapshot and image-comment history as usual; opening this page does not call ClickUp or reconstruct absent history.

A read-only exact-component/marketplace-item fallback supplies canonical order evidence without exposing customer/contact/payment data. Raw ClickUp colour is resolved in priority order: explicit colour field, task title, task SKU. Compound names (Rose Gold, Gold Glitter, Mirror Pink, Light Blue etc.) are matched before simple colours. Multiple colours remain unknown. Only unambiguous order evidence may fill missing colour. Unknown values are never defaulted to Gold. The source is available in the colour tooltip. This projection does not apply Finance SKU override writes or change order facts.

Size/quantity use explicit fields, then task title/SKU and exact item evidence. Missing or conflicting material/colour/size/quantity displays a **Semak sebelum cut** warning. Task title is a work summary, not inferred customer wording.

At most 500 qualifying tasks are returned, with a visible truncation warning if exceeded. No historical backfill, new trigger or scheduled backend job is introduced. Auto refresh is every 60 seconds only while the page is visible, with one request at a time; manual Refresh is available. A failed refresh retains previous cards with a stale-data warning and retry. The UI updates after the usual webhook arrives.

## Verification — 16 October 2026

- Real read returned 13 qualifying tasks: one Cake Topper - Printing, one Review, eleven Acrylic; all current colours Gold. Duplicate order references retain distinct Task IDs. The older Silver task lacks the required job selection and is excluded.
- Source projection, image availability and service-only grants queried live. No current production/review example has a captured image URL; placeholders are expected until upstream supplies the artwork. Snapshot measured approximately 41ms at this cohort size.
- `acrylic-production` v2 ACTIVE with verify_jwt=true. Three-file source/auth readback matches exactly; real anonymous POST is rejected 401. Controlled actual-handler tests prove valid owner/staff, inactive/nonstaff rejection and permission checks; hosted signed-in user request remains unexercised.
- Actual bundled Admin V2 App rendered with live read DTOs and controlled API responses in Chromium 153, desktop 1440×1100 / mobile 390×844. Default stage/counts, stage/material/colour filters, search, duplicate task preservation, compound/unknown colour cases, image zoom/Escape, failed-refresh stale cards and recovery passed. No page errors or mobile overflow. Mixed-colour/Artpaper/image cases use explicitly controlled fixtures because this live cohort has only Gold and no images.
- Root + Inbox build and standalone Admin TypeScript/build passed; production model/gateway, stock gateway and existing AWB image tests passed. Browser plugin unavailable; regular Playwright used. Standard browser download failed; a temporary Chromium runtime from npm supported the controlled rendering checks. A source-dev Vite optimization error in the existing MarketplaceOrders lazy import was avoided by testing the bundled App, matching production bundling.

Commands: `npm run check:acrylic-production`, `npm run check:stock-admin`, `node --experimental-strip-types scripts/check-awb-preview.mjs`, `npm run build`, `npm --prefix icetak-admin run build`.

Rollback: revert the Admin route/sidebar/page and disable the new gateway if necessary. The read-only RPC may remain private; no source records or workflows require reversal.
