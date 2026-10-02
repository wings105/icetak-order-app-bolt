# Shopee order finance receiver

Live Supabase project: `buivecgahhmrhlmfujgt` (`icetak-order-system`).

`POST https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/shopee-finance-ingest`

Use `Content-Type: application/json`. Authenticate with `x-webhook-token: <private token>`.
For providers that only let you configure a destination URL, append `?token=<private token>`.
The token is supplied privately to the owner and must never be committed to the repository.
The Edge Function compares its SHA-256 hash before accessing the database. No Supabase
Authorization header is required; JWT verification is disabled only for this receiver.

## Payload

Send the full order-level finance JSON, retaining `order_sn` (or `ordersn`/`orderno`).
Flat objects, arrays (up to 100 orders), and nested `response.order_income`/`data`
objects are supported. Common batch wrappers include `orders`, `order_list`,
`income_list`, `transactions`, `records`, and `data` arrays.

```json
{
  "order_sn": "261002ABCDEF12",
  "currency": "MYR",
  "escrow_amount": 20.00,
  "commission_fee": 1.00,
  "service_fee": 0.00,
  "seller_transaction_fee": 0.50
}
```

Send `released_amount`, a release timestamp (`released_at`/`escrow_release_time`),
or `settlement_status: "released"` when release has actually happened. Escrow or
`seller_income` alone is treated as pending income, not a wallet release. Release
timestamps use ISO 8601 or Unix seconds/milliseconds. All additional fee, tax,
discount and shipping breakdowns remain in the captured payload. Unsupported or
invalid financial mappings are retained for review instead of guessed.

An optional `shop_id` and currency must match the existing order. The receiver
never changes the operational Shopee order status, buyer payment status, or items.

## Storage and responses

- `finance.shopee_finance_events`: private, RLS-protected receipts and original
  payload (credential fields removed).
- `public.marketplace_order_financials`: normalized financial values linked to
  the existing Shopee order by `order_sn`.
- `finance.shopee_settlement_lines`: updated for that order only.
- `finance.wallet_events`: idempotent wallet release only when release is explicit.
- `marketplace_enrichment_jobs`: the financial-release job is completed on release.

HTTP 200 means applied or already processed. HTTP 202 means captured but waiting
for its order (`pending_order`) or needing field mapping (`needs_mapping`). An order
insert replays queued finance at the end of the database transaction. Repeated
payloads increment the receipt's duplicate count and do not create duplicate
settlements or wallet releases. A provider update timestamp, when present, prevents
older snapshots replacing newer financial values. Partial snapshots preserve
existing fields that were omitted. HTTP 401 means invalid receiver token; HTTP
400 means invalid JSON/row structure; HTTP 503 is retryable storage/runtime failure.

GET is a public health check and does not expose finance data. Add `dry_run=true`
to an authenticated POST to inspect mapping and order matching without writing.

## Verification

```sh
node --test supabase/functions/shopee-finance-ingest/normalize.test.ts
```

Run `supabase/functions/shopee-finance-ingest/receiver.test.sql` through a privileged
SQL client. It checks delayed matching, partial updates, release handling,
idempotency, stale snapshots, shop mismatch and private RPC permissions; all data
is rolled back. Live HTTP tests also cover health, unauthorized access, nested/flat
dry runs, and captured retries. Deployment test receipts are removed afterwards.
