# Quick Order Draft Contract V1

Production status: LIVE — 2026-08-14.

## Goal

QRPay, chat-trigger and pickup drafts use the same item contract as Admin Quick Order and `order_items` in the Admin Orders app.

Canonical editable item fields:

- Product kind: Edible / Burn Away / Wafer / Topper / Mirror Gold / Acrylic
- Process
- Review
- Size
- Style / Colour
- Qty
- Wording / detail
- Reference URL
- Unit price derived from the same Quick Order V1 variation matrix

## Server contract

`icetak_quick_order_price()` mirrors `icetak-admin/src/lib/orderProducts.ts`.

`icetak_enrich_draft_quick_order_v13()` normalizes AI draft payloads before persistence for both QRPay and generic chat/pickup drafts. It also extracts current-session address, shape/style and wording where evidence exists, removes invalid dates, and stamps `qrpay-ai-draft-v13-quick-order-contract`.

`qrpay-draft-review` normalizes every Save / Approve / Confirm payload again server-side. Client-side values therefore cannot bypass the Quick Order pricing/variation contract.

`icetak_create_order()` persists `process` as `order_items.customization.admin_process` and Reference URL as `design_preview_url` / metadata. Draft conversions additionally run `icetak_sync_draft_items_to_order()` by deterministic `sort_index`.

Courier address is optional at admin draft / QRPay confirm. Missing courier address is marked `[ADDRESS PENDING - lengkapkan sebelum shipping]` and can be completed later. Customer checkout still requires courier address before customer confirmation/payment.

## Production verification

Pricing matrix tests passed:

- Edible 4 inch Round, Pre-order, No Review = RM6
- Edible 4 inch Square = RM12
- Edible 5 inch Round = RM12
- Edible 5 inch Urgent + Need Review = RM14
- Topper = RM10
- Burn Away 5 inch = RM18
- Wafer 7 inch = RM12
- Mirror Gold urgent = RM18
- Acrylic A6 Standard urgent = RM25

Order-item contract integration test passed with two products:

- sort indexes `[0,1]`
- processes `[Pre-order,Urgent]`
- reviews `[false,true]`
- size/style/wording preserved
- Reference URLs persisted as `design_preview_url`
- no test orders left behind

Regression case `QR28004399` (read-only replay of AI Original) now normalizes to:

- Edible Image
- Pre-order
- No Review
- 5 inch
- Round / Bulat
- RM12
- wording `Bye-bye OH Department, thank youu`
- current-session delivery address / postcode / Kuantan
- invalid legacy AI date removed instead of stored
- RM12 + SPX RM4.50 = RM16.50, exactly reconciled to payment

The already-confirmed historical order was not rewritten; the case is used only as a regression fixture.