import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-ap-secret,x-process-now',
  'cache-control': 'no-store',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function firstObject(...values: unknown[]) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return {} as Record<string, unknown>;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function customFieldValue(fields: unknown, wanted: string) {
  if (!Array.isArray(fields)) return '';
  const found = fields.find((field) => {
    const item = field as Record<string, unknown>;
    return firstText(item.name, item.label).toLowerCase() === wanted.toLowerCase();
  }) as Record<string, unknown> | undefined;
  if (!found) return '';
  const value = found.value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return firstText(objectValue.value, objectValue.name, objectValue.label, objectValue.id);
  }
  return '';
}

function eventText(value: unknown) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return firstText(objectValue.status, objectValue.name, objectValue.value, objectValue.label, objectValue.id);
  }
  return '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const suppliedSecret = req.headers.get('x-ap-secret') || '';
    const { data: setting, error: settingError } = await supabase
      .from('clickup_integration_settings')
      .select('value')
      .eq('setting_key', 'black_box')
      .single();
    if (settingError) throw settingError;

    const expectedHash = firstText(setting?.value?.secret_sha256);
    if (!expectedHash) return json({ error: 'ingest_secret_not_configured' }, 503);
    if (!suppliedSecret || await sha256(suppliedSecret) !== expectedHash) {
      return json({ error: 'invalid_ap_secret' }, 401);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'invalid_json' }, 400);
    const root = body as Record<string, unknown>;
    const data = firstObject(root.data);
    const task = firstObject(root.task, data.task, root.current_task, data.current_task);
    const statusObject = firstObject(task.status, root.status, data.status);
    const listObject = firstObject(task.list, root.list, data.list);
    const folderObject = firstObject(task.folder, root.folder, data.folder);
    const customFields = task.custom_fields ?? root.custom_fields ?? data.custom_fields;

    const taskId = firstText(root.task_id, root.taskId, task.id, data.task_id, data.taskId);
    if (!taskId) return json({ error: 'task_id_required' }, 400);

    const webhookId = firstText(root.webhook_id, root.webhookId, data.webhook_id, data.webhookId);
    const eventType = firstText(root.event_type, root.event, root.type, data.event_type, data.event, data.type, 'taskUpdated');
    const taskName = firstText(root.task_name, task.name, data.task_name);
    const folderId = firstText(root.folder_id, folderObject.id, data.folder_id);
    const listId = firstText(root.list_id, listObject.id, data.list_id);
    const currentStatus = firstText(root.current_status, statusObject.status, statusObject.name, task.status, data.current_status);
    const updatedAt = firstText(root.task_updated_at, task.date_updated, task.updated_at, data.task_updated_at, Date.now());
    const webappOrderId = firstText(root.webapp_order_id, data.webapp_order_id, customFieldValue(customFields, 'Webapp Order ID'));
    const webappComponentId = firstText(root.webapp_component_id, data.webapp_component_id, customFieldValue(customFields, 'Webapp Component ID'));

    const history = root.history_items ?? root.historyItems ?? data.history_items ?? data.historyItems;
    const historyItems = Array.isArray(history) && history.length ? history.slice(0, 50) : [root];
    const ingestResults: unknown[] = [];
    const taskIds = new Set<string>();

    for (let index = 0; index < historyItems.length; index += 1) {
      const historyItem = firstObject(historyItems[index]);
      const historyId = firstText(historyItem.id, historyItem.history_id, root.history_id, `${index}`);
      const changedField = firstText(historyItem.field, historyItem.changed_field, root.changed_field, root.field);
      const beforeValue = historyItem.before ?? historyItem.before_value ?? root.before_value ?? null;
      const afterValue = historyItem.after ?? historyItem.after_value ?? root.after_value ?? null;
      const canonical = {
        event_key: firstText(root.event_key) || `${webhookId || 'ap'}:${historyId}:${taskId}:${changedField || eventType}`,
        webhook_id: webhookId,
        history_id: historyId,
        event_type: eventType,
        task_id: taskId,
        task_name: taskName,
        folder_id: folderId,
        list_id: listId,
        current_status: currentStatus || (changedField.toLowerCase() === 'status' ? eventText(afterValue) : ''),
        changed_field: changedField,
        before_value: beforeValue,
        after_value: afterValue,
        webapp_order_id: webappOrderId,
        webapp_component_id: webappComponentId,
        task_updated_at: updatedAt,
        raw_payload: root,
      };

      const { data: ingested, error: ingestError } = await supabase.rpc('ingest_clickup_event', { p_event: canonical });
      if (ingestError) throw ingestError;
      ingestResults.push(ingested);
      if (ingested?.accepted && !ingested?.ignored) taskIds.add(taskId);
    }

    const processing: unknown[] = [];
    const processNow = (req.headers.get('x-process-now') || 'true').toLowerCase() !== 'false';
    if (processNow) {
      for (const id of taskIds) {
        const { data: result, error } = await supabase.rpc('process_clickup_task_events', { p_task_id: id });
        if (error) processing.push({ task_id: id, ok: false, error: error.message });
        else processing.push(result);
      }
    }

    return json({
      ok: true,
      mode: setting?.value?.mode || 'observe',
      task_id: taskId,
      events_received: historyItems.length,
      ingest: ingestResults,
      processing,
    });
  } catch (error) {
    console.error('clickup-events-ingest error', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
