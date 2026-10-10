# WhatsApp API outbound logging

## Ownership and scope

Order System (`buivecgahhmrhlmfujgt`) owns notification delivery and its durable `whatsapp_outbox`. Unified Inbox (`uujcqcsfghqkukaydruc`) owns conversation messages. A successful send through Order `whatsapp-send` is explicitly mirrored to Inbox; it does not depend on a WhatsApp Business App echo. Direct sends from AP/Make/other provider callers still need their own log callback or routing through this sender. The legacy `external-outbound-log` endpoint is unchanged.

## Delivery and log retry

The sender must register an outbox row before contacting the provider. The full unique idempotency index permits the existing PostgREST `on_conflict=idempotency_key` upsert; the older partial indexes alone could not satisfy that target. Audit-registration failure returns 503 without sending.

After provider success, the sender saves the provider message ID, original body and send time, then sets `inbox_sync_status=pending`. `_shared/whatsapp-inbox-sync.ts` posts only the saved projection to the fixed Inbox `order-whatsapp-outbound` endpoint. Both projects reuse the existing private `admin_window_bridge_token`; no credentials enter message metadata or the browser.

Successful logging marks the outbox `synced`. Logging failure preserves delivery status `sent` and sets only log retry fields. Existing minute dispatchers drain at most 20 due rows per invocation; retry delay grows to 15 minutes. A repeated successful-send idempotency key also repairs pending logging, without another provider call. Never requeue delivery to repair a missing Inbox record.

Inbox uses a service-role-only, SECURITY INVOKER RPC. It resolves exactly one existing customer from phone/BSUID, rejects conflicting identities and requires an existing WhatsApp conversation. Unknown or ambiguous identities remain a log retry requiring investigation; it does not guess/create customers. Provider message ID deduplicates native messages. New records are `outbound`, `system`, `icetak_api`, with original send/creation timestamps. Existing richer message status is retained on duplicates. Historical records do not replace a newer incoming message, clear unread/needs-reply, or reopen an order session. Canonical order IDs stay in metadata; native message order IDs use the Inbox conversation's local order reference.

The endpoint requires the private bridge header even though platform JWT verification is disabled. Missing credentials return 401. It only logs; it never contacts WasapFlow.

## Production evidence, 2026-10-10

- Order migration `20261010075837` and Inbox migrations `20261010075849`, `20261010080246` applied. Keep both Inbox migrations append-only; the latter establishes the final RPC without writing a non-UUID source-event reference.
- `whatsapp-send` v29, `whatsapp-dispatch` v18 and `order-whatsapp-outbound` v1 deployed; all bundled local files match live source exactly and auth modes are verified.
- Real service-role rollback tests verify the outbox conflict target, original message time/provenance, duplicate ID, conflicting inbound ID/identities, private grants and preservation of newer customer state. No fixture remains.
- Controlled actual sender tests verify one provider call when logging fails, delivery remaining sent, duplicate-send retry repairing only the log, and audit failure preventing delivery. Existing opt-out regression passes.
- Three already-sent text notifications for order IC261010-1391 were recovered from their successful notification queue records, provider IDs and saved variables. Corresponding rules predated each send; pickup uses the paid wording. Outbox recovery provenance is explicit; no original full provider response is invented.
- Authenticated log-only requests returned persisted message IDs; the existing dispatcher independently marked all three outboxes synced on its first attempt. Inbox contains each provider ID once at 14:56, 15:03 and 15:23 MYT. Customer reply at 15:27, unread count and needs-reply remain unchanged. No recovery request invoked the provider or resent messages. Missing-header rejection returned 401.

Verification covers persisted production backend behavior. No new customer send or authenticated hosted browser interaction was performed for QA; refresh the existing conversation to load recovered history.

## Checks and operations

Run `node scripts/check-whatsapp-inbox-sync.mjs` and `node scripts/check-whatsapp-order-optout-guards.mjs`. SQL rollback coverage is `backend/inbox/order-whatsapp-outbound.test.sql`.

Inspect `status`, `provider_message_id`, `inbox_sync_status`, `inbox_sync_attempts`, `inbox_sync_next_at` and `inbox_sync_error` for a known outbox. Fix identity/configuration issues before retrying the log. Never expose private settings in results. Historical recovery must be bounded to proven successful sends with exact content/time/identity evidence; this release does not broadly backfill historical messages.
