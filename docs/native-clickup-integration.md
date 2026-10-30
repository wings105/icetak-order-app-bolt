# Native ClickUp integration

Production cutover: 30 October 2026 (Malaysia).

## Creation

The existing production-readiness rules, integration_outbox queue, one-component dispatch guard and admin queue controls are retained. The queue provider string `activepieces` is a legacy database discriminator, not an external dependency.

`clickup_gate.dispatch_native_creation()` is scheduled every minute and calls the outbox Edge Function with the existing Vault worker credential. POST runs native creation; GET is the legacy AP polling contract. When system_settings.native_clickup_integration.creation_enabled is true, authenticated AP GETs return count=0 and no claim. Preview requests remain read-only.

create-body.ts mirrors the supplied AP export: compact task names, list 18375902, decoshop tag, courier dropdown mapping, pickup customer name versus shipped Order ID, noon Malaysia due dates, IDs, phone, wording, address, paid/confirmed, price, job and set fields. Initial status and component payload continue to come from the canonical database functions.

The worker reconciles existing tasks by component/order custom fields before claiming. Successful POST IDs are linked before a verified GET snapshot is accepted. All components must link before the queue becomes processed. Rate-limit rejection can safely retry; ambiguous POST outcomes remain guarded against another create and require reconciliation. Failures remain visible in queue and HTTP audit records.

## Inbound updates

ClickUp sends signed webhooks directly to clickup-order-gate-sync. The folder registration covers folder 7999455, retaining the AP filter; the existing two list registrations remain supported. Each raw event is persisted in the private native_events inbox before acknowledgement. Histories are batched into clickup-events-ingest and processed through the existing black box. Catalog list 901604488980 is routed to product-catalog-sync. The existing list allowlist remains authoritative.

The native worker uses a Vault secret checked through the service-role-only worker_auth RPC. Unsigned/incorrectly signed webhook calls return 401. Coalesced task jobs retain every history item, retry on failure, and preserve events arriving during a lease. Processed inbox records expire after 14 days.

## Operations and rollback

Disable only the two AP flows corresponding to the supplied exports: minute-based creation and ClickUp Task Updated forwarding. Other AP flows are outside this migration.

Creation rollback: set creation_enabled=false, allow native in-flight work to finish/reconcile, then re-enable legacy AP polling. Never bypass the component dispatch guard. The AP update path remains compatible for rollback; native delivery and AP must not be assumed to use identical event identifiers.

## Verification

- Mapping contract: node scripts/test-native-clickup-mapping.mjs (5 scenarios).
- Live test order with acrylic and edible components: two native_created_verified audit records, two linked ClickUp tasks, processed outbox with two attempts and no duplicate tasks.
- Live ClickUp status change produced native webhook history with processing_status=applied and updated the component's ClickUp status.
- Invalid webhook signature rejected with HTTP 401.
- Test tasks archived after verification; test order cancelled. No WhatsApp notification requested.

The admin UI may retain legacy Activepieces wording until a later UI deployment. The runtime no longer uses AP for these two paths.
