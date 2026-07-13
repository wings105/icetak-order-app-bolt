import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,apikey,x-internal-key',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...CORS, 'content-type': 'application/json' },
});
async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `REST ${response.status}`);
  return data;
}
async function setting(key: string) {
  const rows = await rest(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => []);
  return rows?.[0]?.secret_value || rows?.[0]?.text_value || '';
}
async function authorized(req: Request) {
  const incoming = req.headers.get('x-internal-key') || '';
  if (incoming && incoming === await setting('dispatch_internal_key')) return true;
  return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') === SERVICE_ROLE_KEY;
}
async function updateJob(id: string, payload: Record<string, unknown>) {
  await rest(`notification_queue?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
    if (!await authorized(req)) return json({ ok: false, error: 'Unauthorized' }, 401);
    await rest('rpc/icetak_requeue_stale_notification_jobs', { method: 'POST', body: '{}' }).catch(() => null);
    const body = await req.json().catch(() => ({}));
    const jobs = await rest('rpc/icetak_claim_notification_jobs', {
      method: 'POST',
      body: JSON.stringify({ p_queue_id: body.queue_id || null, p_limit: Number(body.limit || 20) }),
    });
    const results: Array<Record<string, unknown>> = [];
    for (const job of jobs || []) {
      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ ...(job.payload || {}), queue_id: job.id, idempotency_key: job.idempotency_key, source: 'notification_queue' }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) throw new Error(result.error || `whatsapp-send ${response.status}`);
        await updateJob(job.id, {
          status: 'sent', sent_at: new Date().toISOString(), processed_at: new Date().toISOString(), locked_at: null,
          provider_message_id: result.message_id || null, decision_mode: result.mode || null,
          decision_reason: result.decision_reason || null, last_error: null,
        });
        results.push({ id: job.id, status: 'sent', mode: result.mode, message_id: result.message_id });
      } catch (error) {
        const attempts = Number(job.attempts || 1);
        const terminal = attempts >= 5;
        const delayMinutes = [1, 5, 15, 60, 240][Math.min(attempts - 1, 4)];
        const nextRetry = new Date(Date.now() + delayMinutes * 60000).toISOString();
        await updateJob(job.id, {
          status: terminal ? 'failed' : 'pending', scheduled_at: nextRetry, locked_at: null,
          last_error: error instanceof Error ? error.message : String(error),
        });
        results.push({ id: job.id, status: terminal ? 'failed' : 'retry', next_retry_at: terminal ? null : nextRetry });
      }
    }
    return json({ ok: true, processed: results.length, results });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
