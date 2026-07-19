# iCetak Shipping Agent

## Live endpoints

Authenticated agent actions:

`POST https://buivecgahhmrhlmfujgt.supabase.co/rest/v1/rpc/shipping_api_gateway`

Public tracking:

`POST https://buivecgahhmrhlmfujgt.supabase.co/rest/v1/rpc/shipping_public_tracking`

The authenticated request uses these headers:

```text
apikey: SUPABASE_PUBLISHABLE_OR_ANON_KEY
Authorization: Bearer SUPABASE_LEGACY_ANON_JWT
X-API-Key: ICETAK_SHIPPING_API_KEY
Content-Type: application/json
```

ParcelDaily token, merchant ID, service-role key, and webhook secret remain inside the backend and must never be given to an AI.

## Autonomous rules

A direct-address shipment is allowed only when:

- `confidence >= 0.95`
- `order_context.paid = true`
- `order_context.production_ready = true`
- name, phone, address line 1, city, postcode, and state are complete
- the same stable `reference` does not already have an active shipment

The database obtains a transaction-level advisory lock for the reference and checks the shipment again before calling the provider. This prevents concurrent agents from creating the same AWB twice.

## Defaults

- Sender: `shipping_settings.origin_address`
- Weight: `1 kg`
- Description: `decoration cake`
- Item value priority: request value, order total, then `RM50`
- Courier: cheapest available for `auto`
- Agent mode: `automatic`
- Minimum autonomous confidence: `0.95`

## Direct-address creation

```json
{
  "p_payload": {
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
}
```

The gateway creates an internal paid and production-ready order for auditability, then calls the JWT-protected `shipping-agent` synchronously.

## Existing-order creation

```json
{
  "p_payload": {
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
}
```

## Tracking and AWB lookup

```json
{
  "p_payload": {
    "action": "get_tracking",
    "tracking_no": "MY069538660237"
  }
}
```

```json
{
  "p_payload": {
    "action": "get_awb",
    "tracking_no": "MY069538660237"
  }
}
```

The lookup returns:

- current master shipment
- ordered `shipment_events` timeline
- ParcelDaily `connoteURL` when available
- `thermalConnoteURL` when available
- Supabase signed AWB URL when an archived PDF has been generated
- AWB pending/error state

Webhook checkout and tracking events update the same shipment master. Events from orders created before this system are also auto-created and linked when ParcelDaily sends a later update.

## Public tracking

```json
{
  "p_public_tracking_token": "SHIPMENT-PUBLIC-TOKEN"
}
```

The public response excludes recipient address, sender address, phone numbers, prices, provider payloads, API keys, and internal agent logs.

## Duplicate protection

- Gateway lock by stable `reference`
- Active shipment lookup before provider creation
- Webhook uniqueness: `(provider, provider_event_id)`
- Timeline uniqueness: `(provider, provider_event_id)`
- Repeated provider webhooks are acknowledged without creating another event

## Data model

- `shipments`: current shipment master
- `shipment_events`: normalized event timeline
- `shipping_webhook_events`: raw webhook inbox and processing state
- `shipping_agent_runs`: action and decision audit
- `shipping_quotes`: quote options considered
- `shipping_exceptions`: retryable or human-review issues
- `shipping_api_clients`: hashed API clients and scopes

## Source code

Full Edge Function source for `shipping-agent`, `shipping-api`, and PDF archival service `shipping-awb` is stored in this repository. The live RPC gateway is installed through Supabase migrations, so external AI integration does not depend on a custom-auth Edge Function deployment.
