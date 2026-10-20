# Unified Inbox: Shopee order and product cards

Status: backend PRODUCTION; actual desktop/mobile component flows VERIFIED; frontend hosting pending release confirmation (20 October 2026).

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
- Live sender v17 (JWT on), private bridge v15 (custom auth/JWT off). Production frontend release evidence follows after deployment.

## Rollback

Revert the scoped Inbox UI/sender files and redeploy both sender dependency bundles together; keep existing records and migration for audit. No canonical order/product/payment change, provider product edit, credential rotation or historical message backfill is part of this feature.
