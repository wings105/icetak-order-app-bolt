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
