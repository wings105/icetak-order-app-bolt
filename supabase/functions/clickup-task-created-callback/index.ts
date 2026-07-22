import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const headers = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-ap-secret',
  'cache-control': 'no-store',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const text = (value: unknown) => value == null ? '' : String(value).trim();
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function authorized(req: Request) {
  const { data, error } = await db.from('clickup_integration_settings').select('value').eq('setting_key', 'black_box').single();
  if (error) throw error;
  return await sha256(req.headers.get('x-ap-secret') || '') === text(data?.value?.secret_sha256);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    if (!await authorized(req)) return json({ error: 'invalid_ap_secret' }, 401);
    const body = await req.json();
    const eventId = text(body.event_id);
    const orderId = text(body.order_id);
    const componentId = text(body.component_id);
    const taskId = text(body.clickup_task_id);
    if (!orderId || !componentId || !taskId) return json({ error: 'order_id_component_id_clickup_task_id_required' }, 400);

    const { data, error } = await db.rpc('link_clickup_production_task', {
      p_order_reference: orderId,
      p_component_id: componentId,
      p_clickup_task_id: taskId,
      p_clickup_list_id: text(body.clickup_list_id) || '18375902',
      p_task_url: text(body.clickup_task_url) || null,
      p_status: text(body.status) || null,
    });
    if (error) throw error;

    let remaining = 0;
    if (eventId) {
      const { count } = await db.from('production_components').select('id', { count: 'exact', head: true }).eq('order_id', orderId).is('clickup_task_id', null);
      remaining = count || 0;
      await db.from('integration_outbox').update(remaining === 0
        ? { status: 'processed', processed_at: new Date().toISOString(), sent_at: new Date().toISOString(), locked_at: null, last_error: null, error: null }
        : { status: 'retry', locked_at: null, next_attempt_at: new Date().toISOString(), last_error: null, error: null, payload: { order_id: orderId, event_type: 'clickup.production.create', remaining_components: remaining } })
        .eq('id', eventId).eq('order_id', orderId);
    }
    return json({ ok: true, linked: data, remaining_components: remaining, outbox_status: remaining === 0 ? 'processed' : 'retry' });
  } catch (error) {
    console.error('clickup-task-created-callback', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
