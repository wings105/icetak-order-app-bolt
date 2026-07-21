# Payment Matching

## Rule

Only one matchable payment session may own an exact DuitNow amount at a time.

Example for two RM6.00 orders created close together:

```text
Order A → RM6.00
Order B → RM5.99
Order C → RM5.98
```

The adjustment is stored as `discount` and is limited to RM0.50.

## Time window

- Customer-visible QR session: 10 minutes.
- Internal bank-webhook grace: 2 minutes after expiry.
- An amount is not reused while it remains inside either window.

The grace prevents a payment made near the end of the countdown from being assigned to a newer order if the bank webhook arrives late.

## Atomic allocation

`icetak_prepare_payment` obtains a PostgreSQL transaction advisory lock before it checks and reserves an amount. This prevents two simultaneous checkouts from both selecting the same amount.

A table trigger provides a second layer of protection. Any direct insert or update that attempts to create a duplicate matchable amount fails with `payment_amount_in_use`.

## Matching webhook

`icetak_payment_webhook`:

1. Normalizes the received amount to two decimals.
2. Handles repeated transaction IDs idempotently.
3. Requires exactly one matchable session for the amount.
4. Does not guess when multiple candidates exist.
5. Stores zero-match or ambiguous transactions in `unmatched_payment_transactions`.
6. Marks the payment session and order paid only after an exact unambiguous match.

## Main fields

```text
payment_sessions.base_amount
payment_sessions.expected_amount
payment_sessions.discount
payment_sessions.amount_offset_cents
payment_sessions.expires_at
payment_sessions.reservation_grace_seconds
payment_sessions.status
payment_sessions.transaction_id
payment_sessions.matched_at
```

## Supported matchable statuses

```text
pending
submitted
receipt_submitted
pending_review
```

Matched, expired and superseded sessions no longer reserve their amount.
