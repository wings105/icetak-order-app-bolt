# Order detail collection and chat sessions

2026-10-04. Status: VERIFIED in the real gateway and rendered components with controlled saves and actual read snapshots. Backend deployed; authenticated hosted-owner save confirmation remains pending.

## Staff surface

Marketplace Orders defaults to To Ship on normal entry (or an invalid mp_status); explicit valid mp_status links and the All tab remain available. The initial RPC uses TO_SHIP. Marketplace Orders retains its list and platform statuses. CRM-authorized staff see Detail Order, Follow-up / Deadline and ClickUp / Production columns. Customer Focus uses the same evaluator and opens the same Detail / session panel. Marketplace refreshes its scoped detail/task read model every 60 seconds, with overlap prevention and cleanup when the page/filter changes. Separate indicators describe the internal iCetak order link, ClickUp task link and usable chat-session link. Marketplace `internal_order_id` being null does not imply no ClickUp task.

Each item has an explicit requirement: standard, name, name + age, wording, image, image + wording, or review. Conservative title inference is a starting point; unknown products need staff review. Completeness follows required fields, multiple-unit same-design confirmation and current item facts. Multi-item generic chat is not allocated by array position. Reference images require an explicit final image selection. Known notes, canonical wording and exact ClickUp SKU/task matches are shown with provenance. Conflicting new customer details reopen review; acknowledgements do not invalidate an explicit staff correction.

The panel preserves existing task/payment/shipping ownership. Saving its detail state does not change order items, payment status, ClickUp task fields or production status. Task stage >= 5 locks the corresponding item; fully started or closed orders lock the panel. New item facts invalidate older confirmations. The platform's READY_TO_SHIP badge remains separate from detail/design readiness.

## Session boundaries

Reuse existing Inbox Shopee order sessions by exact order reference. Only usable open scopes supply automatic text extraction; history, ambiguous scopes and truncated reads cannot fill fields automatically. Staff may bind up to four exact-identity WhatsApp/Shopee conversations and specify a start/end window, including relevant pre-order text. The Order System checks prior canonical order-session closure; Inbox clamps messages against Shopee session cutoffs and previous closed-order boundaries. Closed order sources cannot become usable through a manual binding.

Draft-first `order_sessions` remain canonical draft/payment creation sessions and close on conversion. Post-order detail collection belongs to private Customer Focus state; it never reopens those draft sessions. Same customer identity alone does not automatically allocate every chat to every order.

## Contracts and access

Order System service-only `icetak_order_detail_sources(jsonb)` returns latest exact-linked ClickUp Customize Name / confirmed / SKU facts and marketplace internal-order links. It does not alter mappings or backfill historical events. Inbox service-only `icetak_order_detail_context(jsonb)` reads at most 50 requested orders and the last 120 messages per scope, exposing truncation and scope provenance. Neither RPC grants anon/authenticated access.

JWT-protected `admin-ai-dashboard` offers:

- `order_details`: 1–50 exact `icetak:UUID` / `shopee:UUID` keys; returns only requested order rows, scoped evidence, same-identity candidate conversations and read/manage capabilities.
- `order_detail_save`: current source fingerprint, item signature, expected private-state version, UUID request ID and detail check. Existing versioned `icetak_customer_focus_save` stores private state and audit. A repeated identical request returns the original result; reused IDs with different payload/actor/order conflict. Server revisions and actor replace browser claims.

Inbox `ai-dashboard-bridge` retains custom server token authentication. Existing CRM view/manage permission checks apply to the frontend and gateway. All changes are in Admin V2; customer/storefront ownership is preserved.

## Follow-up scope and missing adapters

The evaluator identifies an incomplete order after 30 minutes, an observed manual follow-up waiting for its next inbound revision, and an explicitly configured detail deadline. The deadline takes priority over waiting. Staff can copy the detail request and record "Saya sudah follow-up"; this is an external action observation, not a provider delivery claim. No deadline/SLA is silently inferred from shipping time.

Automatic Shopee sends, deadline/default-item messages and ClickUp Customize Name/confirmed writeback are NOT enabled in this release. On inspection, Inbox private runtime settings had no `shopee_chat_send_endpoint`/token. The existing Shopee send adapter therefore has no connected destination. No direct ClickUp credential/writeback adapter was available either. The detail gateway reports `shopee_send: false`; frontend copy explains manual follow-up.

To enable those integrations next, connect the actual AP/Shopee send adapter and the ClickUp writeback route. Then verify one controlled order end to end: 30-minute request sent once, inbound scoped to its order, confirmed item values written once to the exact task, and a due-default send only for an eligible product with no intervening reply or started production. Durable scheduling, provider receipts, retries and exact task mapping must be proven before claiming autonomous operation.

## Verification evidence

