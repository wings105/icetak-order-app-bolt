# Activepieces setup — WhatsApp paid orders, ClickUp production, and shipping

The application and Supabase backend are the source of truth. Activepieces only creates/updates ClickUp tasks and acknowledges outbox events.

## Fixed ClickUp locations

- Workspace: `3747262`
- Space: `3855360`
- Folder: Design & Production — `7999455`
- Production ORDER LIST: `18375902`
- Completed list: `901612769752`

Existing automation that moves `complete` tasks to the completed list must remain enabled.

## Shared authentication

All three Supabase endpoints below use the same existing header:

```text
x-ap-secret: <existing shared secret>
```

Never store the Supabase service-role key in Activepieces.

---

## Flow A — Create or reconcile production tasks

### Trigger

Schedule every minute.

### Step 1: claim work

```http
GET https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-production-outbox?limit=5
x-ap-secret: ...
```

Loop through `body.events`, then `event.components`.

### Step 2: prevent duplicates

Before creating a task, search the Production ORDER LIST for the exact custom field:

```text
Webapp Component ID = component.webapp_component_id
```

If a matching task exists, skip creation and use that task in Step 4. This is required to recover safely if ClickUp created a task but the callback previously failed.

### Step 3: create ClickUp task when no match exists

List: `18375902`

Recommended mapping:

| ClickUp value | Payload |
|---|---|
| Task name | `component.task_name` |
| Description | `component.task_description` |
| Status | `component.initial_clickup_status` |
| Webapp Order ID | `component.webapp_order_id` |
| Webapp Component ID | `component.webapp_component_id` |
| date needed | `event.order.date_needed` |
| phone | `event.order.customer_phone` |
| set | only when `component.awb_primary=true` |
| System Link | `component.admin_order_link` |
| Customer Link | `component.customer_order_link` |
| External Key | `component.task_external_key` |

Known existing custom-field IDs:

- Webapp Order ID: `1bf24635-5405-47ec-9985-4b4d21f9c937`
- Webapp Component ID: `1aa98168-cf59-4f52-a892-3acce4977e52`
- date needed: `564b1067-b20c-427e-a2b4-52c03b2f4c3a`
- phone: `1a42fde0-d52a-4911-827d-d89e7bd3b7bd`
- set: `2670446d-5e5a-48ac-931d-c2be790d6b3b`

Create text/URL fields for `System Link`, `Customer Link`, and `External Key` if they do not already exist.

### Step 4: link task to Supabase

For both a newly created task and a task found during duplicate reconciliation:

```http
POST https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-task-created-callback
Content-Type: application/json
x-ap-secret: ...
```

```json
{
  "event_id": "{{event.event_id}}",
  "order_id": "{{event.order.id}}",
  "component_id": "{{component.id}}",
  "clickup_task_id": "{{clickup_task.id}}",
  "clickup_list_id": "18375902",
  "clickup_task_url": "{{clickup_task.url}}",
  "status": "{{clickup_task.status.status}}"
}
```

The callback is idempotent. It marks the production outbox processed only after all components are linked.

---

## Flow B — ClickUp progress back to the customer dashboard

### Trigger

ClickUp `Task Updated` for folder `7999455`.

Allowed lists:

- `18375902`
- `901612769752`

### Steps

1. Get the full ClickUp task, including custom fields.
2. POST the complete task/update payload:

```http
POST https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-events-ingest
Content-Type: application/json
x-ap-secret: ...
x-process-now: true
```

The backend is intentionally kept in `observe` mode during testing. After verified events are `observed_linked`, change to `apply` only with owner approval.

---

## Flow C — AWB/tracking updates back to ClickUp

### Trigger

Schedule every minute.

### Step 1: claim shipping updates

```http
GET https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-shipping-outbox?limit=10
x-ap-secret: ...
```

Loop through `body.events`, then `event.tasks`.

### Step 2: update every linked task

Recommended task fields/comment:

| ClickUp value | Payload |
|---|---|
| Courier | `event.shipment.courier` |
| Tracking No | `event.shipment.tracking_no` |
| Tracking Link | `event.shipment.tracking_link` |
| AWB Link | `event.shipment.awb_pdf_url` |
| Shipping Status | `event.shipment.normalized_status` or `event.shipment.status` |
| Customer Order Link | `event.order.customer_order_link` |

`event.tasks[].awb_primary` identifies the main task for AWB-specific fields. All linked tasks may receive tracking status.

### Step 3: acknowledge the event

Success:

```http
POST https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-shipping-outbox
Content-Type: application/json
x-ap-secret: ...
```

```json
{ "event_id": "{{event.event_id}}", "ok": true }
```

Failure:

```json
{ "event_id": "{{event.event_id}}", "ok": false, "error": "{{error message}}" }
```

Failed events return to `retry`. Processing leases older than 10 minutes are recovered automatically.

---

## Acceptance test

1. Admin creates one WhatsApp Manual QR Paid order.
2. Confirm `payment_transactions.provider=manual_qr`.
3. Confirm one production outbox event exists.
4. Run Flow A and confirm one ClickUp task per component.
5. Confirm each component contains `clickup_task_id`.
6. Change task status and confirm the event becomes `observed_linked`.
7. Create AWB using the order number as reference.
8. Confirm tracking appears on the customer order link.
9. Run Flow C and confirm tracking fields appear on ClickUp.
10. Repeat Flow A and Flow C; no duplicate ClickUp task or duplicate shipment should be created.
