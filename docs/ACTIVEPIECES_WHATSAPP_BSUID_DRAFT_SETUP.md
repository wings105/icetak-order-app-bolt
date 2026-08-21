# Activepieces WhatsApp draft triggers with hidden phone numbers

WasapFlow `message.echo` events can have no customer phone number. The business
number in `data.from` is never the customer. Resolve the stable customer ID in
this order:

1. `data.recipient_bsuid`
2. `data.raw.echo.to_user_id`
3. `data.user_id`

Use `data.recipient` or `data.to` as the customer `phone` only when the value is
an actual phone number. Do not send `data.from` as `phone`.

## Prepaid: exact `#ok` command

POST to the existing Unified Inbox endpoint:

```text
https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/order-draft-from-chat
```

Keep the existing authorized request headers. Configure the JSON body with the
matching Activepieces data-picker expressions:

```json
{
  "phone": "{{trigger.body.data.recipient}}",
  "bsuid": "{{trigger.body.data.raw.echo.to_user_id}}",
  "user_id": "{{trigger.body.data.raw.echo.to_user_id}}",
  "provider_message_id": "{{trigger.body.data.message_id}}",
  "event_timestamp": "{{trigger.body.data.timestamp}}",
  "request_key": "prepaid:{{trigger.body.data.message_id}}"
}
```

If an upstream expression can coalesce values, prefer
`data.recipient_bsuid || data.raw.echo.to_user_id || data.user_id` for both ID
fields. `phone` may be `null`, an empty string, or omitted.

## Pickup: exact `#noted` command

POST to the existing Unified Inbox endpoint:

```text
https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/pickup-ai-order-trigger
```

Keep the existing authorized request headers and use:

```json
{
  "phone": "{{trigger.body.data.recipient}}",
  "bsuid": "{{trigger.body.data.raw.echo.to_user_id}}",
  "user_id": "{{trigger.body.data.raw.echo.to_user_id}}",
  "provider_message_id": "{{trigger.body.data.message_id}}",
  "event_timestamp": "{{trigger.body.data.timestamp}}",
  "request_id": "pickup:{{trigger.body.data.message_id}}"
}
```

`user_id` and `bsuid` represent the same customer identifier. Both are accepted
for compatibility; the backend also accepts `conversation_id` when available.
Use the provider message ID for idempotency, not `trigger_message_id`: the
latter is an internal database UUID.

A pickup order can be completed without a phone number when it has a valid
BSUID. A courier order still requires a valid recipient phone and complete
delivery address before the customer can confirm it. WasapFlow sends the draft
link with `{ "user_id": "MY.…" }` when no WhatsApp phone is available.
