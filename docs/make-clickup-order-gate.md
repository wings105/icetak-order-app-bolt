# Make.com: ClickUp order gate — single HTTP setup
Live in Supabase project buivecgahhmrhlmfujgt, updated 2026-10-27.

## Make setup (only this module is required)
Webhook full order -> Sleep 30 seconds (optional) -> HTTP claim -> filter allow_create Is true -> existing Router / Iterator / Create Task flow.

POST https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-order-gate
Content-Type: application/json
Header x-order-gate-key: use the existing private key supplied to the owner; never commit it.
Body:
{"action":"claim","order_id":"MAP_ORDERNO"}
Parse response: Yes.
Map MAP_ORDERNO to the original full orderno. Filter data.allow_create using Boolean operators: Is true.
The existing URL, key and JSON body are unchanged. No register_task, finish or aggregator HTTP modules are required for this setup.

## Backend confirmation
Two direct ClickUp API webhooks are registered, scoped to ORDER LIST 18375902 and completed archive 901612769752. Events: taskCreated, taskUpdated, taskMoved, taskDeleted.
Callback: https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-order-gate-sync
The raw request body is authenticated against ClickUp X-Signature (HMAC SHA-256). Secrets remain in the private clickup_gate schema. Task events are debounced and reconciled via live ClickUp API reads.
A Supabase cron runs every minute and dispatches the authenticated worker only when there is queued work.
Pending claimed orders are checked through exact Order ID custom-field filters in both lists. The implementation additionally matches the returned field value exactly and handles pagination.
The expected task count comes from existing full-order detail product[] rows (not total quantity), unless explicitly supplied. For multiple items, complete set1..setN coverage or a unique SKU/variation assignment is required.
An order becomes task_complete_created after two consistent live snapshots at least 60 seconds apart, after the claim is at least 90 seconds old.
This verifies creation of the expected tasks, not completion of every downstream Make module or production work.
Missing details, missing tasks, ambiguous multi-item matches and extra tasks stay partial / needs_check; none of these reopen the creation lock.
Grouped-task scenarios where one task represents several product rows may need manual review of expected count; the system does not assume success.
Per-run read budget is 24 provider requests. Per-order attempts are bounded (30); webhook task reads retry up to 8 times. No unbounded AI/automatic task creation is used.

## Registry and status
Table: public.clickup_order_creation_registry.
Status request using the same Make URL and header:
{"action":"status","order_id":"MAP_ORDERNO"}
Order IDs and operational task metadata only are stored in the registry.
The public callback endpoint does not accept the Make key as a substitute for a ClickUp signature.
No new customer order or ClickUp task is created by the confirmation worker.
No production task status is changed.
The legacy register_task / finish endpoints remain available but are not required by the single-call setup.
A task-creation timeout is still an uncertain remote write: inspect ClickUp before retrying that Create Task module.

## Verified rollout
The original claim lock passed 8 concurrent calls (one allowed, seven blocked).
Coverage tests include single item, complete sets, missing items, duplicate sets, duplicate tasks, unique SKU assignments and ambiguous variants.
Database tests reject premature completion, reject ambiguous coverage, confirm complete pairs and flag extra tasks; test changes are rolled back.
Unsigned native callback requests return HTTP 401.
Native taskUpdated events have been received directly from ClickUp after webhook registration.
The cron and worker require no additional Make module.
