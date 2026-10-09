# Shopee purchase cancels the preceding direct quotation

Backend and customer cancellation pages PRODUCTION; Admin V2 rendered interactions VERIFIED in controlled tests.

The owner authorized automatic cancellation when a customer receives a direct quotation/payment link and purchases through Shopee instead. Order System owns this behavior; no separate Activepieces flow or scheduled ChatGPT task is required.

A paid, active Shopee order first captured after 2026-10-09 05:13:02 UTC can cancel exactly one active unpaid prepaid draft, created during the 14 days before the Shopee placed_at time and with a customer link already sent. Local and international Malaysian mobile formats normalize to the same identity. Use the exact order's canonical CRM owner/verified phone or a complete unmasked recipient phone. Names, partial/masked phones and fuzzy matching do not qualify. Conflicting phones do not authorize cancellation.

Paid, transaction/job-linked, receipt-submitted, converted, cash-counter, unsent, future and older drafts are protected. An unpaid/cancelled/return Shopee order cannot cancel a quotation. Several active drafts or competing CRM phone owners produce an admin review flag and pause draft follow-ups; they cannot select a draft automatically. Admin V2 Draft Orders displays the Shopee Order ID and review reason, using the existing manual Cancel Draft action. Review is visible after refresh; it is not a new outbound alert.

Cancellation reuses icetak_admin_cancel_draft with customer_order_shopee, actor/source automation and the Shopee Order ID in cancel_reason_detail. The draft remains in Draft Orders → Cancelled. Notification queue jobs for the draft stop, pending payment sessions are cancelled, and evidence plus a shopee_order_auto_cancelled event retain the exact Shopee order reference. Duplicate events are idempotent. Customer review/payment pages hide checkout/QR controls and display the cancelled quotation message. The customer Edge handler rejects POST mutations for rejected drafts; database guards block stale confirmation, payment preparation, correction, receipt/session and status writes. Explicit admin Reopen remains the existing recovery route.

Deferred triggers on marketplace_orders, marketplace_customers, customer_master and customer_identifiers_master also handle phone mappings received after the order. They act on current rows at commit, not intermediate CRM merge states. Internal functions use SECURITY INVOKER, fixed search_path and service_role-only EXECUTE. No table, policy, secret, external messaging adapter or canonical order creation is added.

## Verification

- Applied migration version 20261009051918; repository filename aligned with the MCP-generated live migration version.
- order-draft-customer v13 ACTIVE, original custom customer-token auth/JWT mode retained, exact source readback matches.
- 16 production-database real-trigger regression cases under service_role in one rolled-back transaction: exact normalized phone; multiple drafts; already-paid; submitted receipt; old draft; unsent draft; cash counter; unpaid order; masked phone; delayed CRM phone; cancelled Shopee; pre-activation order; future draft; wrong phone; competing CRM owners; pending payment review.
- Successful cancellation checks status/reason, disabled follow-up, cancelled queue/payment session, exact audit linkage and retry count. Stale payment/confirm/correction/status and late receipt writes are rejected.
- No QA drafts, marketplace orders or CRM masters remain. No historical replay or provider sends.
- Security advisor categories/counts unchanged from the pre-change baseline; all five new functions deny anon/authenticated execution and allow service_role.
- Full storefront/Inbox build, Admin V2 type/build, source ownership, session isolation and WhatsApp opt-out regressions pass.
- Controlled Admin V2 real-component desktop/mobile tests verify the review flag, exact Shopee Order ID, reason selection, cancellation and Reopen control, without runtime errors.
- Browser plugin not available. Controlled Playwright uses an npm-distributed Chromium binary because the normal browser ZIP download is truncated by the environment. Customer cancelled review/payment desktop (1280px) and mobile (390px) render without QR/checkout/mutation or runtime errors.

The public hosted assets and authenticated owner UI must be distinguished: controlled component tests use mocked admin data and do not prove a signed-in hosted owner interaction. Backend installation is effective independently of frontend publishing.

## Production release

PR #80 merged to `production` as `a7fe77c9ee787882931ac4d00fff7a9ed48311ad`. Workers Builds and the Public Domain Guard both passed; deployed Worker version `4e47ed25-f864-46fc-b71e-f8e37e9772bd`.

The public root asset chain (`main-DPaLnSOn.js` → `admin-v2-route-h1vPItM7.js` → `App-DczY1BJr.js`) serves the new Shopee review label, `shopee_match` read model and paused-follow-up explanation.

Public customer review/payment HTML was fetched from `https://shop.decocake.my/` after deployment. Chromium rendered those exact hosted bytes at 1280px and 390px with a synthetic rejected-draft API response: the cancellation message appeared, checkout/QR/receipt controls were absent, no mutation POST occurred and there were no runtime errors. This is a controlled render of deployed HTML, not a real customer-token transaction. Direct Chromium navigation timed out in this environment; HTTP fetch succeeded. No real customer link, order or payment was changed by release QA. Authenticated hosted owner interaction remains unexercised.
