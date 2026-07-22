# Activepieces → ClickUp Production Task Setup

## Architecture

Supabase is the source of truth. Activepieces claims production-ready outbox events, creates one ClickUp task per missing production component, then immediately links each task through the callback endpoint.

## Endpoint 1: claim production work

`GET https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-production-outbox?limit=1`

Headers:

```text
Content-Type: application/json
x-ap-secret: <existing AP shared secret>
```

The response contains `events[]`. Each event has `event_id`, `order`, and `components[]`. Only components without a ClickUp mapping are returned. The endpoint atomically changes the outbox row to `processing`, preventing two AP runs from claiming the same event.

## Activepieces flow

1. Schedule trigger every minute.
2. HTTP GET the claim endpoint.
3. Loop over `body.events`.
4. Inside each event, loop over `event.components`.
5. Create a ClickUp task in list `18375902`.
6. Use `component.initial_clickup_status` as the initial status.
7. Set these ClickUp custom fields:
   - Webapp Order ID (`1bf24635-5405-47ec-9985-4b4d21f9c937`) = `event.order.id`
   - Webapp Component ID (`1aa98168-cf59-4f52-a892-3acce4977e52`) = `component.id`
   - date needed (`564b1067-b20c-427e-a2b4-52c03b2f4c3a`) = `event.order.date_needed`, when present
   - phone (`1a42fde0-d52a-4911-827d-d89e7bd3b7bd`) = `event.order.customer_phone`, when present
   - set (`2670446d-5e5a-48ac-931d-c2be790d6b3b`) only when `component.awb_primary=true` for multi-component orders
8. Immediately POST the created task to the callback endpoint.

Suggested task name:

```text
{{component.quantity}}x {{component.title}}
```

Suggested task description:

```text
Order: {{event.order.order_no}}
Size: {{component.size}}
Style: {{component.style}}
Wording: {{component.wording}}
Component ID: {{component.id}}
```

## Endpoint 2: link the created task

`POST https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-task-created-callback`

Headers:

```text
Content-Type: application/json
x-ap-secret: <existing AP shared secret>
```

Body:

```json
{
  "event_id": "{{event.event_id}}",
  "order_id": "{{event.order.id}}",
  "component_id": "{{component.id}}",
  "clickup_task_id": "{{clickup_create_task.id}}",
  "clickup_list_id": "18375902",
  "clickup_task_url": "{{clickup_create_task.url}}",
  "status": "{{component.initial_clickup_status}}"
}
```

The callback is idempotent. It links the task, repairs `clickup_tasks`, updates `production_components`, replays earlier unlinked ClickUp events, reconciles an earlier ParcelDaily shipment, and marks the outbox event processed after all components are linked.

## Existing inbound ClickUp flow

Continue sending raw ClickUp Task Updated payloads to:

`POST https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-events-ingest`

Headers:

```text
Content-Type: application/json
x-ap-secret: <existing AP shared secret>
x-process-now: true
```

Allowed folder: `7999455`

Allowed lists:

- Production ORDER LIST: `18375902`
- 2026 completed Order: `901612769752`

## Retry behavior

- Claim is atomic and uses `processing` locks.
- If only some components were linked, callback sets the outbox event to `retry`; the next claim returns only missing components.
- Repeated callback for the same component/task is safe.
- Repeated ClickUp events are deduplicated by `event_key`.
- Events received before mapping are automatically replayed after linking.

## Test procedure

1. Use one disposable paid and confirmed test order.
2. Confirm one outbox row with `event_type=clickup.production.create`.
3. Run AP once.
4. Confirm one task per component in ORDER LIST.
5. Confirm `clickup_tasks` and `production_components.clickup_task_id` are populated.
6. Change task status to `review` and confirm the inbound event becomes `observed_linked` while black-box mode is `observe`.
7. For a multi-component order, confirm exactly one component has `awb_primary=true` and receives the ClickUp `set` field.

Do not store the Supabase service-role key in Activepieces. Use only the existing shared `x-ap-secret`.