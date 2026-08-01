# Activepieces setup — ClickUp component production sync

## Scope

This guide covers only the iCetak Order System in:

- GitHub: `wings105/icetak-order-app-bolt`
- Supabase: `buivecgahhmrhlmfujgt`
- ClickUp production list: `18375902`

Supabase is the source of truth. Activepieces only creates ClickUp tasks, sends task updates back to Supabase, and calls the task-link callback.

Shipping-to-ClickUp and manual WhatsApp QR-order automation are deferred until production component sync is stable.

## Fixed ClickUp locations

- Workspace: `3747262`
- Space: `3855360`
- Folder: Design & Production — `7999455`
- Production ORDER LIST: `18375902`
- Completed list: `901612769752`

Keep the existing ClickUp automation that moves status `complete` tasks to the completed list.

## Shared authentication

All Supabase endpoints below use the existing header:

```text
x-ap-secret: <existing shared secret>
```

Never put the Supabase service-role key in Activepieces.

## Safety state before testing

- ClickUp integration mode must remain `observe`.
- Do not backfill or claim historical July orders.
- Begin with one new controlled order/component only.
- Flow A must search by `Webapp Component ID` before creating a task.

---

## Flow A — Supabase component to ClickUp task

### Trigger

Schedule every minute.

### Step 1: claim work

```http
GET https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-production-outbox?limit=5
x-ap-secret: ...
```

Loop through:

```text
body.events
→ event.components
```

A normal response also includes:

```text
mode = observe
order_app_configured = true | false
```

When `order_app_configured=false`, use the relative `admin_order_path` and `customer_order_path`; do not substitute an AppDeploy URL.

### Step 2: duplicate reconciliation

Search list `18375902` using the exact custom field:

```text
Webapp Component ID = component.webapp_component_id
```

- Match found: reuse that task and continue to callback.
- No match: create one new task.
- More than one match: stop the flow and flag a duplicate; do not create another task.

### Step 3: create task

| ClickUp value | Payload |
|---|---|
| Task name | `component.task_name` |
| Description | `component.task_description` |
| Status | `component.initial_clickup_status` |
| Webapp Order ID | `component.webapp_order_id` |
| Webapp Component ID | `component.webapp_component_id` |
| date needed | `event.order.date_needed` |
| phone | `event.order.customer_phone` |
| External Key | `component.task_external_key` |
| System Link | `component.admin_order_link` when not null |
| Customer Link | `component.customer_order_link` when not null |
| System Path | `component.admin_order_path` |
| Customer Path | `component.customer_order_path` |

Known existing custom-field IDs:

- Webapp Order ID: `1bf24635-5405-47ec-9985-4b4d21f9c937`
- Webapp Component ID: `1aa98168-cf59-4f52-a892-3acce4977e52`
- date needed: `564b1067-b20c-427e-a2b4-52c03b2f4c3a`
- phone: `1a42fde0-d52a-4911-827d-d89e7bd3b7bd`
- set: `2670446d-5e5a-48ac-931d-c2be790d6b3b`

Recommended additional fields:

- External Key — Text
- System Link — Website
- Customer Link — Website
- System Path — Text
- Customer Path — Text

### Step 4: callback

Call this for both newly created tasks and tasks found during duplicate reconciliation:

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

The callback is idempotent. The outbox becomes `processed` only after all components in the order are linked.

---

## Flow B — ClickUp task status to Supabase

### Trigger

ClickUp `Task Updated` for folder `7999455`.

Allowed lists:

- `18375902`
- `901612769752`

The Supabase ingest endpoint rejects other lists before creating a queue event.

### Steps

1. Use ClickUp `Get Task` to retrieve the complete current task.
2. Include the full `custom_fields`, list, folder and current status.
3. POST the complete task payload:

```http
POST https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-events-ingest
Content-Type: application/json
x-ap-secret: ...
x-process-now: true
```

Required identity fields on the ClickUp task:

```text
Webapp Order ID
Webapp Component ID
```

### Observe-mode result

The event should become:

```text
processing_status = observed_linked
```

Its processing result contains:

```json
{
  "customer_projection": {
    "stage": "Design Editing",
    "label": "Design edible image sedang disediakan",
    "progress": 25
  }
}
```

Observe mode does not update customer-visible workflow.

---

## Status contract

| ClickUp status | Customer stage |
|---|---|
| prospect | Order Received |
| new custom | Design Editing |
| acrylic | Design Editing |
| design edible image | Design Editing |
| design editing -topper | Design Editing |
| wafer paper | Design Editing |
| review | Waiting Review |
| cake topper - printing | Production |
| edible image -printing | Production |
| wafer - printing | Production |
| ready stock | Finishing |
| edible print ready stock | Finishing |
| print alamat | Finishing |
| complete + pickup | Ready |
| complete + courier | Finishing — production selesai, menunggu penghantaran |

Technical status remains in `production_components.clickup_status`. Customer-visible stage is stored separately and `workflow` uses the generic stage expected by the Bolt customer portal.

---

## Controlled acceptance test

1. Create one new controlled paid and confirmed order in the Order System.
2. Confirm only that new order produces a pending `clickup.production.create` event.
3. Run Flow A once.
4. Confirm exactly one ClickUp task per component.
5. Confirm `production_components.clickup_task_id` and `clickup_tasks` are linked.
6. Run Flow A again and confirm no duplicate task is created.
7. Change the task status to its design status.
8. Run Flow B and confirm `observed_linked` plus the expected customer projection.
9. Test `review`, printing and `complete` statuses while still in observe mode.
10. Confirm no customer workflow changed yet.
11. After all mappings pass, change mode to `apply` with owner approval.
12. Replay observed events using the server-side `replay_clickup_observed_events` RPC.
13. Confirm the Bolt customer dashboard stage changes correctly.
14. Repeat the same event and confirm it is idempotent.

## Activation gate

Do not switch to `apply` until all of these are true:

- Every test component has one ClickUp task.
- No duplicate `Webapp Component ID` exists in ClickUp.
- All test events are `observed_linked`.
- Component scope mapping is correct.
- Customer stages match expected values.
- Historical July orders remain untouched.
