# Conversation header lifecycle — 23 October 2026

Backend PRODUCTION; full Inbox controlled desktop/mobile UI VERIFIED. Hosted delivery proof is recorded in the release PR. Real hosted staff actions remain unexercised.

## Presentation and meaning

One compact icon/text badge sits beside the header actions; mobile gives the badge and actions their own row so the customer name and complete status remain readable. Clicking opens a nonmodal popover with exact order reference, payment record/balance, item summary, source task titles/statuses and safe order/ClickUp links, tracking and sync/check times in Malaysia. Escape, outside click and Close dismiss it. Existing reply/unread/urgent/archive/window/sidebar actions remain available. White and Black themes are supported.

Prospects use Survey, Berminat, Tunggu Confirm and Tak Jadi. Rules use current customer text and explicit human-seller quotation/confirmation requests; generic price questions and silent customers do not imply commitment or lost sales. Staff can select/reset the prospect stage in the popover. That choice is scoped to the canonical session boundary/chat episode and invalidated by a later explicit purchase request. Actual orders/drafts take precedence over prospect choices. Viewers can read an existing choice but cannot change it. Classification is deterministic; no new generative API/key or customer message is introduced.

Real order labels include Draft, Belum Bayar, Belum Design, Tunggu Review, Perlu Edit, Printing, Dah Print · Belum Ship, Task Siap · Belum Ship, Sedia Ambil, Dihantar, Selesai, Proses Batal, Batal, Return / Refund and Semak Status. Cash counter/COD can retain operational progress before full cash collection. Canonical fulfillment/cancellation/return facts precede source work status. Task complete never independently implies shipped or order completed. Printing, print alamat and ready-stock stages stay distinct from explicit completed tasks and do not prove physical printing finished. Dah Print requires an explicit printed/finished-print status; no new physical-print confirmation workflow is added.

Latest task identity wins, cancelled tasks leave the denominator and all-cancelled/empty/unknown work remains Semak Status. Mixed work shows the remaining action plus completed/total task count. An unfinished design or requested edit stays visible even with completed siblings. Multiple current linked orders retain separate facts and an extra-order count. A completed old primary cannot hide a newer unfinished order. Historical orders are separately expandable in the popover (up to five); the full existing sidebar remains available.

## Source and session boundary

The browser submits only the selected conversation ID and, for an explicit prospect edit, the current scope/stage. Inbox RPC reads actual links, strong buyer-ID/unique-phone candidates and the latest 50 bounded messages under staff authentication/RLS. Username-only guessing, client-supplied order/status facts and unrelated historic primary orders cannot choose the badge. Missing links, identity ambiguity, candidate overflow or unavailable dependencies remain Semak Status.

A private Order System read bridge reuses `icetak_ai_dashboard_context` with the exact conversation and no phone/master fallback for the draft session. It reads bounded `ai_order_work_source` tasks for trusted canonical IDs, returning only source task labels/statuses/links/times plus canonical order creation timestamps. Inbox cache IDs and canonical IDs are explicitly separate: both channels use `external_order_summaries.order_system_order_id`, with the channel selecting the canonical table. Direct cached summaries lack placed_at; the exact canonical created_at supplies the session comparison. No cache/source backfill is performed.

A fresh canonical session or explicit later purchase separates repeat-customer enquiries from older purchases. Existing shipped-order follow-ups/acknowledgements can still show the linked shipment. Order-only Inbox conversations use the existing authenticated summary and equivalent pure policy, without an invalid UUID conversation subscription.

## Runtime and security

- Inbox `conversation-lifecycle` v4: platform JWT on; source RPC checks active workspace membership using real owner/admin/designer/production/support/viewer roles. Existing staff-profile bootstrap is reused only when needed; inactive membership remains denied.
- Order `conversation-lifecycle-context` v2: private server-to-server `x-admin-window-token`, no browser key exposure; read-only bounded context/work requests. Its own mandatory authentication replaces platform JWT for this private endpoint.
- Inbox migration `20261022175236_inbox_conversation_lifecycle`: scoped prospect choice with RLS, invoker read/write RPCs and anonymous denial. The write accepts only prospect values/reset and records actor/time; it cannot modify fulfillment/payment/tasks. Follow-up `20261022180228_inbox_header_canonical_identity` adds the explicit canonical/cache identity field without rewriting the first migration.
- Authenticated source reads and explicit saves preserve existing cross-project ownership. Existing bridge functions, provider tasks, canonical order/payment/stock/session records and outgoing messages are unchanged.
- Only the selected conversation is loaded. Evidence changes debounce requests; selected link/prospect/order events refresh it and visible tabs check every minute/on return. Generation guards reject obsolete selection, refresh and save responses. Errors offer retry and never masquerade as Survey/no order.

## Verification

- `npm run check:conversation-lifecycle`: 76 meaningful policy/gateway checks cover source task stages, terminal precedence, mixed progress, generic/committed enquiries, current-session manual choices/reset, repeat purchases, old completed primary, drafts, identity/missing/truncated uncertainty, viewer display, canonical/cache timestamp handoff and ignored client facts/auth/write boundaries.
- `backend/inbox/conversation-lifecycle.test.sql` runs/rolls back fixtures as authenticated support/viewer/nonmember/inactive identities. It proves exact links/canonical IDs, lean redaction, saved/reset prospect states, viewer/nonmember/inactive and anonymous denial. No fixture rows remain.
- The deployed private bridge successfully reads an actual draft and real source tasks with canonical timestamps. A separate cache-ID request proves the canonical ID maps back to the requested cache identity. Deployed source and auth readback match the release. Security/performance advisor findings remain unchanged.
- Existing 182 Inbox eligibility/category/design/deadline checks, Inbox typecheck and complete shop/Admin/Inbox build pass.
- Actual full built Inbox at 1440×1000 and 390×844 passes Survey/manual/automatic reset, quotation confirmation, draft, mixed task titles and progress, printing/complete-before-ship, Shopee shipment, repeat purchase with expandable history, cancellation/pickup/return, failure retry, obsolete-request rejection, keyboard dismissal, readable mobile header/popover and both themes. Zero page errors or unexpected mutations; explicit prospect saves are intercepted local fixtures only. Browser plugin was unavailable; regular Playwright used disposable Chromium with an isolated synthetic local session. No production dependency was added.

Production delivery must separately confirm the merged tested Git tree, Cloudflare production build, served Inbox asset identity and staff login gate. This is distinct from a real staff session/action test.
