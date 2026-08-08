# iCetak Finance Webhooks

Finance ingestion is live in Supabase project `buivecgahhmrhlmfujgt`.

## Endpoints

| Source | Method | URL | Default direction |
|---|---|---|---|
| QRPay received | POST | `https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/finance-webhook/qrpay-in` | Money in |
| CIMB outgoing | POST | `https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/finance-webhook/cimb-out` | Money out |
| CIMB bank statement | POST | `https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/finance-webhook/bank-statement` | Read from row |

Send the source-specific secret in this header:

```http
x-icetak-webhook-secret: <source secret>
content-type: application/json
```

The legacy `x-webhook-key` header is also accepted for the QRPay endpoint so the current payment key can be reused.

Never put a secret in the URL/query string. Query strings are commonly retained in access logs.

## Single transaction payload

```json
{
  "transaction_id": "unique-provider-reference",
  "amount": 100.00,
  "direction": "in",
  "transaction_date": "2026-08-08T18:30:00+08:00",
  "description": "Bank transaction description",
  "counterparty": "Customer or supplier",
  "bank_reference": "optional-bank-reference",
  "currency": "MYR"
}
```

Only `amount` and a direction are essential. The endpoint accepts common alternatives such as `paid_amount`, `credit`, `debit`, `paid_at`, `posted_at`, `sender_name`, `recipient_name`, `ref_no` and `rrn`.

## Statement batch

```json
{
  "statement_id": "CIMB-2026-08-08",
  "transactions": [
    {
      "transaction_id": "CIMB-001",
      "credit": 100.00,
      "transaction_date": "2026-08-08",
      "description": "DUITNOW RECEIPT"
    },
    {
      "transaction_id": "CIMB-002",
      "debit": 50.00,
      "transaction_date": "2026-08-08",
      "description": "TRANSFER TO SUPPLIER"
    }
  ]
}
```

Up to 5,000 rows and 2 MB are accepted per request.

## Response and retries

- HTTP 200 means the request was accepted.
- `duplicate: true` means the event was already processed.
- `matched_existing: true` means a second source confirmed an existing canonical transaction.
- `review_required: true` means Finance held a possible duplicate for Zaim to resolve.
- HTTP 401 means the secret is absent or wrong.

Providers may safely retry the same event. The idempotency key is based on the provider reference when present, otherwise a stable payload hash.

## QRPay compatibility

The QRPay route first calls the existing `icetak_payment_webhook` matcher. It therefore preserves the current Payment Session and Order status flow, then records the same receipt in Finance. This bridge avoids choosing between the old Payments Center and the new accounting ledger.
