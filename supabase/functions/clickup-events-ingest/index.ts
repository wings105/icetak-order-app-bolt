import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-ap-secret,x-process-now',
  'cache-control': 'no-store',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const txt = (...values: unknown[]) => {
  for (const value of values) if (value != null && String(value).trim()) return String(value).trim();
  return '';
};
const obj = (...values: unknown[]) => {
  for (const value of values) if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {} as Record<string, unknown>;
};
async function sha(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function fieldValue(fields: unknown, wanted: string) {
  if (!Array.isArray(fields)) return '';
  const field = fields.find((item: any) => txt(item.name, item.label).toLowerCase() === wanted.toLowerCase()) as any;
  if (!field || field.value == null) return '';
  return typeof field.value === 'object' ? txt(field.value.value, field.value.name, field.value.label, field.value.id) : String(field.value);
}
function valueText(value: unknown) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  const item = value as any;
  return txt(item.status, item.name, item.value, item.label, item.id);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const { data: setting, error: settingError } = await db.from('clickup_integration_settings').select('value').eq('setting_key', 'black_box').single();
    if (settingError) throw settingError;
    const expected = txt(setting?.value?.secret_sha256);
    const providedSecret = req.headers.get('x-ap-secret') || '';
    if (!expected || await sha(providedSecret) !== expected) return json({ error: 'invalid_ap_secret' }, 401);

    const body = await req.json();
    if (!body || typeof body !== 'object') return json({ error: 'invalid_json' }, 400);
    const root = body as any;
    const data = obj(root.data);
    const task = obj(root.task, data.task, root.current_task, data.current_task);
    const status = obj(task.status, root.status, data.status);
    const list = obj(task.list, root.list, data.list);
    const folder = obj(task.folder, root.folder, data.folder);
    const fields = task.custom_fields ?? root.custom_fields ?? data.custom_fields;
    const taskId = txt(root.task_id, root.taskId, task.id, data.task_id, data.taskId);
    if (!taskId) return json({ error: 'task_id_required' }, 400);
    const taskName = txt(root.task_name, task.name, data.task_name);
    const listId = txt(root.list_id, (list as any).id, data.list_id);

    if (listId === '901604488980') {
      const taskPayload = {
        ...root,
        ...task,
        id: taskId,
        name: taskName || txt(task.name, root.name),
        custom_fields: fields || [],
        attachments: task.attachments ?? root.attachments ?? data.attachments ?? [],
        list: { ...list, id: listId },
        date_updated: txt(root.task_updated_at, task.date_updated, task.updated_at, data.task_updated_at, Date.now()),
        url: txt(task.url, root.url, `https://app.clickup.com/t/${taskId}`),
      };
      if (!taskPayload.name) return json({ error: 'product_task_name_required', task_id: taskId }, 400);
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const response = await fetch(`${supabaseUrl}/functions/v1/product-catalog-sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ap-secret': providedSecret },
        body: JSON.stringify({ list_id: listId, task: taskPayload }),
      });
      const sync = await response.json().catch(() => ({}));
      if (!response.ok) return json({ error: 'product_catalog_sync_failed', task_id: taskId, sync }, response.status);
      return json({ ok: true, routed: 'product_catalog', task_id: taskId, sync });
    }

    const webhookId = txt(root.webhook_id, root.webhookId, data.webhook_id, data.webhookId);
    const eventType = txt(root.event_type, root.event, root.type, data.event_type, data.event, data.type, 'taskUpdated');
    const folderId = txt(root.folder_id, (folder as any).id, data.folder_id);
    const currentStatus = txt(root.current_status, (status as any).status, (status as any).name, task.status, data.current_status);
    const updatedAt = txt(root.task_updated_at, task.date_updated, task.updated_at, data.task_updated_at, Date.now());
    const orderId = txt(root.webapp_order_id, data.webapp_order_id, fieldValue(fields, 'Webapp Order ID'));
    const componentId = txt(root.webapp_component_id, data.webapp_component_id, fieldValue(fields, 'Webapp Component ID'));
    const history = root.history_items ?? root.historyItems ?? data.history_items ?? data.historyItems;
    const items = Array.isArray(history) && history.length ? history.slice(0, 50) : [root];
    const ingest = [];
    const taskIds = new Set<string>();
    for (let index = 0; index < items.length; index += 1) {
      const historyItem = obj(items[index]) as any;
      const historyId = txt(historyItem.id, historyItem.history_id, root.history_id, `${index}`);
      const changed = txt(historyItem.field, historyItem.changed_field, root.changed_field, root.field);
      const before = historyItem.before ?? historyItem.before_value ?? root.before_value ?? null;
      const after = historyItem.after ?? historyItem.after_value ?? root.after_value ?? null;
      const customField = obj(historyItem.custom_field, historyItem.field_object, historyItem.customField, historyItem.field_data) as any;
      const customFieldId = txt(historyItem.custom_field_id, customField.id, changed === 'custom_field' ? historyItem.field_id : '');
      const customFieldName = txt(historyItem.custom_field_name, customField.name, customField.label);
      const customFieldType = txt(historyItem.custom_field_type, customField.type);
      const canonical = {
        event_key: txt(root.event_key) || `${webhookId || 'ap'}:${historyId}:${taskId}:${changed || eventType}`,
        webhook_id: webhookId,
        history_id: historyId,
        event_type: eventType,
        task_id: taskId,
        task_name: taskName,
        folder_id: folderId,
        list_id: listId,
        current_status: currentStatus || (changed.toLowerCase() === 'status' ? valueText(after) : ''),
        changed_field: changed,
        before_value: before,
        after_value: after,
        webapp_order_id: orderId,
        webapp_component_id: componentId,
        custom_field_id: customFieldId,
        custom_field_name: customFieldName,
        custom_field_type: customFieldType,
        task_updated_at: updatedAt,
        raw_payload: root,
      };
      const { data: result, error } = await db.rpc('ingest_clickup_event', { p_event: canonical });
      if (error) throw error;
      ingest.push(result);
      if (result?.accepted && !result?.ignored) taskIds.add(taskId);
    }
    const processing = [];
    if ((req.headers.get('x-process-now') || 'true').toLowerCase() !== 'false') {
      for (const id of taskIds) {
        const { data: result, error } = await db.rpc('process_clickup_task_events', { p_task_id: id });
        processing.push(error ? { task_id: id, ok: false, error: error.message } : result);
      }
    }
    return json({ ok: true, mode: setting?.value?.mode || 'observe', task_id: taskId, events_received: items.length, ingest, processing });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
