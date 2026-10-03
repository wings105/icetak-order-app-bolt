# Fokus Customer — Admin V2

Status: Live user load failed on 2026-10-04 (8s database statement timeout). Backend performance repair VERIFIED on complete live data under the same 8s service-role budget; authenticated hosted owner recovery remains pending. Earlier controlled UI checks do not prove the reported live failure was resolved in the owner's browser.
Route: https://shop.decocake.my/?admin=v2&view=customer-focus

## Operation

Sidebar → Fokus Customer. Default filter is Perlu tindakan saya. One row per order or active draft; an unbound inquiry has its own chat row. Click column headings to sort; Shift-click/add sort for secondary keys. Column visibility/order and sorting persist locally. Filters, search, 50-row pagination and filtered CSV run over the complete returned read model, not only the displayed page. Customer stays pinned during horizontal scrolling.

Urus records detail completeness/missing details, urgent, customer-needed date, dispatch/pickup target, design target, panel waiting/completion/snooze and note. Dates use MYT: design noon, dispatch/pickup 16:00, snooze reopening 08:30. Customer-needed date is displayed separately from work/shipping deadlines and is not a courier ETA. ClickUp due and date needed come from the latest accepted full snapshot; only unfinished design sets contribute to design due. Near customer-needed dates without a dispatch target require scheduling review. No guessed Shopee SLA/business-day calculation is introduced.

Printing retires design for progressed sets; Complete does not prove parcel shipment/all item coverage. Physical lifecycle/payment mutations remain in Orders/Shipping/Pickup workflows. Panel design/production/completion markers are explicitly labelled admin observations; source/task/current customer-message fingerprint changes invalidate earlier work hiding. Notes, dates and detail classifications remain stored for review. New inbound also reopens chat waiting/handled markers. Chat over 30 days is separated into Backlog rather than repeatedly promoted by historic urgent text.

Unknown/pending-cancellation status is review work, not a confirmed overdue design. COD/cash is not automatically treated as cash received. Missing detail starts Unknown; marketplace API detail_complete is not proof that customer artwork/wording is complete. Draft payment requires paid state plus recorded receipt/amount before a verified-paid badge. Drafts do not become production orders through this panel.

## Ownership and safety

Order System buivecgahhmrhlmfujgt owns service-only invoker snapshot, exact identity lookup, active draft lookup and audited panel state/events. Inbox uujcqcsfghqkukaydruc owns conversation snapshot and existing token-authenticated ai-dashboard-bridge. admin-ai-dashboard v9 retains JWT/admin CRM gates; focus_save needs Manage Customers/owner, derives actor server-side and whitelists data. Customer Focus shares existing order/task projections; it does not replace domain ownership or activate AI replies.

Reads span up to 10,000 orders, 6,000 conversations and 1,000 active unconverted drafts. Truncation is explicit. Six recent messages are used per chat. No query filter/search hides source rows before global priority computation. Canonical marketplace mirrors are deduplicated. Exact CRM master/phone/Shopee ID matches fail closed on conflicting identities. A customer chat may be shown beside an active order as customer context, with a visible unconfirmed-order label; an exact unique order reference is needed to consume/bind the inquiry row. Customer name/newest order alone cannot bind chat facts to an order. Existing AI case binding remains authoritative for AI responses.

Panel state is separate from canonical lifecycle and existing AI conversation review. It never records a send, changes provider needs_reply or writes order/payment/ClickUp/courier state. Explicit existing AI review decisions can supersede an older chat-panel marker; a new revision invalidates both. Multiple active orders and unbound inquiries remain independently reviewable. Copied/opened links are navigation only; HTTPS task URLs are validated, CSV fields are protected against spreadsheet formula execution.

State writes take an advisory transaction lock, optimistic version, request UUID and append-only event. Exact retry returns its original result; conflict/stale updates reject. Both tables have RLS and zero client grants; functions are service-only invokers. No secrets enter the frontend.

## Verification

