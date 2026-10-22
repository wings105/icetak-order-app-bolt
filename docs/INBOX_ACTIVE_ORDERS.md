# Unified Inbox active order list — 22 October 2026

Backend/hosted delivery PRODUCTION; full rendered Inbox desktop/mobile controlled behavior VERIFIED. Real hosted staff actions remain unexercised.

## Source and eligibility

Canonical orders stay in Order System `buivecgahhmrhlmfujgt`. Inbox `uujcqcsfghqkukaydruc.external_order_summaries` remains a chat-side cache. Both order screens call the authenticated, security-invoker `icetak_inbox_order_page`; no browser service key or direct cross-project access is added.

- Shopee: paid `READY_TO_SHIP` / `PROCESSED`, without shipped/logistics pickup/delivery evidence or `metadata.dashboard_excluded`. `IN_CANCEL`, unknown, unpaid and legacy/test records are not active production work.
- Decocake: paid, partial or cash counter, nonterminal order, and at least one current unfinished task in owner-configured ORDER LIST `18375902`. Latest task identity/status wins across task links and work snapshots. One finished component does not hide a different unfinished component.
- Completed/Cancelled comparisons ignore case. Customer Collected, ready-for-pickup with completed tasks and waiting-courier with completed tasks leave the work list. Their canonical fulfillment/payment states are unchanged.
- No linked task means no inferred active production work. Legacy cache rows may use their explicit nonterminal ClickUp status until canonical sync supplies the aggregate task count.

The old cache included historical records and loaded only 300. After reconciliation, the canonical and cached active order sets matched exactly, including unfinished cash-counter work. Counts change as orders/tasks change; none are hardcoded.

## Counts, history and priority

Default Inbox Order tab is To Ship, including unfinished Decocake work. Channel filters separate Shopee/Decocake. Completed, shipping, unpaid, cancellation and return tabs remain accessible.

Server totals/count tabs are calculated before the 100-row page limit. Stable order/ID tiebreakers, previous/next controls and reset-on-filter protect history beyond 300. Global order/message search retains its independent detail fetch, including records outside the loaded page.

Urgency is derived at read time from current deadlines, using Asia/Kuala_Lumpur for direct-order days. Inactive work cannot be urgent. Aborted/older UI requests cannot replace a newer filter; realtime list updates are debounced.

## Sync and migrations

Main migration `20261021221354_inbox_active_order_source` corrects the service-only invoker view and enqueues task-only complete/reopen/delete/remap events through the existing durable queue. Inbox migration `20261021221354_inbox_order_work_list` adds the invoker read/policy functions, normalizes incoming cache flags, and repairs derived eligibility/priority only.

Worker v6 / marketplace sync v12 preserve their original custom-token/JWT modes. Inbox receiver v3 preserves custom-token authentication. Canonical source observation clocks reject late responses while allowing a later task deletion/remap whose order timestamp did not change; legacy source timestamp guards remain. Exclusion flags are carried across the bridge. Canonical records, provider tasks, payment values and chat reply flags are not edited by this correction.

## Verification

- Forty executable eligibility/urgency/source-clock checks; existing 22 Shopee card checks; Inbox typecheck; complete shop/Admin/Inbox build and source ownership guard.
- Main live rollback proves task-only completion removes an order, reopen restores it and the durable sync job is queued.
- Inbox live rollback inserts 351 isolated fixtures, checks independent total/page/tail beyond 300 and no duplicate adjacent pages, then proves an incoming Completed row cannot remain active. No QA rows remain.
- Actual canonical-to-cache sync completed; live canonical and cached active cohorts match by source. Deployed function bundle/auth readback matches source.
- Full actual Inbox bundle rendered at 1440×1000 and 390×844 with an isolated synthetic session and intercepted backend responses: current RPC snapshot, urgency/filter/search, old-response cancellation, history paging and cash-counter orders pass. Zero page errors or unexpected network/mutations. Browser plugin was unavailable; regular Playwright used local Chromium. Browser download/extraction infrastructure required the npm-packaged Chromium binary; no production dependency changed.
- Real hosted staff login/actions are not exercised by the controlled session. Production delivery must additionally verify the Cloudflare build and served Inbox asset identity; never claim the controlled synthetic session is a real staff session.

## Hosted release

PR [#110](https://github.com/wings105/icetak-order-app-bolt/pull/110) merged to `production` as `11a2d176ac2adfdd094993cfdc973a14868f3f6e`. Its complete Git tree (`62ed5d8e5aa839fd26fff247346015e10bc8630d`) matches the locally tested source. GitHub guard and Workers Builds succeeded; Cloudflare build `3153e154-5902-43ae-a4fd-557dd12878a5` deployed version `1cdb4566-2459-4eed-b742-7cb29f4b0802`.

The actual `https://shop.decocake.my/inbox/#orders` route renders the staff login gate and references `index-Dgu_eE4B.js` / `index--IZFS12H.css`, matching the tested bundle. The served JavaScript's complete rendered-text length and FNV-1a fingerprint match the local bundle under the browser's Windows-1252 text-view decoding (`592579` / `1a5b0ad5`), including the new list RPC and cash-counter copy. No first-party application errors appeared; the browser extension's metadata error is unrelated. Authenticated hosted staff interactions are not inferred from this delivery check.

## Product category filter

Order sidebar and Active Orders share a compact category selector: Semua Kategori, Edible Image, Cake Topper, Acrylic, Wafer and Artpaper Gold. It combines with existing channel/status/mode/search filters and resets the page. Category option counts reflect the current channel/status/mode/query before category selection and pagination; status totals reflect the selected category. A mixed order appears once in each matching category, so category totals can overlap.

Inbox migration `20261022040439_inbox_order_categories` adds read-only invoker classification helpers and the `icetak_inbox_order_page` overload with required `p_category`; existing clients keep the six-argument signature. Saved `product_type` owns classification. Marketplace SKU/title/variation fallback prioritizes specific materials over generic Cake Topper/NOT Icing listing text. `mirror` maps to Artpaper Gold; saved `burnaway` includes Edible and Wafer. Unrecognized items remain available under Semua Kategori. Search detail rows outside loaded pages use the equivalent client classifier. No canonical/source data backfill is required.

Verification: 18 executable category checks plus the existing 40 eligibility/source-clock checks, typecheck and full frontend build pass. Native rollback covers explicit types/listing precedence, mixed-order deduplication, independent counts, a 351-order category tail, nonoverlapping pages, channel isolation, empty categories, invalid parameters, anonymous denial and old-client compatibility. Live category reads contain only matching orders. Actual built Inbox at 1440×1000 and 390×844 verifies all five selections, mixed orders, channel conjunction, history page reset, empty state, global search detail fallback, Active Orders and stale-response cancellation with zero page errors/unexpected mutations. Browser plugin was unavailable; regular Playwright used an isolated local synthetic session, intercepted backend calls and disposable browser infrastructure. Production dependencies are unchanged. Hosted delivery evidence is recorded in the category-filter release PR; real hosted staff actions remain unexercised.
