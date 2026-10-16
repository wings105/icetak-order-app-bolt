# Shared product catalogue

Status: PRODUCTION delivery and backend/data; controlled UI VERIFIED. PR #94 merged as `370c2d34838881577fe934e9d85028ce27bda28e`, tree `ae3eb4736a7dac0ee6e566598c6e6e935cc6f654`. Later standalone acrylic display commits `ee3dc16` / `14affa8` are preserved.

## Catalogue ownership

Order project `buivecgahhmrhlmfujgt` owns products, variants, images, order profiles, channel listings, import receipts and outbound jobs. Inbox project `uujcqcsfghqkukaydruc` owns its bounded product-card cache. Identity is shop + item + model; never SKU. URLs stay on Shopee.

The MY export imported 2,004 listings and 6,488 models; all covers present. One existing product attached by its legacy Shopee ID: 2,011 total canonical products, original 8 published. New website products are drafts until owner chooses a production profile and publishes. Website title/description/prices/stock/publish/production settings are independent of Shopee snapshots. Reimport preserves website changes. Imported file descriptions and variation labels are retained.

Provider read verification: 41 batch reads returned all 2,004 item IDs: 1,967 NORMAL and 37 UNLIST. Stock zero is not listing status. Product pages can refresh actual status.

## Admin and storefront

Admin V2 `?admin=v2&view=products`: compact ERP list/search/status/pagination, source gallery, browser XLSX/ZIP import with preview, website profiles and model prices, selected-field Shopee edits and audit/recovery. Owner only imports, edits, publishes, or sends provider updates. Active order/production staff can read.

Storefront extends the existing configurator/cart/checkout. Model UUID is passed as sizeCode, while human variation label remains in cart. Server validates model belongs to the published product, stock/quantity, wording, unit price, variant ID and production settings. Catalogue totals are calculated before creating order/payment session; submitted prices cannot set catalogue payment amounts. Basic-service checkout is retained.

Every imported item is available to Inbox through shop-scoped cache; original message images take precedence. Exact model image wins; cover is fallback. Browser requests deduplicate and batch up to 40 tuples; RPC requires active workspace membership.

## Outbound provider changes

Fixed server-only product endpoints; existing shop credentials remain in Inbox. Private bridge token never enters browser. Supported title, description (extended format), item SKU, Shopee image URLs, model SKU, price, single-location stock and list/unlist. Website values do not change when Shopee changes.

Each owner submission captures provider state and listing revision, records idempotent job, claims it exclusively, compares current state, writes selected fields, then reads actual provider state. Only matching readback is VERIFIED. Unknown outcomes are verification-only on retry; no blind replay. Owner can explicitly close an unknown record without resending. Multi-location stock requires a location-aware extension and is rejected safely. Verified snapshots and Inbox cache refresh separately from website fields.

## Verification evidence

- `node --experimental-strip-types scripts/check-product-catalog.mjs`: parser identity, export mismatch/duplicate/stock guards, exact image matching, API selected-field payloads, extended descriptions, location and readback.
- `supabase/tests/shared_product_catalog.sql`: transaction rollback assertions for server model/price/stock/wording, persisted order variant/style/price, payment amount, reimport preserving website edits, exclusive/idempotent jobs, unknown recovery, verified provider snapshot preserving website price. No QA orders/jobs remain.
- Rendered actual Products component at desktop/mobile, parsed all three real exports, edited website price, submitted selected title through mocked provider, matched Inbox model image, selected storefront model and checked cart ID/price. No runtime errors/overflow. Browser plugin unavailable; Playwright used.
- Actual deployed provider read and verification-only existing-title readback succeeded. Unauthenticated admin and wrong bridge token both rejected (401). Actual member cache lookup returned one exact shop and zero wrong-shop results.
- No real Shopee product field was changed for QA. Outbound write acceptance remains untested on a changed live listing; UI/DB payload and provider readback paths verified separately.

## Deployment

Apply `supabase/migrations/*catalog*` / product import guard files to Order only. `supabase/inbox-migrations/20261016051429_inbox_catalog_lookup.sql` and `20261016053255_inbox_catalog_invoker.sql` belong to Inbox only. Deploy `product-admin` (JWT + active admin authorization), `shopee-product-api` (custom server bridge auth), and updated `product-catalog-sync` (existing custom auth).

New Order tables use RLS, service-only grants and explicit service policies; no browser direct mutation. Existing public product RLS remains published + active. ClickUp sync stores a source snapshot instead of overwriting owner-managed products.

## Hosted release evidence — 2026-10-16 05:42 UTC

Workers Builds and Public Domain Guard passed for release `370c2d3`. Cloudflare version `a69a5033-5389-46b2-9bb2-fd033f24dbbb`. Main-domain `?admin=v2&view=products` renders the expected secure Admin V2 login without app runtime errors; no authenticated staff session was available.

Actual root entry: `main-C9ThU8Ip.js`. Followed its module references to actual served files rather than assuming local asset filenames. Hosted `Products-lvwPWkSI.js` and `catalog-configurator-B9FqDMv_.js` match the locked local build after normalizing only imported JS/CSS content-hash filenames (deployment public environment changes the dependency filenames). Hosted Inbox `index-D4ejgXNz.js` is byte-identical: SHA256 `7768738760be991b958b59ea5ee6de95f38224c72e42332cf17449ffaaa6e1b4`. Release source tree is exactly the tested source tree.

Final provider bridge v3 stock verification-only read returned VERIFIED for model location `MYZ` / stock 14, without issuing a write. All 2,004 listing statuses and 2,004 import audit rows persist; no outbound product jobs or QA orders remain. Authenticated hosted owner mutations and a changed-value provider write remain unexercised.

