// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const U = Deno.env.get('SUPABASE_URL') || '';
const K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(U, K, { auth: { persistSession: false } });
const H = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,x-pickup-ai-token,x-pickup-ai-key,x-api-key',
  'cache-control': 'no-store',
};
const out = (x: any, s = 200) => new Response(JSON.stringify(x), { status: s, headers: H });
const t = (v: any) => String(v ?? '').trim();

async function setting(k: string) {
  const q = await db.from('private_runtime_settings').select('setting_value').eq('setting_key', k).maybeSingle();
  return t(q.data?.setting_value);
}

async function auth(req: Request) {
  const publicToken = await setting('pickup_ai_public_token');
  const workerToken = await setting('qrpay_ai_worker_token');
  const bearer = t(req.headers.get('authorization')).replace(/^Bearer\s+/i, '');
  const candidates = [
    bearer,
    t(req.headers.get('x-pickup-ai-token')),
    t(req.headers.get('x-pickup-ai-key')),
    t(req.headers.get('x-api-key')),
  ].filter(Boolean);
  return { ok: candidates.some(x => x === publicToken || x === workerToken), workerToken };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'POST') return out({ ok: false, error: 'POST required' }, 405);

  const a = await auth(req);
  if (!a.ok || !a.workerToken) return out({ ok: false, error: 'Unauthorized' }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    if (!body.conversation_id && !body.phone && !body.bsuid && !body.user_id && !body.recipient_bsuid) {
      return out({ ok: false, error: 'conversation_id, phone or WhatsApp user ID required' }, 400);
    }

    const r = await fetch(`${U}/functions/v1/order-draft-trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-order-draft-token': a.workerToken },
      body: JSON.stringify({
        ...body,
        source_type: 'chat_trigger',
        payment_mode: 'prepaid',
        request_key: body.request_key || `prepaid:${body.conversation_id || body.bsuid || body.user_id || body.phone}:${body.provider_message_id || body.message_id || body.trigger_message_id || body.cutoff_at || new Date().toISOString()}`,
      }),
    });
    const j = await r.json().catch(() => ({}));
    return out({ ...j, endpoint_version: 'manual-prepaid-draft-v2-auth-parity' }, r.status);
  } catch (e) {
    return out({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