- `scripts/check-order-details.mjs`: session-bound extraction, old/history/unbound/ambiguous/multi-item/media exclusions, quantity confirmation, item signatures, fresh corrections vs acknowledgements, per-item/whole-order locks, deadline/waiting order and binding guards.
- `scripts/check-order-details-gateway.mjs`: actual handler; requested-order isolation, save/reload, trusted actor, one-event retry, conflicting retry, source/version/identity/reader guards and production deletion rejection; no provider/order/payment writes.
- Existing Customer Focus model/gateway and AI Dashboard regressions pass.
- Real Customer Focus and Marketplace list/panel rendered against full actual order snapshot plus isolated QA order and controlled actual gateway saves. 1440×1000 and 390×844: save/reload, other-channel binding, deadline/manual follow-up, lost-response retry and reader capability checks pass; no page runtime errors or document overflow.
- Live save/audit assertions ran inside rollback: one identical retry result/event, private detail persisted, zero retained QA states/events. Live Inbox checked ten open source sessions with `closed=true`: zero usable scopes. Service-only grants and backend exact source/auth-mode readback verified. No-auth calls rejected with 401.
- Admin TypeScript 6 check, source ownership guard and full storefront + isolated Inbox build pass. Run Admin typecheck with its own package's compiler, not the root TypeScript 5 compiler.

## Hosting release

Initial release `9ebd080e1413776a4762dc05a453ed4296a0cf5c` passed Cloudflare Workers Builds and the source guard. Public production asset-chain smoke found the expected order detail actions, panel, manual follow-up disclosure and Marketplace columns in `App-DfOh9wbW.js`. This confirms served code, not an authenticated owner save. The additional 60-second Marketplace polling behavior was verified with the real rendered list/handler and a controlled fresh task change; overlap and unmount guards remain local to the scoped list.

## 2026-10-04 — Checkout wording / ClickUp checkbox correction

User screenshot exposed a failed case in the initial evaluator: an explicit `wording on topper: ...` checkout note was displayed but not extracted, birthday title inference wrongly required name/age, and ClickUp `confirmed: "true"` rendered as Belum. The parser now accepts explicit topper wording labels; complete supplied wording replaces name/age inference without overriding explicit staff requirements or assigning a generic note across multiple items. Note and equivalent ClickUp wording are normalized before conflict checking; first-source provenance remains Note to seller. String/boolean checkbox values normalize to true/false/null, and the UI labels the fact Confirmed (ClickUp) without modifying the checkbox. Production stage remains locked even when detail is complete.

VERIFIED on the exact live order snapshot/source read and the real rendered handler/panel: 261004PU9CC6BW has complete 1/1, wording Happy Birthday Thines Baby, no missing name/age, normalized confirmed=true and printing lock intact. Checkout note alone, conflicting source wording, multiple items, explicit staff requirements and true/false/missing checkbox representations are regression-tested. No chat/API send, task field update or production mutation. admin-ai-dashboard v14 retains JWT; hosted authenticated owner refresh remains pending.

## 2026-10-04 — Completed task custom wording correction

The next owner screenshot identified three more false missing-detail rows: 261004PU64CYAS (MOHAMMAD ARYAN (6 TAHUN)), 261004PQXWU76N (Olivia's 2nd Birthday), and 261004PPSG0SKY (Captain TIYEN turns 9). Exact live task/source reads show nonempty Customize Name, confirmed=true and complete production stage. Inline name/age and recognizable full birthday wording now parse without explicit labels. Nonempty final Customize Name from an exactly assigned confirmed or production-stage task supplies full wording for an inferred topper name/age rule. Explicit staff requirements remain authoritative; status alone never fills empty fields, artwork requirements, generic multi-item allocation and quantity/conflict guards remain intact.

VERIFIED: model/gateway regressions and rendered real gateway + Focus list/panel check all three actual rows as Detail lengkap with original wording, Confirmed (ClickUp): Ya and retained production locks. Desktop/mobile flow, save/reload, session binding, deadline/manual followup, exact lost-response retry and reader checks also pass without runtime errors. admin-ai-dashboard v15 deployment/readback preserves all other source files and JWT. No canonical order, ClickUp task, provider message or retained QA mutation. Hosted authenticated owner refresh remains pending.

## 2026-10-04 — Marketplace detail filtering

Marketplace toolbar now offers Semua detail, Detail lengkap, Belum lengkap, Perlu semakan, Perlu follow-up, Menunggu balasan, Deadline detail tiba, Ready design and Production / dikunci. Completeness options compare evaluator status; workflow options compare its stage, so locked can overlap complete or missing. Search, provider, platform and ship-by constraints still come from the existing marketplace RPC. Detail filtering reads all matching source pages (100 rows) and the existing exact-key gateway (at most two parallel 50-order requests per page), then paginates matching results in 50s. The displayed matched total is exact only after scanning finishes; progress stays visible while reading. Errors show retry rather than false missing/zero results. Source/filter changes invalidate previous responses; refresh cannot overlap an ongoing scan. Broad historical queries take longer; narrow by platform/search first. No backend schema/auth changes, provider sends or business writes.

VERIFIED in rendered real Marketplace component using the real evaluator and controlled read APIs over 123 orders: missing matches beyond first 100 sources, complete pagination (100 results), search/platform intersections, review/waiting/deadline/followup, empty result and error/retry. Desktop 1440x950/mobile 390x844 screenshots show visible selector and no document overflow; no runtime errors. Browser plugin unavailable; regular Playwright used. Admin TypeScript/source guard/full build pass. Hosted authenticated owner interaction remains pending.

## Read performance

Order detail reads now use an exact 1–50-key snapshot. Marketplace detail-only filters reuse a completed scan for 30 seconds; explicit refresh/save/source changes bypass it. See [Admin read performance](ADMIN_READ_PERFORMANCE.md).
