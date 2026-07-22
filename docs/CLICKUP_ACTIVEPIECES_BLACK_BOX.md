# ClickUp → Activepieces → Supabase black box

## Purpose

This is the inbound audit layer for every relevant ClickUp production-task update.

```text
ClickUp Task Updated
→ Activepieces
→ clickup-events-ingest
→ clickup_webhook_events
→ clickup_task_sync_queue
→ observer/apply processor
```

The initial mode is `observe`. Events are captured, deduplicated, linked and mapped, but production components are not modified until the payload is verified.

## Endpoint

```text
POST https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-events-ingest
```

Headers:

```text
Content-Type: application/json
x-ap-secret: <configured shared secret>
x-process-now: true
```

`x-process-now` is optional. The default is `true`. A one-minute cron job remains as a retry processor.

## Activepieces flow

1. Trigger: ClickUp `Task Updated`.
2. Filter: folder ID must equal `7999455` (`Design & Production`).
3. HTTP POST the complete trigger payload to the endpoint.
4. Treat HTTP 200 and `{ "ok": true }` as accepted.
5. Do not update Supabase tables directly from Activepieces.

The endpoint accepts either the raw ClickUp trigger output or a normalized payload. Raw `history_items` are split into individual events automatically.

## Minimal normalized payload

```json
{
  "webhook_id": "clickup-webhook-id",
  "event_type": "taskUpdated",
  "task_id": "86dxxxxxx",
  "task_name": "Acrylic Cake Topper",
  "folder_id": "7999455",
  "list_id": "18375902",
  "current_status": "review",
  "task_updated_at": 1784700000000,
  "history_items": [
    {
      "id": "history-item-id",
      "field": "status",
      "before": "acrylic",
      "after": "review"
    }
  ]
}
```

## Event states

- `queued`: accepted and waiting for processing.
- `observed_linked`: linked task; mapping recorded but no production mutation.
- `ignored_unlinked`: task does not exist in `clickup_tasks` or `production_components`.
- `applied`: apply mode updated the linked component.
- `error`: processing failed and can be retried.

## Dedupe

The canonical event key is normally:

```text
webhook_id:history_id:task_id:changed_field
```

A repeated Activepieces or ClickUp delivery does not create a second event.

## Current allowed locations

```text
Folder: Design & Production — 7999455
ORDER LIST — 18375902
2026 completed Order — 901612769752
```

## Status mapping

The mapping is stored in `clickup_status_mapping`. Important rules:

- `new custom`: printed topper designed from scratch.
- `design editing -topper`: printed topper light edit/name/age change.
- `wafer paper`: wafer design work.
- `acrylic`: acrylic design work.
- `ready stock`: printed topper already on the rack; no design.
- `edible print ready stock`: edible product already prepared; no design.
- `complete`: production component complete, not customer delivered.

## Enabling apply mode

Do not enable until real Activepieces payloads have been inspected.

```sql
update public.clickup_integration_settings
set value=jsonb_set(value,'{mode}','"apply"'::jsonb),updated_at=now()
where setting_key='black_box';
```

Before enabling, verify:

- task ID and folder/list IDs are correct;
- `history_items.field`, `before`, and `after` are preserved;
- linked webapp tasks become `observed_linked`;
- legacy/manual tasks become `ignored_unlinked`;
- duplicate events remain one record.
