# Unified Inbox inline reply suggestions

2026-10-10: backend read contract PRODUCTION; rendered composer behavior VERIFIED in controlled Chromium, desktop 1280x900 and mobile 390x844, light/dark. Authenticated hosted staff interaction remains unexercised because the test browser has no staff session. Browser plugin not available; regular Playwright used with the actual ChatArea component and controlled read responses.

## Interface and timing

At `/inbox/`, one readable suggestion sits immediately above the message field. Clicking or keyboard-selecting it inserts text and focuses the composer. Existing admin text is preserved by appending; repeated clicks do not duplicate the suggestion. The admin can edit before using the existing Send button/Enter. Suggestion requests never send or mark a conversation replied.

New incoming customer messages wait for a six-second quiet period. Successive bubbles reset the quiet timer, coalescing a burst; ingestion itself is never held. An older selected chat loads without an artificial extra six seconds. There is no minimum number of messages. The SOP analyzer considers up to five recent inbound messages within its existing bounded recent-chat window, with the newest meaningful request driving intent.

Every calculation reads canonical identity/session/order/payment/production/shipping records from Order System, including actual persisted production/ClickUp state. It does not fetch live provider or courier state on demand. Related orders alone do not choose the case: a unique exact order reference in chat or a still-current AI Dashboard case confirmation is required. Ambiguous identities, missing order data and media are not proof of order/payment status. Session boundaries for draft extraction and after-sales handling are preserved.

Suggestions expire after 60 seconds. Message/content/status, customer/session, Inbox order-summary/link changes, resume/online and explicit refresh invalidate the suggestion. A visible selected chat refreshes periodically. Unmount/change discards old async results; the server re-reads chat after order lookup, and the UI requires its latest loaded message ID to match. A pending/unknown outgoing message suppresses calculation. A missing/unavailable canonical result produces retry state instead of invented status. Customer acknowledgements, media-only or unclear requests can produce no suggestion.

This release reuses deterministic **SOP rules v1**, not GPT generation. It needs no new OpenAI API key. Images/audio/documents are not interpreted; captions can contribute text evidence. The shared complaint rule recognizes Malay `xreply`/`xbalas` shorthand as well as spaced forms. It does not automatically apply approved training examples or retrain anything.

## Authentication and ownership

- Inbox `uujcqcsfghqkukaydruc`: `inbox-reply-suggest` v1, JWT verification enabled plus actual user lookup and active owner/admin/staff/agent membership. It loads the authoritative conversation through the existing service-only read RPC; browser-supplied text/order/identity is ignored.
- Order `buivecgahhmrhlmfujgt`: `inbox-reply-context` v1, mandatory existing private `x-admin-window-token` authentication, fixed gateway destination. It accepts evidence only from this trusted server bridge, uses `icetak_ai_dashboard_context`, current case binding and shared enrichment/analyzer modules, and returns a minimal draft DTO. Platform JWT is disabled only on this server-only endpoint because private authentication is enforced in code.
- `admin-ai-dashboard` v20 retains JWT/admin/permission checks. Only the shared shorthand complaint pattern changes; existing send/review actions remain unchanged.

No new migrations, customer records, historical backfill, provider calls, send claims or order/session mutations. Free-form WhatsApp expiry is checked at the send action boundary, including Enter, as well as the existing UI button state. Suggestions remain usable as editable/copyable drafts when the window has expired.

## Verification

`node --experimental-strip-types scripts/check-inbox-reply-suggestion.mjs` executes actual handlers with controlled reads: staff/private auth, fixed destination, ignored client evidence, concurrent-chat rejection, exact shipped order/tracking, ambiguous/latest-order safeguards, acknowledgement/media/no-context behavior, 60-second expiry and no writes/sends. Existing `check-ai-dashboard.mjs`, Inbox typecheck and root multi-app build pass.

Rendered real ChatArea tests prove placement, click/keyboard insertion/focus, edit/explicit send, append/dedup, typing preservation, six-second burst debounce, late cross-customer response rejection, errors/empty retry, both themes, mobile suggestion/Send bounds, and expired WhatsApp Enter guard. No page runtime errors. Screenshots and temporary fixtures are outside the repository.

Exact deployed bundle/auth readbacks match. A private live Inbox→Order request for the screenshot conversation returned four inbound evidence items and a conservative complaint response with no order reference; actual CRM was matched but no canonical order was available for this customer. Message count 5, outgoing count 1 and the original chat revision/needs_reply=false remained unchanged. Live anonymous staff and missing-private-key requests return 401. No real customer send was performed in QA.

Hosted frontend delivery PRODUCTION: release `45571f4a63ef58c71ad962d1fa8978b3c8dc4419`, Cloudflare Worker `c6608e75-b1c1-4f1d-bd39-7e9c1208f566`; Workers Builds, public-domain guard and the existing Shipping deploy workflow succeeded. The actual `/inbox/?release=45571f4` chain serves `index-CFypapmC.js` / `index-BVaUq2TR.css`, and the hosted JS includes the suggestion endpoint, panel labels and click-to-use control. Authenticated hosted staff interaction remains unexercised.
