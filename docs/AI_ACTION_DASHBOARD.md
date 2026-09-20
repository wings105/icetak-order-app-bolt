# AI Action Dashboard — Admin v2

Route: `?admin=v2&view=ai-dashboard`. Source branch: `production`.

## Ownership and deployment

- Order System `buivecgahhmrhlmfujgt`: authenticated `admin-ai-dashboard` gateway, canonical CRM/order/payment/shipping/session reads, `ai_dashboard_reviews` and append-only `ai_dashboard_events`.
- Unified Inbox `uujcqcsfghqkukaydruc`: messages remain in place. `ai-dashboard-bridge` exposes bounded reads, optional gte-small semantic hints and explicit WhatsApp API sends to the authenticated Order gateway.
- Bridge uses the existing private `admin_window_bridge_token`. No credential is sent to the browser.
- Deploy files under `supabase/inbox-functions/` and `supabase/inbox-migrations/` to Inbox ONLY. Root `supabase/functions/admin-ai-dashboard` and root migrations target Order System.
- Frontend code stays in `icetak-admin/`; Cloudflare's existing production build publishes it. No Bolt Inbox UI dependency is introduced.

## Behavior

The board loads 30 recent conversations per page, including legacy `needs_reply=false` and archived conversations. Filters/counts/priority sorting apply to loaded cards, explicitly labelled in the UI. Search is by name/username/phone/external identity. Load more to inspect older conversations.

Intent is separate from order, payment and action state. Phase-one analysis uses conservative rules and optional existing Supabase gte-small semantic prototypes. Response drafts are editable SOP templates, NOT unrestricted generative replies. Confidence labels describe evidence sufficiency; they are not calibrated probability or auto-send permission. Images/audio are shown for admin inspection, not interpreted by this version.

CRM matching requires unambiguous canonical master/phone/Shopee user ID. Multiple masters fail closed. Related orders are context only; only an explicit matching order reference in the recent customer text is labelled as the referenced order. COD, missing details and incomplete external outbound visibility are not treated as proof of payment or resolution.

Draft boundaries come from the existing `icetak_order_session_context`. No draft or real order is auto-created. Admin opens the existing Draft Orders workflow. After-sales questions remain visible even when the order session is closed.

## Review and reply controls

- Owner/manage_admins/manage_customers may write; view_customers may read.
- Save response/category/note, snooze 24h, mark manually replied, resolve or reopen.
- Manual open/copy never records a send. A separate explicit confirmation records the admin's statement that they replied externally.
- A changed inbound revision reopens the card; generic outbound automation never resolves it.
- Review writes use optimistic version checks, transaction locks, idempotency keys and an audit record. Stale message revisions must be refreshed before action.
- WhatsApp API requires explicit confirmation, current provider window, enabled global send setting, unambiguous identity, no related order opt-out and a durable send claim. No automatic API sends occur on load/analysis/save.
- Provider timeouts/missing message IDs are `unknown`; no automatic retry. An operator must reconcile the provider chat and ledger before allowing a new attempt. Do not blindly clear an unknown/sending ledger entry.
- Shopee API adapter is not configured; use copy + Seller Chat and search username. No claim that a Shopee API message was sent is made.

## Verification

Implementation checks: `npm run build`, Admin TypeScript check, `npm run check:ai-dashboard` (Node 22+ with type stripping).

Backend smoke: internal authenticated bridge returned actual Shopee messages and provider capability flags; gte-small returned semantic matches. Canonical RPC matched the existing Make phone mapping and returned marketplace details. Transactional rollback tests verify review audit/idempotency/stale rejection/snooze preservation. Anon/authenticated direct RPC execution is denied.

Release status before frontend smoke: backend read contract VERIFIED; frontend implementation ATTEMPTED until opened on the deployed admin surface. No real customer message was sent during development tests.

## Deferred scope

30k ClickUp CRM import is explicitly deferred by the owner. Fully generative response drafting, image understanding, learned SOP promotion, autonomous replies and Shopee API activation are not enabled by this release. Admin corrections are retained for later learning review and never automatically promoted into policy.

## Conversation workspace upgrade (2026-09-19)

Status: PRODUCTION — verified on the authenticated live Admin surface at 1363×936. Build and Admin TypeScript checks passed. Browser checks proved Shopee/WhatsApp conversation loading, search (1/16 matching messages), sender filter (8/20 outbound), loaded Shopee image preview, quoted note draft, unsaved-switch cancel/discard, order/payment context and order-ID clipboard equality. No customer message or review mutation was submitted. Mobile breakpoints are implemented but not device-tested. Browser extension metadata errors were unrelated to application code.

Opening Semak now offers Conversation, Order & CRM and Semakan AI tabs, with a customer rail and independent chat/review scrolling. The reader sorts the existing bounded 100-message detail chronologically, groups by Malaysia calendar date, displays session boundaries, supports text search/direction/media filters, safe HTTPS links, attachment previews, message copying and quoted admin notes. Mobile uses tabs to keep reading usable. No backend or database contract changes.

Switching customer with unsaved edits requires explicit discard; refresh is disabled during editing. Failed detail loads disable mutation controls and clear previous-customer draft state. Opening, reading, copying or quoting never records a customer reply or resolves an issue. Existing guarded send/review APIs are retained. Generic seller/automation messages are labelled without asserting human authorship or successful resolution.

Limitations: only messages already ingested and the latest 100 are displayed; no complete historical synchronization or automatic external reply detection is claimed. Suggestions remain editable SOP templates, not a newly configured generative model. No real customer message was sent in upgrade tests.

