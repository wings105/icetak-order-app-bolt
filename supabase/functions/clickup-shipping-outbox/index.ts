import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const headers = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
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
  const expected = text(data?.value?.secret_sha256);
  return Boolean(expected) && await sha256(req.headers.get('x-ap-secret') || '') === expected;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    if (!await authorized(req)) return json({ error: 'invalid_ap_secret' }, 401);
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const eventId = text(body.event_id);
      if (!eventId) return json({ error: 'event_id_required' }, 400);
      const ok = body.ok !== false && text(body.status).toLowerCase() !== 'retry';
      const update = ok
        ? { status: 'processed', processed_at: new Date().toISOString(), sent_at: new Date().toISOString(), locked_at: null, last_error: null, error: null }
        : { status: 'retry', next_attempt_at: new Date(Date.now() + 60_000).toISOString(), locked_at: null, last_error: text(body.error) || 'activepieces_update_failed', error: text(body.error) || 'activepieces_update_failed' };
      const { error } = await db.from('integration_outbox').update(update).eq('id', eventId).eq('event_type', 'clickup.shipping.update');
      if (error) throw error;
      return json({ ok: true, event_id: eventId, status: ok ? 'processed' : 'retry' });
    }
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 5), 20));
    const { data, error } = await db.rpc('claim_clickup_shipping_outbox', { p_limit: limit });
    if (error) throw error;
    return json({
      ok: true,
      count: (data || []).length,
      events: (data || []).map((event: any) => ({
        event_id: event.id,
        event_type: event.event_type,
        attempts: event.attempts,
        order_id: event.order_id,
        ...event.payload,
      })),
    });
  } catch (error) {
    console.error('clickup-shipping-outbox', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
