# iCetak Shipping Agent

## Purpose

This API lets a trusted AI agent or external system create and book ParcelDaily shipments without receiving the ParcelDaily token or merchant ID. Provider secrets stay inside Supabase Edge Function secrets.

## API endpoint

`POST https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/shipping-api`

Authenticated actions use the `X-API-Key` header. The public tracking action uses a shipment `public_tracking_token` and does not require the API key.

## Autonomous creation rules

A direct-address request is allowed to create and pay a shipment only when:

- `confidence >= 0.95`
- `order_context.paid = true`
- `order_context.production_ready = true`
- recipient name, phone, address line 1, city, postcode, and state are present
- an active shipment with the same stable `reference` does not already exist
- the selected quote is allowed by the configured shipping policy

The API creates a ready/paid internal order record for traceability, then calls the internal shipping agent.

## Defaults

- Sender: read from `shipping_settings.origin_address`
- Weight: `1 kg`
- Description: `decoration cake`
- Item value: request value, then order total, then `RM50`
- Courier: cheapest available when `courier_preference = auto`
- Agent mode: `automatic`
- Minimum autonomous confidence: `0.95`

## Create and book from a supplied address

```json
{
  "action": "create_and_book_shipment",
  "reference": "AI-ORDER-12345",
  "confidence": 0.98,
  "order_context": {
    "paid": true,
    "production_ready": true,
    "order_total_rm": 85
  },
  "delivery_address": {
    "fullName": "Customer Name",
    "phone": "60123456789",
    "line1": "12 Jalan Example",
    "line2": "",
    "city": "Kota Bharu",
    "postcode": "15000",
    "state": "Kelantan",
    "country": "Malaysia"
  },
  "parcel": {
    "weight_kg": 1,
    "content": "decoration cake",
    "content_value_rm": 85
  },
  "options": {
    "courier_preference": "auto"
  }
}
```

## Create and book from an existing order

```json
{
  "action": "create_and_book_shipment",
  "order_reference": {
    "order_id": "EXTERNAL-ORDER-ID"
  },
  "reference": "EXTERNAL-ORDER-ID",
  "confidence": 1,
  "options": {
    "courier_preference": "auto"
  }
}
```

## Retrieve tracking and events

```json
{
  "action": "get_tracking",
  "tracking_no": "MY069538660237"
}
```

The response contains the current shipment row and the ordered timeline from `shipment_events`.

## Retrieve or regenerate AWB

```json
{
  "action": "get_awb",
  "tracking_no": "MY069538660237"
}
```

Use `refresh_awb` to force a new ParcelDaily PDF download. The AWB service:

1. calls `POST /v1/partner/consign-pdf/` with `{ "connote": "TRACKING_NO" }`
2. verifies the response is PDF
3. retries up to three times
4. uploads it into private bucket `shipping-labels`
5. returns a signed URL valid for seven days
6. stores the path and AWB state on `shipments`

ParcelDaily `connoteURL` and `thermalConnoteURL` are also stored when supplied by checkout status or webhook events.

## Public tracking

Use the `public_tracking_token` returned with a shipment:

```json
{
  "action": "get_public_tracking",
  "public_tracking_token": "SHIPMENT-PUBLIC-TOKEN"
}
```

This response excludes recipient address, sender address, phone number, prices, raw provider payloads, and internal logs.

## Duplicate protection

- Shipment creation uses a stable `reference` and returns the existing active shipment when that reference already exists.
- Webhooks are unique by `(provider, provider_event_id)`.
- Timeline events are unique by `(provider, provider_event_id)`.
- A repeated ParcelDaily webhook is acknowledged but not processed again.

## Event storage

- `shipments`: one current master record per shipment
- `shipment_events`: normalized timeline
- `shipping_webhook_events`: raw provider event inbox and processing state
- `shipping_agent_runs`: agent decisions and result audit
- `shipping_quotes`: provider quotes considered
- `shipping_exceptions`: retryable or human-review issues

## Security

Never give an AI the ParcelDaily token, merchant ID, Supabase service-role key, or webhook secret. Give it only the scoped iCetak API key and the OpenAPI file.