## Inline workspace, order stages and conversation learning (2026-09-20 MYT)

Status: PRODUCTION for the rendered conversation/order/prefill surface. Release code: `3a4fe953004f3af3cdd6e46cacce32a431223148`; Order gateway `admin-ai-dashboard` v3. Cloudflare Workers and repository guard passed.

- Conversation is now the default view inside Admin V2. Card and List remain available. Besarkan expands the workspace; customer rail, conversation timeline and context panel scroll independently.
- The context panel switches between Order and AI & latihan. Order filters distinguish To Ship, Shipping, Delivered, Completed, Unpaid, Pickup, Processing, Cancelled and Return / issue using explicit known source states. Completed alone is not treated as courier delivery evidence. Active states sort before completed history; the existing context read remains bounded to eight recent orders per source.
- Order cards retain source/payment state, amount, ship-by, item/SKU and shipment details. Unknown states remain unknown; COD/tunai requires receipt review.
- Both `whatsapp://send?phone=...&text=...` and `https://wa.me/...?...text=...` use the current edited suggestion. Header phone links also prefill it. Opening a link does not send or mark replied. A mapped phone may also be used from a Shopee customer; Seller Chat remains available.
- AI confidence is qualitative evidence sufficiency, not measured accuracy. Expand evidence/boundaries to inspect identity, message evidence, exact order reference and missing information. Auto-send remains OFF.
- Conversation training is isolated from QRPay/draft learning. `ai_dashboard_training` stores server-derived evidence/SOP baseline, corrected response, verdict, lesson, optional generic reusable response, engine/confidence and actor. `ai_dashboard_training_events` keeps capture/approval/rejection audit history.
- Manage Customers can capture examples. Only owner/manage_admins can approve a generic SOP or deactivate it. Approved examples are retrieved by channel and intent and applied only by an explicit “Gunakan sebagai draf” click. No automatic model retraining, customer-specific fact reuse or autonomous sending is enabled.
- Training has service-only table/RPC access, request-id conflict/retry handling and optimistic version checks. Existing chat/review revision guards also apply. Unsaved reply/note/training inputs participate in customer-switch/refresh protection.
- Migration file was created by Supabase CLI 2.117.0: `20260919163125_ai_dashboard_conversation_training.sql`. The management migration application recorded equivalent SQL as version `20260919163225` (`ai_dashboard_conversation_training`). Do not reapply it merely because the execution timestamp differs.

### Verification evidence and limits

Authenticated production browser at 1363×936 proved default inline layout, expand control, real Shopee timeline, To Ship filter (one matching order), Completed filter (one historical order), and visible AI composer/training form. Both WhatsApp hrefs were inspected with an edited multiline draft containing ampersand, plus and emoji; encoding preserved the text. No external WhatsApp links were followed and no customer message was sent. Unsaved-switch warning and cancellation were exercised; training input and capture-button enablement were observed without saving a fake customer correction.

Nine source-status regression cases and the root production build/Admin TypeScript checks passed. An isolated gateway harness proved read-only denial, stale-chat rejection, invalid-input rejection, owner-only approval and server-derived actor. Live SQL in a rolled-back transaction proved capture, exact retry, conflicting request rejection, approval, stale-version rejection, deactivation and three audit events. Both training tables were empty after rollback; anonymous/client direct table and RPC privileges were false. Security advisor findings for these tables are expected INFO “RLS enabled no policy” because access is exclusively through the service gateway.

The browser did not submit a real training capture/approval and native WhatsApp application launch was not tested. Mobile device layout remains unverified. These limits must not be represented as fully tested flows.


## Actionable case brief and confirmed order subject (2026-09-20 MYT)

Status: PRODUCTION. Release `1cd60161d61b683e4bd23fdadc025e07b7664d18`; Order gateway `admin-ai-dashboard` v4.

- Classification uses the newest actionable inbound request in the recent evidence window, so an older design/payment topic does not replace a newer parcel/complaint request. Negated urgency such as “not urgent” is not promoted as urgent.
- The AI panel presents the customer request, only confirmed facts, missing checks and a conservative next action. Provider order/payment/shipping values remain separately labelled; Completed is not treated as courier Delivered and COD is not treated as cash received.
- A related customer order is reference data until an admin explicitly confirms that it is the subject of the current case. The binding is server-validated against current canonical customer context and is invalidated for AI use when the inbound revision or order session changes, or identity becomes ambiguous.
- Case bindings and changes have service-only storage, optimistic versioning, request-id idempotency and an audit event. Client roles have no direct table/RPC privileges.
- Shortcuts reuse existing Admin V2 workflows: open the confirmed canonical/marketplace order, search active Draft Orders by customer identity, or open Create Order with name, phone and channel prefilled. They do not copy chat product/payment claims, create a real order, mutate payment/shipping, or send a customer message.

Verification: production browser rendered current WhatsApp/Shopee action labels and the case brief against real data, including a Shopee complaint with one related Completed order that correctly remained unconfirmed. Build, Admin TypeScript and deterministic analysis tests passed. The isolated gateway harness proved permission, stale-chat, invalid-version, unrelated-order and ambiguous-identity guards plus server-derived actor/reference/session. A rolled-back live SQL test proved exact retry, request-id conflict, stale-version rejection, clear binding and two audit events, leaving zero QA rows. No real customer binding, order, draft, payment or message was mutated during verification; mobile remains unverified.
