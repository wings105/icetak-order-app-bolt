# CRM ClickUp identity ingest

Production Supabase project: `buivecgahhmrhlmfujgt`. This function updates the existing Order System CRM.

## Make.com

POST `https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/crm-identity-ingest?token=<private-token>` with JSON body:

```json
{
  "order_sn": "26091551XDFX2T",
  "shopee_user_id": "463701227",
  "shopee_username": "mistinasantim",
  "phone": "0123456789",
  "clickup_id": "optional-task-id"
}
```

Use the order number whenever available. The endpoint validates order username and user ID before linking an identity. Phone numbers are normalized to `601...`. Repeated calls for the same identity are idempotent. A conflicting number is returned for review instead of overwriting the current one. Inspect `results[0].result.status` after each request; HTTP 200 does not mean every identity matched. Values such as `identity_conflict`, `manual_review`, `unmatched_order`, or `unmatched_customer` require action.

The private token is only supplied to the Make URL. Do not commit the actual URL with its token.

## Historic ClickUp CSV

Open `/functions/v1/crm-identity-ingest/import?token=<private-token>` and upload a CSV. This browser page sends 50 rows per request. Required columns are `clickup_id`, `phone`, and one of `order_sn`, `shopee_user_id`, `shopee_username`. Optional columns: `address`, `address_line1`, `city`, `postcode`, `state`, `name`. Rename ClickUp export headers to these exact names before upload. Preserve `clickup_id` as a stable identifier so reimport updates the same row.

Imported addresses are stored as ClickUp sources, never marked default or verified. If a username lacks a Shopee user ID and is not yet recognized by Order System, it is staged in `crm_clickup_import_rows` with a master CRM profile; it is not automatically considered a verified Shopee account. Review conflicts shown in the import report.

The current function source and migration live in this repo. Never put a service role key in the CSV or request.

## Verified webhook phone merge (2026-10-04)

A token-authenticated live Make/AP mapping containing an existing Shopee order may reconcile its matched marketplace master with the canonical exact phone owner. The service-only `icetak_reconcile_webhook_phone` reads both primary phones and verified inbound WhatsApp phone identifiers. It prefers the verified WhatsApp owner even when that profile has no primary phone yet, and uses the existing CRM merge function while remapping legacy ClickUp staging rows. Locks and source/master checks make retries idempotent. Existing different verified phones, competing owners, order/customer mismatch and invalid mobile numbers return review/conflict; CSV, username-only and user-ID-only imports cannot auto-merge. Phone is taken from the authenticated structured mapping, never arbitrary chat text.

The RPC validates the exact order/customer relationship and is unavailable to anon/authenticated roles. `crm-identity-ingest` v5 retains its existing hashed private token auth and verify_jwt=false. Existing v4 live webhook behavior was used as the baseline; this corrects its primary-phone-only lookup and partial staging remap. No new provider messages or task/order/payment status changes.
