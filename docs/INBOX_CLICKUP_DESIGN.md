# Inbox design → ClickUp — 23 October 2026

Backend PRODUCTION; full built Inbox desktop/mobile controlled behavior VERIFIED. Hosted release proof belongs in the release PR. Authenticated hosted staff mutations remain unexercised.

## Staff flow

The existing Order sidebar opens **Design · ClickUp** above order details. Conversation Workspace offers the same collapsible section above its tabs, using actual linked order summaries. Multiple orders and multiple tasks require explicit selection; a single task is selected automatically. Each task retains its exact title, identity and ClickUp link. The Order sidebar's source badge distinguishes Decocake from Shopee.

Click the paste area and Ctrl+V an image, drop a file or choose PNG/JPG/WebP/PDF up to 15 MiB. Preview shows received pixel dimensions and file size. Add an optional note, then **POST ke ClickUp**. The backend uploads actual unchanged bytes as a task attachment, adds a comment containing the attachment link and staff label, then verifies both against ClickUp. This does not claim an inline image comment identical to ClickUp's native paste editor.

Status options/revision come from live ClickUp. **Tukar status** is independent from uploading and compares the provider revision before writing. Successful readback passes through the existing source projection and order→Inbox sync worker. The selected header and order list refresh after the result. Failed cache synchronization is explicit; the existing durable sync still retries. No upload alone implies printing, shipment or completion.

Tasks moved/archived after completion remain readable with attachments, but their write controls are disabled. Status readback/reconciliation can observe a completed task moved by an external automation without mistaking successful completion for a failed request. New writes require the task still be active in ORDER LIST `18375902`.

## Storage and uncertain delivery

Images exist only in browser memory and bounded request memory on the two gateways. This path never calls Supabase Storage or stores image/base64 bytes in Postgres. The separate Admin Task Workspace draft-upload flow retains its existing private Storage contract; it is not silently changed.

The browser stores only pending request/task/order IDs locally. Unsaved drafts guard order/chat/page/sidebar/logout navigation and page unload; refresh intentionally cannot preserve unsent image bytes. A lost response retains the receipt and **Semak penghantaran**. Request-specific filenames find an attachment whose response was lost; unique comment markers find a comment whose response was lost. A verified attachment with no comment dispatch, or a definitively rejected comment, allows an explicit **Sambung komen** without uploading the file again. An uncertain dispatched comment is never blindly resent. Failed receipt reads preserve the prior receipt and pending UI; a rate-limited verification GET cannot mark an earlier uploaded attachment as rejected. Comments use real line breaks between the note, file link and staff label.

Service-only `inbox_clickup_actions` receipts contain actor/context, SHA-256 file metadata, note, steps and provider IDs/URLs, not binary files. A request ID is bound to its exact payload and actor/context; identical payload replays do not upload again. Per-task claims share the existing Admin advisory lock and processing guard. Completion of one transport step does not falsely mark the whole action successful.

## Ownership and auth

- Inbox `inbox-task-clickup` v1 retains platform JWT verification, verifies Auth identity and actual active workspace membership. Owner/admin/designer/production/support may write; viewer is read-only. Browser role/actor/canonical ID/token/URL fields cannot choose trusted facts.
- A selected summary is read under staff JWT/RLS and must be a canonical iCetak summary. Conversation-based access additionally requires its current exact order link. The gateway derives the canonical ID/channel and forwards only whitelisted input to the private Order gateway.
- Order `inbox-task-clickup-bridge` v4 requires the existing private `x-admin-window-token`; its mandatory server authentication replaces platform JWT. Exact `ai_order_work_source` order/task identity is checked before provider actions. The configured `clickup_designer_api_token` stays solely in Order private runtime settings.
- Migration `20261022192847_inbox_clickup_direct_actions` adds private RLS receipts, service-only invoker claim/resume RPCs and a narrow cross-ledger guard in the existing Admin claim. Public/anon/authenticated table and RPC access is revoked. Existing migrations, canonical financial/fulfillment ownership, provider outbox and customer sends are unchanged.

## Verification

- `npm run check:inbox-clickup`: 27 actual gateway/provider flows cover private/staff/viewer authorization, exact task and server-derived identity, bounded bodies/file signatures, unchanged upload bytes, moved-task read-only behavior, provider revision checks, source/cache sync, replay/conflicts and lost/partial response recovery. Included in production CI.
- `backend/inbox/clickup-direct-actions.test.sql`: native service-role claim/replay/conflict/task-binding/cross-Admin lock/one-time resume and revoked client privileges pass in rollback, retaining zero QA receipts. Existing task-clickup tests and 79 header/182 active-order policy checks remain required.
- Actual deployed private gateway reads a real exact linked Shopee task and 15 live status options. Deployed source/auth readback matches the release. The only new security-advisor finding is expected INFO for the service-only RLS table without client policies.
- The owner's existing sample task `14zbjdpnmt1` received exactly one ASCII PDF attachment `ca7e359c-172c-44df-a744-c54622cb022e.pdf` and one linked comment `1301120000144590`, verified through direct ClickUp API calls using the stored internal token. Its completed status and moved-list location were preserved. This proves actual upstream file/comment transport, not a hosted authenticated Inbox mutation. No customer task/status/message was changed for this check.
- Full actual built Inbox at 1440×1000 and 390×844 passes native clipboard PNG (900×620 pixels), preview/original bytes through actual gateway handlers with controlled transports, multi-task choice, POST, status/header refresh, partial/unknown/reload recovery, unsaved close protection, viewer denial, both sidebars and White/Black themes. Zero page errors or unexpected mutations. The real mobile logout/Close overlap was corrected by putting the full-screen sidebar above global controls. Browser plugin unavailable; existing regular Playwright/disposable Chromium was used with synthetic local-only auth and intercepted external traffic.

Full production build/Inbox typecheck and hosted asset/build/login verification are separate release gates. No real staff session or customer send is inferred from controlled QA or provider transport tests.
