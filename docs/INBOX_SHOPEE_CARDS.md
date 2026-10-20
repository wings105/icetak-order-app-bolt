# Unified Inbox: Shopee order and product cards

Status: backend and hosted delivery PRODUCTION; actual desktop/mobile component flows VERIFIED (20 October 2026).

## User flow

Open a Shopee conversation's Customer Workspace. Order → **Hantar order** previews the selected linked Shopee order. The new **Produk** tab searches the existing iCetak catalogue by name, Product ID and model SKU, with 20 rows per page. **Hantar produk** previews the product. Each preview identifies the buyer; only **Hantar kad** sends. Cancel sends nothing. WhatsApp retains its existing text/composer workflow.

No bulk send or automatic product promotion is introduced. Price ranges are explicitly labelled catalogue snapshots; Shopee renders the native current-price card. A product must still be active according to a signed live provider read at send time.

## Ownership and contracts

- Order System continues to own products, variants and channel listings. The existing `product_catalog_cache` in Inbox mirrors these listings by shop + item identity. No separate catalogue is created.
- Inbox migration `supabase/inbox-migrations/20261020123550_inbox_shopee_cards.sql` adds member-gated, security-invoker `icetak_inbox_shopee_product_search` and service-only `claim_shopee_card_send`. Do not apply to Order System.
- Search derives Shop ID from the selected Shopee conversation. It uses literal token matching, stable paging and bounded inputs; models support SKU search. The browser cancels obsolete searches and distinguishes loading, failure/retry and empty results.
- JWT/member-gated `shopee-chat-send` accepts logical `message_type: order` with `order_summary_id`, or logical `message_type: product` with cache `product_id`, plus conversation and stable request UUID. It never accepts arbitrary recipient/product fields as authority.
- The private `ai-dashboard-bridge` also accepts `send_card` for explicit approved server actions, with actor, exact conversation revision and resource. Its existing secret authentication is unchanged. No browser can read its token.
- Shopee wire payloads verified on the actual app: `order` → `content.order_sn`; **product wire type is `item`** → `content.item_id`. `product` is the application-level card selection name. Shopee rejected the wire value `product` with `invalid_message_type`; do not change it back based on receive-type documentation.

## Validation, persistence and recovery

The sender derives recipient/shop from the actual conversation and uses the shop's existing direct configuration. Known-expired, disabled, unchecked and mismatched credentials remain blocked; unknown expiry triggers the existing read-only access check. Before sending, a signed `get_order_detail` proves exact Order SN and buyer ID, or `get_item_base_info` proves the exact item is NORMAL in that shop. A missing cached order buyer is allowed only for order cards, and only when provider buyer proof succeeds. Non-null contradictory cached identity is rejected.

Card-only payloads reject mixed text/files/stickers. Atomic `claim_shopee_card_send` calls the existing outbox claim and persists a safe card snapshot before external delivery. A failure to record blocks delivery. Existing message type remains `text`; `provider_message_type` stores the logical card type, and `media_metadata`/raw payload store the card. The existing mapper/card component renders both `item` and `product`. No message enum change is needed.

The same UUID/actor/conversation/resource cannot send again. Failed/unknown attempts retain their state; uncertain browser outcomes disable resend. Retrying a sent request uses the original message/provider IDs. Provider failure diagnostics are bounded and redact credentials/URLs. Success writes both local message and send audit, then reuses `complete_shopee_reply` and provider-read verification. New inbound messages during sending remain unanswered. A read failure after confirmed delivery warns against resending. API echoes are not required: the sender stores the outbound card itself.

The frontend immediately displays the saved card and refreshes messages/activity. Optimistic records deduplicate against persisted message IDs. A send finishing after navigation remains bound to its original conversation.

## Verification

