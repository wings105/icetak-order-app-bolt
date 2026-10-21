# Task design desk — 21 October 2026

Status: backend and hosted delivery PRODUCTION; controlled desktop/mobile UI VERIFIED. Real signed-in staff use and native Photoshop paste remain unexercised.

The owner needs enough trustworthy material to start Photoshop from one task. The existing Task Workspace list opens a wide design desk with a task queue, a read-first brief and an original-message panel. It is not a replacement ERP or a new customer Inbox.

## What the designer sees

- Exact task/set and known SKU, product, quantity, size, shape, material and colour. Unknown values remain unknown; no new inferred product defaults.
- Copyable wording with original line breaks, customer instructions and per-field source controls. Source controls reveal/highlight the original message or checkout/task note.
- Original scoped Shopee and WhatsApp messages together, including seller replies for context, channel/time, original checkout note and task customization. Multi-item order context is explicitly separate from the assigned per-item brief.
- Customer reference/selected artwork, a unique exact-SKU or exact purchased-item product example, ClickUp images and native work files. Known payment/order screenshots are labelled in the timeline and excluded from the materials gallery. A preview is never silently chosen as a production final.
- Image zoom, available pixel dimensions, original download and real PNG clipboard copy at native resolution. Browser clipboard permission/support may require original download; no AI image transformation or upscaling is used. Original format/bytes are preserved for download; clipboard conversion to PNG preserves pixel dimensions.
- Collapsed correction/final-file/QC controls, paste/drop/upload of design output, native PIC/notes and explicit production handoff preview. Final file/QC/customer approval requirements remain as before.
- Direct task URLs use `?admin=v2&view=task-workspace&task=TASK_ID`. Mobile separates brief/materials and messages into tabs; desktop keeps them beside each other.

## Data and security

`task-workspace` adds a detail-only `dossier` DTO. It uses the same server-derived exact order/session context, with unusable bindings, history and outside-boundary messages removed again before serialization. No generic chat is automatically assigned to multi-item tasks. The list does not receive full messages or initiate original downloads. The existing 120-message/binding and 2,000-character source-read bounds remain visible; missing/unmatched/failed/truncated reads are not proof that a customer supplied nothing.

`asset` accepts only a current task ID and asset ID; the gateway re-reads authorized task evidence and derives the URL. HTTPS media hosts, redirects, binary signatures, time and 15 MB download limits are checked. No arbitrary client URL is accepted. Private cached files are signed server-side. A changing signed URL does not change design evidence, and outbound-only media signing is separate from the readiness fingerprint.

When a selected task needs an uncached WhatsApp image, private `task-brief-media` can prepare up to four originals, prioritizing requested/customer images. It calls the existing `wasapflow-media` downloader over the existing private bridge token; regular Inbox JWT auth remains supported. Exact message raw payload lookup avoids the previous latest-100-webhook limitation. Successful originals enter the existing private cache; repeated ready reads reuse it, and failed downloads have a five-minute cooldown. Opening a task or pressing Muat original may write media-cache state; it never sends a message, marks a chat read, or changes canonical orders/payments/ClickUp/stock. The task-detail background worker continues using the read-only signer, without provider media fetches.

Native `handoff` checks current print-ready brief/fingerprint, explicit final/QC and correct product queue before calling the existing private versioned save RPC. It records the authenticated actor, selected existing PIC (or unassigned queue), stage and note using existing audit/idempotency. It does not send to Marul or upload/update ClickUp. No active staff account is currently labelled Marul, and there is no configured result-upload adapter. Those integrations are shown as unavailable, never as a successful external handoff. Physical stock/fulfillment remains separately owned.

## Evidence

- Full actual Admin App and actual task gateway with 57 live-source tasks plus a synthetic design case; 57 live-source detail replays produced 1,020 scoped message appearances across tasks with zero mutations. Repeated appearances belong to separate tasks sharing an order; this is not a count of unique messages.
- Playwright (Browser plugin unavailable), 1700×1000 and 390×844: wording clipboard readback, uncached-original recovery/preview, PNG clipboard readback at 900×900, byte-identical original download, exact-message source highlighting and filter reset, product/customer/receipt separation, upload → final/QC → confirmation → native Printing handoff, unsaved-close/stale-409 input preservation, failed-refresh retention/retry, direct task link and viewer write denial. Zero page errors. Injected HTTP 409/503 and unavailable fixture Realtime network warnings are expected test conditions.
- `check:task-workspace`, `check:task-readiness`, `check:detail-automation`, `check:task-design`, Admin TypeScript/build and root storefront/Inbox builds pass. Tests cover original session boundaries, task asset ownership/auth, SSRF/redirect/signature/size limits, private bridge versus original JWT auth, bounded prepare/cache/cooldown and idempotent production handoff.
- Live Order gateway v18, Inbox task-brief-media v4 and wasapflow-media v9 preserve their previous auth modes. Deployment source bundles were read back exactly. Anonymous Order gateway access returns 401.
- Actual private Order→Inbox prepare recovered one queued, in-scope customer image into ready cache; its signed original downloaded as JPEG, 591×1280, 135,294 bytes. No historical mass recovery or customer/order/payment/task/provider-send mutation was performed.
- Existing detail worker remains enabled; the observed latest run processed 54 tasks, failed 0.

Not verified: a real signed-in staff operation on hosted production, native Photoshop paste on the owner's Windows PC, or external ClickUp/Marul delivery. Hosted runtime controls can be verified using an isolated synthetic session without changing real customer records.

## Release / rollback

PR #106 merged to production as `b77aa19b442f425ad0389e4cb698372a33a399ac`, with the exact tested source tree `130fb2d21b64b01d7c8b5201a63349b06e446e59`. Feature Workers Build `749b3db6-772b-493e-830f-5cbd6672a8fa`, production Workers Build `beffb403-9418-4635-977b-8ea37b006a18` and both GitHub guards succeeded.

The actual hosted route serves `main-DHmLvMNe.js → admin-v2-route-B1XE40ZQ.js → App-FZvqu4uN.js → TaskWorkspace-CZG2Rxin.js`. Task Workspace JS matches the tested production build after normalizing import/chunk hashes; `TaskWorkspace-DwCgU9LA.css` is byte-identical. All seven brief/message/image/download/recovery/task-link/handoff labels are present. A cloud browser at the exact route renders Secure Admin Login without an app error; the known extension-metadata error and multiple-GoTrue-client warning remain. This verifies hosted delivery, not a real staff mutation. Revert frontend files and the Order gateway bundle to restore the prior drawer; retain native files and media cache. Revert Inbox media bundles if original recovery must be disabled; neither rollback requires deleting customer or production records.