## Shopee-style ERP list — 2026-10-16

PRODUCTION hosted delivery / VERIFIED controlled UI and live read contract. Product cards become one compact row per product inside the existing ERP shell: thumbnail/title, Parent SKU and Product ID, Shopee min/max price, aggregate model stock, provider status, website draft/publication and Edit/View/Shopee links. Status tabs include DB counts scoped to search. Website price is a separate secondary label. Expand variants inline to see individual images, labels, SKU/model IDs, provider price/stock and website price; details load only on expansion and are cached until row refresh. Selection is page-scoped and can perform only the existing owner status-read action. No product value is changed by selecting/expanding a row.

Read-only migration extends the existing service-only list RPC with one bounded snapshot summary per visible row and status counts. Source prices/stock remain explicitly labelled as last import/API snapshots; no sales/traffic metrics are invented. Existing product detail/edit/import/publish/provider queue contracts remain intact. A qualification follow-up avoids collision with the RPC's existing PL/pgSQL `n` variable.

Live assertions compared one actual 60-model product's min/max price and summed stock with the raw listing models, plus empty and UNLIST filter/count behavior. All pass. Actual Products + Sidebar + Topbar rendered at 1600×1000 and 390×844. Forty rows, status tabs, inline 60-model expansion/cache, select-all status read, Edit dialog, empty/search/error recovery, paging and contained horizontal mobile scrolling passed without runtime errors or document overflow. Read responses used actual catalogue data with mocked gateways; CDN thumbnails were fixture images in this controlled run. Browser plugin absent; Playwright used. No import/save/provider queue/process request was issued in QA.

Hosted confirmation 12:08 UTC: PR #95 release `b6478e48bd9b9211bcb991f81f8ba107e5821a90`, source tree `e4b1973917fb3a707e8dc050a356258ab02806c6` exactly matches tested source. Workers Builds + guard passed; Worker `f3d1c904-0ffd-4561-9598-7dc17fac290e`. Actual root serves `main-CBPM27Up.js`; Products module `Products-DyP2N0YD.js` contains the new list/selection/inline-model code and matches the tested build after normalizing only imported content-hash filenames. `Products-DN44TQfN.css` is byte-identical (SHA256 `e99733ca2d6e21160b0ebf8c9d0e1d1596fabb65df6dd3f999d4eef374e42bbd`). Exact URL reaches secure Admin Login without runtime errors; no hosted authenticated staff session was available. RPC remains invoker/service-only, with no authenticated direct execute grant; 2,004 source listings and zero outbound product jobs remain.

## Glossy storefront purchase surface — 2026-10-16

PRODUCTION: PR #96 `e9a86de67f7c2a42f3923a0730b2fb6d52606b2a`, tested tree `e503ee1fdca1e0fd82b87d29b9e939e70a4f115a`, Cloudflare Worker `0a1a3918-8f00-488e-a764-1eae415bee09`; hosting and guard passed. VERIFIED in the actual Vite customer app with the live published CN0790 product read fixture and real Shopee images. Non-basic catalogue products with the `printed` order profile use small accessible seller/Shopee/share icons at the upper corner, source gallery thumbnails that change the main photo, price and a fixed Add to Cart / Buy Now bar. Both actions open the existing configurator in a dismissible keyboard-accessible sheet, retaining the existing cart and server checkout contracts. Other profile types keep their inline configurator; the six basic services retain their own flow. This UI change publishes no products or provider changes.

Printed custom options display Custom Words while preserving server option IDs. Fixed Happy Birthday hides its field; custom starts blank and preserves the customer's draft when toggled. Explicit `[hidden]` CSS prevents the grid label from overriding hidden state. Checkout displays wording once and still permits editing. The route-context helper no longer erases a pending product/search URL while the legacy home is temporarily rendered during navigation.

Browser plugin unavailable; Playwright checked 390×844, 320×640 and 1440×1000. Actual rendered utility icons, fixed bar, default/custom field visibility and validation, toggle state, quantity, Buy Now to checkout, Add to Cart, persisted product/wording/review/price, edit back to Happy Birthday, hash/path navigation and basic-service purchase control passed without page errors or document overflow. Compared supplied before/reference screenshots with final mobile and desktop renders: compact icons, orange/white button treatment, image framing, wording state, sheet layout and footer placement match the requested existing design system. Full build, targeted TypeScript, product catalogue checks and diff whitespace pass. No Place Order/payment/provider mutation was issued.

Hosted outcome 2026-10-16 13:44 UTC: actual public CN0790 page at `https://shop.decocake.my/#/product/cake-topper-jt-express-custom-name-cn0790` passed at 390×844 and 1440×1000 with real Supabase reads and decoded Shopee cover. Three compact utility icons, seller/Shopee links, clipboard copy, fixed purchase bar, sheet, hidden fixed wording, required blank custom validation, custom Buy Now to cart and Edit to fixed wording all observed. Wording appears once; no page errors, no document overflow or real order/payment send. Browser-local QA cart cleared. Actual `catalog-configurator-CK157Z54.js` matches the tested build after normalizing only dependency content-hash filenames (SHA256 `1da671adafc87bd76ee0993d4b7680e441854d3db06cbbd937475f6b32dcc55e`). Full order/payment submission remains deliberately unexercised.

Follow-up VERIFIED in controlled customer UI: the required-wording warning clears immediately once valid text is entered. Same three viewport/cart/navigation checks and full build pass; this input-feedback follow-up awaits hosted delivery.
