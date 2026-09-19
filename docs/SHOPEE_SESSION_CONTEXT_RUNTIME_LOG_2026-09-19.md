# Shopee Session Context Runtime Log

Date: 2026-09-19
Branch: production
Scope: Documentation only. No application code or production deployment is changed by this commit.

## Runtime changes already applied directly in Supabase

### Order System Supabase
Project: icetak-order-system

- Updated deployed Edge Function `sync-marketplace-orders-to-inbox`.
- Shopee session cutoff timestamp now uses raw Shopee webhook event:
  - provider = `shopee`
  - event_code = `3`
  - `parsed_payload.data.status = SHIPPED`
- `READY_TO_SHIP` and `PROCESSED` are not session cutoffs.
- New sync payload version:
  `marketplace-order-v3-raw-shipped-cutoff`

### Unified Inbox Supabase
Project: icetak-unified-inbox

Created runtime session support for Shopee order chat:

- table: `shopee_order_sessions`
- trigger/function to sync Shopee order summaries into order sessions
- deployed Edge Function: `shopee-session-context`

Session model:

- one Shopee customer conversation may contain many orders
- one order is treated as one order session
- session closes when Shopee raw webhook reports `SHIPPED`
- chat after the SHIPPED cutoff must not be used as context for the previous order

## AI confidence / admin-review gate

Normal single-order flow:

- paid order
- one unambiguous order/session
- required iCetak SOP details complete
- AI confidence >= 0.90
- result can return `auto_confirm_allowed = true`

Ambiguous flow must require admin review.

Examples:

1. More than one paid, unshipped order for the same Shopee customer inside the current session window.
   - confidence cap: 0.35
   - `review_required = true`
   - no auto confirm

2. Multiple distinct items without an explicit item/order reference in chat.
   - confidence cap: 0.45
   - `review_required = true`
   - no auto confirm

3. Multiple distinct items with identifiable item/order references.
   - confidence cap: 0.82
   - below current 0.90 auto-confirm threshold
   - admin review required

## Activepieces integration endpoint

Endpoint deployed in Unified Inbox Supabase:

`POST https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-session-context`

Typical context request:

```json
{
  "order_no": "260919ABC123",
  "limit": 100
}
```

AI assessment request after AP parses the order:

```json
{
  "order_no": "260919ABC123",
  "ai_confidence": 0.96,
  "sop_complete": true
}
```

Important response fields:

- `gate.review_required`
- `gate.confidence_cap`
- `gate.final_confidence`
- `gate.confidence_level`
- `gate.auto_confirm_allowed`

Activepieces rule:

- `auto_confirm_allowed = true` -> continue automatic confirmation flow
- otherwise -> send to Admin Check

## Important implementation note

These changes were applied directly to Supabase runtime before this log was created.

This GitHub commit is documentation only and does NOT sync the deployed Supabase Edge Function source or database migration into this repository.

A future source-sync task should separately commit the matching Supabase function/migration files if GitHub is to become the complete source of truth for these runtime changes.


## Activepieces custom token auth update

Runtime update applied directly in Unified Inbox Supabase on 2026-09-19:

- `shopee-session-context` now uses custom API-token authentication.
- Supabase platform JWT verification is disabled for this function (`verify_jwt=false`).
- Caller must send header `x-api-token`.
- Token is validated by SHA-256 hash against `public.integration_api_tokens`.
- Plain token is not stored in the database and is not committed to GitHub.
- Active token name: `activepieces-shopee-session-context`
- scopes:
  - `shopee-session-context:read`
  - `shopee-session-context:assess`

Activepieces request headers:

```text
x-api-token: <secret token>
Content-Type: application/json
```

No Supabase service-role key should be stored in Activepieces for this endpoint.
