import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-ap-secret',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });
const text = (value: unknown) => value == null ? '' : String(value).trim();
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!url || !serviceKey) return json({ error: 'Supabase environment is missing' }, 500);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const providedSecret = request.headers.get('x-ap-secret') || '';
    const { data: settings, error: settingsError } = await admin.from('clickup_integration_settings').select('value').eq('setting_key', 'black_box').maybeSingle();
    if (settingsError) throw settingsError;
    const config = (settings?.value || {}) as Record<string, unknown>;
    const expectedHash = text(config.secret_sha256);
    if (!providedSecret || !expectedHash || await sha256(providedSecret) !== expectedHash) return json({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const listId = text(body.list_id || '901604488980');
    if (listId !== '901604488980') return json({ error: 'List is not allowed' }, 403);
    const maxPages = Math.max(1, Math.min(Number(body.max_pages || 100), 100));
    const token = text(Deno.env.get('CLICKUP_API_TOKEN') || config.clickup_api_token || config.api_token || config.token);
    if (!token) return json({ error: 'CLICKUP_API_TOKEN is not configured', configured: false }, 503);
    let received = 0; let upserted = 0; let pages = 0; const batches: unknown[] = [];
    for (let page = 0; page < maxPages; page += 1) {
      const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task?archived=false&include_closed=true&subtasks=false&page=${page}`, { headers: { Authorization: token } });
      if (!response.ok) throw new Error(`ClickUp API ${response.status}: ${await response.text()}`);
      const payload = await response.json() as { tasks?: unknown[]; last_page?: boolean };
      const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      if (!tasks.length) break;
      pages += 1; received += tasks.length;
      const syncResponse = await fetch(`${url}/functions/v1/product-catalog-sync`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ap-secret': providedSecret }, body: JSON.stringify({ list_id: listId, tasks }) });
      const syncResult = await syncResponse.json().catch(() => ({})) as Record<string, unknown>;
      if (!syncResponse.ok) throw new Error(`Product sync ${syncResponse.status}: ${JSON.stringify(syncResult)}`);
      upserted += Number(syncResult.upserted || 0); batches.push(syncResult);
      if (payload.last_page || tasks.length < 100) break;
    }
    return json({ ok: true, configured: true, list_id: listId, pages, received, upserted, batches });
  } catch (error) {
    console.error('product-catalog-pull error', error);
    return json({ error: error instanceof Error ? error.message : 'Server error' }, 500);
  }
});