- Node outcome cases: exact/multiple/ambiguous identity, paid vs COD, per-set design/printing/ready/shipped, waiting + new-message reopening, cancellation, ClickUp due/needed dates, backlog and stale/invalid updates.
- Live SQL read: 4,052 order records, 3,433 conversations, 12 active drafts at release inspection. 196 operational orders and 60 actual chat records fed the real model: 247 combined rows, 61 ClickUp design due dates and 95 customer-needed dates. Counts can change after this snapshot.
- Live save tests ran in rollback: exact retry gives one row/event/version; conflict/stale reject; no QA rows/events retained. RLS/grants/advisors verified. Expected INFO no-policy findings for private service-only tables.
- Real gateway handler with actual SQL read samples and controlled admin/auth/save sink: 401/403, reader capabilities, trusted actor, whitelist, stale 409 and source failures. No customer messages/orders/payments written.
- Browser plugin unavailable; Playwright controlled Admin route at 1440×1000/390×844: sidebar/direct route, filters/search, single/multi sort, columns/reload persistence, paging, CSV, waiting/design retirement, save conflict retention, exact conversation navigation, readonly buttons, no blank/error overlay/runtime errors. Screenshot evidence outside repository.
- Admin TypeScript, AI dashboard/work/gateway regressions and complete storefront + Inbox production build pass.
- Backend v9 (7 files) and Inbox bridge v2 source readback/auth rejection checked. Authenticated hosted owner flow is not proven by source publication or these controlled checks.
- Production releases 79c32929 and 14e6564c published the panel and safe delayed-chat loading respectively. Final 14e6564c Workers Builds and GitHub guard both completed successfully. Cache-bypassed public assets are main-DIlDwLOT.js → admin-v2-route-FWB38LvF.js → App-CUHUii02.js, with CustomerFocus-DY1zhbYS.js and AiDashboard-DfN3dwlD.js. Route/sidebar/panel actions and the chat loading guard are present in those served bytes.
- Public cloud browser reaches the normal Admin V2 login at the exact route above. This confirms the hosted entry/auth gate, not the authenticated owner's list or save workflow. Controlled desktop/mobile checks include an 800ms delayed chat-detail response without runtime errors.

## Migration records

Order: 20261003190237_customer_focus_panel; 20261003190535_customer_focus_clickup_dates; 20261003192531_customer_focus_active_drafts.
Inbox ONLY: 20261003190238_customer_focus_chats.

Order performance repair: 20261003231918_customer_focus_query_performance.

## 2026-10-04 — Live load failure and repair

The user screenshot shows `Edge Function returned a non-2xx status code`. Production logs at 23:12:55 UTC identify admin-ai-dashboard v9 HTTP 500 caused by PostgREST 57014 / `canceling statement due to statement timeout` in icetak_customer_focus_snapshot. The gateway's 60s fetch deadline did not change PostgREST's inherited 8s service-role statement budget. Inbox focus requests and draft reads succeeded.

Repair adds a partial latest-full-task index with the exact existing ClickUp event predicate/order, an index for archive max(received_at), and a once-built task date map instead of a per-order date-table join. RPC remains SECURITY INVOKER/service-only; no role/global timeout, auth, business data, provider status or frontend changes.

Live 8s service-role tests: complete 4,053/4,053 orders, no truncation, 356 dated tasks; actual PostgREST-shaped JSON serialization plan 1,120ms (62 read / 65,878 hit blocks). All order fields and task/date contents match the previous query across 4,053 rows when task arrays are compared by task ID; older hash-join array order was not guaranteed. Complete chat RPC (3,435), active draft RPC (12) and exact identity RPC (3,435) also succeed under 8s. The actual focusRows model consumes those full live reads and yields 3,589 rows / 1,808 actionable / 632 paid in 1,432ms at the inspection snapshot. These counts can change.

Focus and AI regression checks pass. Both indexes valid; anon/authenticated cannot execute snapshot, service_role can, and security-definer remains false. Advisors retain the expected INFO no-policy finding on the private service-only panel tables. No admin save/customer send was issued. Additional local browser recovery check was blocked before page load by Chrome process_singleton socket() Operation not permitted in the execution environment; no new rendered pass is claimed. Authenticated owner refresh remains the final live UI confirmation.

Disable/remove sidebar entry to roll back frontend access; private read/state tables can remain without altering business records. Do not reapply old migrations or rewrite existing webhook history.