- 22 controlled card checks: exact wire payloads, real-item status/buyer proof, wrong shop/buyer and mixed-message rejection, atomic snapshot, audit outcome, duplicate and unknown protection, card renderer.
- Existing 40 direct-chat checks and image/read suites pass. Inbox typecheck and full storefront+Inbox build pass.
- Native database rollback tests: authenticated member search, exact Product ID, token name search, literal wildcard input, stable paging, unknown chat/nonmember denial, actual service-role atomic snapshot and duplicate/wrong-shop guards. No QA rows remain.
- Actual Sidebar, Order/Produk tabs, dialog and MessageBubble tested with controlled gateways at 1440×1000 and 390×844: cancel, double click, both card types, paging/search/reset, aborted stale search, empty/error/retry, mobile fit, unknown non-resend and delivered/read-warning states. Browser plugin unavailable; Playwright used. No page errors or framework overlay. This is controlled component verification, not a signed-in hosted staff session.
- Owner-authorized production sends to the specified `afifahanin217` conversation: order `2610205Q0R9W6D`, provider message `2442116222133092721`; matching purchased product `5803316307`, provider message `2442116612387930481`. Both `sent`, local message + send audit + activity persisted, provider read confirmed. Replaying each original UUID returned duplicate=true and the same provider ID without another send. Two earlier product requests were explicitly rejected and remain failed audit records; no product was delivered by those failures.
- Live sender v17 (JWT on), private bridge v15 (custom auth/JWT off). Production frontend released in PR #104 as `9025d443ae37795bd700786d35d5aba1ad932071`; release tree `012b0377d19926103afd28475349fedc8cce184d` exactly matches tested source. Workers Builds `aa3db808-a819-499a-ae11-01ca0f435339` and production guard both succeeded. The real `/inbox/` serves `index-Ou0uwvgJ.js` and `index--IZFS12H.css`, byte-identical to the tested build (JS SHA256 `79af54b4d33ebb60e8426a3630e09db7d61243ad56847c6f5be1d97cd9b52623`). All four new controls are present in the served source. Hosted signed-in staff actions remain unexercised; controlled UI + live audited provider sends are the verification boundary.

## Product search focus regression (20 October 2026)

Status: hosted delivery PRODUCTION; controlled rendered behavior VERIFIED. The owner reported that typing a product query required a click for every character, overriding the earlier search-interaction verification for this case. The earlier test used programmatic fill and omitted the global focus installer.

Reproduced with the actual sidebar and `installChatComposerFocus`: one click followed by physical key events for `frozen` left `f` in product search and `rozen` in the chat composer. The global MutationObserver interpreted every result/loading DOM change as a completed send and refocused the composer. The fix limits recovery to mutations of the composer disabled attribute, and delayed focus callbacks respect other editors and open modals. Enter recovery only applies to the actual chat composer.

Playwright was used because the Browser plugin was unavailable. Twelve controlled checks at 1440×1000 and 390×844, including touch emulation: slow typing across debounce/result updates, backspace, paste-style text insertion, send-completion/window-focus races, modal focus, failed/empty/stale searches, preserved post-send/new-chat composer focus, and desktop/mobile typing. All passed with zero page errors and zero send requests. Inbox typecheck and full storefront + Inbox build passed. The complete built Inbox App (including every global installer) also passed one-click `frozen` typing at both sizes with an empty composer and zero sends/page errors. Expected controlled-console errors were the injected search HTTP 500 and unavailable fixture Realtime socket. A real staff session remains outside this controlled verification.

PR #105 release `545b3bfc53bf49c7876e43044657c11ea108b111` has the exact tested source tree `e066da1adac611319f173f88b0f057cef3291601`. PR and production guards plus Workers Builds `366b5b9c-b253-4481-be74-5f0c0543ee02` passed. The hosted `/inbox/` serves `index-YnYaG_RF.js` and unchanged `index--IZFS12H.css`, byte-identical to the tested full build (JS SHA256 `5e997597ff6954efae93e6424002bbfc67230387ac548de888e79e557a6c3608`). The real hosted staff login gate rendered successfully. The actual hosted App then passed the same one-click `frozen` typing/focus/empty-composer checks at desktop and mobile sizes using an isolated synthetic session and intercepted backend fixtures, with zero sends and zero page errors; this is hosted runtime verification with controlled data, not a real signed-in staff operation. No live customer send or database/function change was used for this fix.

## Rollback

Revert the scoped Inbox UI/sender files and redeploy both sender dependency bundles together; keep existing records and migration for audit. No canonical order/product/payment change, provider product edit, credential rotation or historical message backfill is part of this feature.
