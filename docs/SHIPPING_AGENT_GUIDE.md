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

SPX tracking links support both `MY` followed by digits and the observed ParcelDaily
format `MY` followed by digits plus `A`. Keep the provider tracking number intact;
do not remove the suffix to satisfy a validator. Regression assertions are in
`supabase/tests/spx_tracking_suffix.sql`.

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

## Credit statement

Shipping & Tracking also mounts the private wallet read model described in
[PARCELDAILY_CREDIT.md](PARCELDAILY_CREDIT.md). It does not change shipment booking,
tracking, checkout or customer notification behavior.

## SPX alphabetic suffixes

The shared tracking-link and courier helpers accept MY + digits with an optional
single A–Z suffix. Input is trimmed and uppercased; the complete tracking number
is retained in the SPX URL. Numeric SPX, Ninja and J&T behavior is retained;
multiple-letter suffixes, missing digits and URL fragments remain rejected.

The suffix rollout privately snapshots existing newly supported unsent shipments,
sets their per-shipment auto-send OFF, and refreshes their derived tracking state
without queueing historical notifications. New shipments retain normal first-scan,
opt-in, global/per-shipment, cancellation and idempotency guards. Recovery identifiers
and prior state stay in private_runtime_settings, not public documentation.

Native helper assertions cover all A–Z suffixes and malformed input. A rolled-back
queue test proves the historical hold, enabled B link payload and duplicate guard;
no fixture queue or customer send persists. Live recovery readback confirms valid
links and zero queued/sent records for the bounded recovery set.

## Daily Pending Pickup admin digest

The internal `shipping-pickup-digest` worker checks generated AWBs without a physical courier scan at the configured daily MYT cutoff. It includes unresolved earlier bookings, with oldest AWBs first; tracking numbers retain their complete courier suffix. A booking/consignment/AWB artifact is required. Archived, cancelled, returned, refunded and delivered shipments, manually cancelled tracking, cancelled canonical orders, first-scan state and physical scan events are excluded. Failure/exception labels alone do not hide an unscanned AWB.

The service-only snapshot and enqueue RPCs use `SECURITY INVOKER` with a private RLS-protected daily receipt. A transaction lock and date-based queue idempotency key allow one admin digest per MYT date. Empty results are recorded silently. Safe later scheduler slots can retry a known template preflight rejection using the same queue job; unknown delivery outcomes are not requeued by this worker. The normal dispatcher retains its existing retry policy and sent-outbox idempotency. A subsequent day's digest reevaluates all unresolved AWBs.

The recipient comes from the existing admin notification setting. Enqueue checks the WhatsApp master and event rule; the sender rechecks the master and admin recipient at dispatch time. The message never creates customer tracking jobs. Existing sender window rules choose freeform during an open session or the dedicated `icetak_pending_pickup_digest_ms` utility template after approval. Template status is refreshed automatically while pending. The freeform digest shows up to 25 oldest AWBs with order references and booking times; the template summarizes up to 15 tracking numbers, a remaining count and the Shipping page link. The private receipt retains the full snapshot.

`dry_run:true` on the internally authenticated worker reads the snapshot without queue, receipt or provider writes. Production deployment v1, native rolled-back exclusion/empty/master/recipient/idempotency/retry/privacy assertions and actual-handler MYT boundary/window/template tests are verified. Production read-only preview and the before-cutoff guard pass with zero persisted digest jobs/outbox messages. First scheduled delivery and utility-template approval remain operational acceptance checks. Regressions: `node scripts/check-pending-pickup.mjs`; run `scripts/check-pending-pickup.sql` as the database owner in one request (it rolls back and requires an active unscanned fixture).
