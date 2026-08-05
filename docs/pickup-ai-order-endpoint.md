# Pickup AI Order Endpoint

Creates a pickup / pay-at-counter order after reading the customer's WhatsApp conversation in Unified Inbox. The Order System keeps the payment unpaid as `cash_counter`, approves production, and queues the existing ClickUp production outbox.

## Endpoint

```text
POST https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/pickup-ai-order-trigger
```

Authentication accepts either header:

```text
x-pickup-ai-key: <PICKUP_AI_PUBLIC_TOKEN>
```

or:

```text
Authorization: Bearer <PICKUP_AI_PUBLIC_TOKEN>
```

The token is stored only in Unified Inbox `private_runtime_settings` under `pickup_ai_public_token`. Do not commit the token to GitHub.

## Minimal request

```json
{
  "phone": "601110955850",
  "request_id": "pickup-order-20260804-001"
}
```

`conversation_id` can be supplied instead of `phone`:

```json
{
  "conversation_id": "ad991726-fced-47a2-8289-eb335b6138d6",
  "request_id": "pickup-order-20260804-001"
}
```

Always send a stable unique `request_id`. Repeating the same value returns the existing order and does not create duplicate ClickUp tasks.

## Optional controls

```json
{
  "phone": "601110955850",
  "request_id": "pickup-order-20260804-001",
  "lookback_hours": 72,
  "date_need": "2026-08-05",
  "pickup_time": "15:00",
  "total": 30,
  "until_message_id": "31995fec-39c2-4712-a047-b1b1eb5bfaab",
  "cutoff_at": "2026-08-03T19:30:00+08:00"
}
```

- `lookback_hours`: 6–168; default 72.
- `date_need`: optional `YYYY-MM-DD` override.
- `pickup_time`: optional `HH:MM` override.
- `total`: optional order-total override.
- `until_message_id`: stops reading at a particular message, useful when later messages belong to another order.
- `cutoff_at`: timestamp alternative to `until_message_id`.
- `customer_name`: optional override.

## Dry run

```json
{
  "phone": "601110955850",
  "dry_run": true,
  "until_message_id": "31995fec-39c2-4712-a047-b1b1eb5bfaab"
}
```

Dry run reads and extracts the conversation but does not create an Order System order, outbox event, or ClickUp task.

## Processing flow

1. Resolve the WhatsApp conversation using `phone` or `conversation_id`.
2. Read the selected conversation window and split away older order blocks after long inactivity gaps.
3. Extract item type, theme, quantity, price, wording, reference media, due date, and pickup time.
4. Create an idempotent record in `pickup_ai_requests`.
5. Create the iCetak Order System order with:
   - delivery: pickup
   - payment method: Cash at Counter
   - payment status: `cash_counter`
   - customer confirmed: true
   - production approved: true
   - admin status: AI Pending Confirmation
6. Keep WhatsApp auto-notification disabled for this internally triggered order.
7. Queue `clickup.production.create` using the existing Activepieces ClickUp outbox.
8. Link the Unified Inbox conversation to the new Order System order.

The endpoint never records a payment transaction and never marks the order paid. Payment remains due at collection.

## Successful response fields

The response includes:

- `request_key`
- resolved conversation and WhatsApp link
- extracted total, date, pickup time, and items
- Order System `order_id` and `order_db_id`
- `payment_status: cash_counter`
- `production_approved: true`
- ClickUp outbox status and ID
- Order/admin/customer links

## Security

- The external token only authenticates this pickup endpoint.
- The internal bridge token is separate and is never returned to callers.
- Database RPC execution is restricted to `service_role`.
- `pickup_ai_requests` has RLS enabled and no anon/authenticated access.
- The endpoint cannot turn an order into a paid order.
