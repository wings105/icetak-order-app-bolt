# Storefront catalogue rollout

Status: VERIFIED backend/data and controlled rendered customer/ERP flow; production frontend delivery and final publication pending. Owner authorized the complete original storefront plan on 2026-10-16 after approving the Glossy purchase surface. Based on production `a9920ca`; existing basic services, Inbox and independent Shopee edit jobs are retained.

## Catalogue and administration

`icetak_catalog_admin` is service-only behind product-admin's existing JWT/active-admin gateway. Staff reads; owner mutations. List/search exposes website readiness and bounded status/count projections. Selected up to 40 products can preview/configure/prepare/publish/unpublish and restore an audited change. Product versions detect stale edits; a UUID request receipt makes retries idempotent. Per-item failures roll back only that item and return explicit partial results. Restore requires the current product/variant snapshot to match the event's after-state; later edits/import/provider snapshots are not overwritten silently. Basic services cannot be changed by bulk catalogue actions.

Preparation uses evidence from source title, SKU and material description to suggest one production type, selects its exact model profile/category, preserves website model prices, and stores website-only description and order settings. NORMAL source status, one source listing, a cover and available priced models are required for automatic preparation. Ready-stock, unsupported, unavailable, unlisted or ambiguous records remain visible for owner review. Provider status and website publication remain independent. Manual configuration can explicitly choose the category, process, price source/fixed price and wording/review/upload flags. Reimport preserves website changes. No SKU identity joins or Shopee field writes are introduced.

Original 8 published products preserved. One real Spiderman product published through audited owner-authorized preparation (`00e02ee8-bd3d-414f-bbf4-01b63dbfd89f`, request `ad9b2465-5590-43dd-8e4d-28adc305433c`). A further 1,736 products prepared as drafts through the same bounded audited RPC, ready for publication after frontend delivery. All 2,004 source listings remain; zero outbound product jobs.

## Customer storefront

The existing home keeps its six service shortcuts and adds a real catalogue grid/category counts. Public invoker `icetak_store_catalog` uses existing product/profile/variant RLS, with bounded query/category/sort/pagination, website min/max price and availability. Source listings/private audit data are never exposed by it. A legacy published demo without a cover is omitted from browsing. Known export boilerplate is removed only from customer-facing labels; source titles remain unchanged in DB/audit.

All configured catalogue design categories reuse the owner-approved corner utilities/fixed purchase bar/selection sheet. Existing service routes stay separate. Exact model UUID selects authoritative website price/stock, model-specific Add Wording/No Wording constraints and image. Acrylic starts at Gold/A6 when available. Custom size ranges require customer measurements and design review; the nominal purchased size remains the material/price bound. Cart retains model, wording, custom measurements and upload receipts and supports Edit.

## Private customer originals

`catalog-upload` accepts JPEG/PNG/WebP originals up to 8 MiB, checks magic bytes and published product settings, applies private per-client/global daily counters and returns a random product-scoped capability. Private `catalog-customer-files` bucket has no public browser write/read grant. Up to three original files attach to an item; Burn Away requires explicitly identified Edible and Wafer images. Capabilities are SHA-256 hashes server-side, expire after seven days while unclaimed, and cannot be reused for another order. Claim is transactional with order creation. Public customization contains only sanitized names and order-bound reference links, never upload capabilities.

`catalog-file` checks exact order token + linked upload and redirects to a five-minute signed URL. Possession of the existing public order token grants access to that order's references. Links are shown in the existing admin item editor/customer dashboard and included in the existing ClickUp outbox description. No customer photo is used as an approved production artwork automatically. Daily bounded cleanup deletes expired unclaimed originals; order files are retained.

## Checkout and production

Authoritative catalogue validation still runs before order/payment creation. New private checkout receipts and advisory locks reuse one result for exact browser retries and reject a reused key with a changed payload. Only the new idempotent customer checkout invokes the existing serialized QR amount allocator during initial insertion; equal-price orders receive separate matchable amounts. Other sources retain their existing initial-session behavior. No guard or amount matching is disabled.

Two legacy trigger defects were found by real rollback tests and corrected narrowly: explicit/managed product profiles survive title/category edits; catalogue Burn Away layer sizes come from the selected model rather than the old default 5-inch normalization. Basic-service normalization is retained. Layer size, shape, requested measurement/review and each file reference reach the real order/component metadata. Existing ClickUp production lifecycle and material-stock ownership remain unchanged.

## Backend deployment

Order migrations: 20261016140328 readiness, 140336 uploads, 141230 checkout integrity, 141916 profile guard, 142041 payment allocation, 143504 custom-size details, 143917 Burn Away sizes (all dated 2026-10-16).

product-admin v4: existing JWT/active admin gates. catalog-upload v1: public upload admission plus random capability/private cleanup authentication. catalog-file v1: exact order capability. clickup-production-outbox v43: existing custom secret/one-per-claim behavior retained. Exact source/auth readback of v4/v1/v1/v42 passed before the final one-line requested-size outbox addition; repeat final v43 readback on release. No provider credentials enter browsers or source.

## Verification

- `supabase/tests/storefront_catalog.sql`: production rollback assertions for preview/no write, bulk idempotency/restore, authoritative model/wording/price, required custom size/review, exact retry one order/payment, equal-total amount allocation, stock limits, SPX shipping total, two Burn Away components, correct layer sizes/references, private upload capability/link/no reuse and grants. No test orders/payments/files remain.
- A separate rollback assertion proves partial bulk success and website fixed-price changes leave the provider snapshot unchanged. Previous shared catalogue test passes.
- Actual Vite storefront and Products + ERP shell with real product read fixtures and mocked gateways: 1440×1000, 390×844, 320×640. Selected bulk preview/partial result, restore preview, website description, home cards, sort/pagination, Glossy custom/image cart, Edible model-specific wording, Acrylic required wording, Wafer required image, Burn Away separate images and contained mobile layout pass without page errors. Browser plugin absent; Playwright used. Screenshots compared to the approved existing orange/white purchase design; titles, gallery framing, corner utilities, modal controls and bottom footer checked. No generated visual concept needed for this extension of the accepted design system.
- Actual deployed upload/preview/signed original download 200; downloaded bytes exactly match original. Wrong upload token 404, public object 400, wrong order 404, anonymous admin 401. Cleanup returned 200/removed 1; smoke record and storage object both absent. No customer/provider send.
- Eleven ClickUp task field/handler tests, importer checks, targeted TypeScript, full root+Inbox build and diff whitespace pass. Security advisor baseline 7 / after 7, no new findings.

## Release work remaining

Merge/deploy the tested frontend, publish the prepared ready products in bounded audited batches, verify real public search/category/price/page and product/options/cart/upload with live data, record exact release/Worker/bundle and final published/review counts. Hosted signed-in staff actions are not available in this session; controlled ERP and live service contracts are the verification boundary.
