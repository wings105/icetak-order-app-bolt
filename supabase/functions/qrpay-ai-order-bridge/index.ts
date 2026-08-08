import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  { auth: { persistSession: false } },
);

const headers = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-qrpay-ai-token',
  'cache-control': 'no-store',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

const text = (value: unknown) => value == null ? '' : String(value).trim();

function errorText(error: any) {
  if (error instanceof Error) return error.message;
  return text(error?.message)
    || text(error?.details)
    || text(error?.hint)
    || (() => {
      try {
        return JSON.stringify(error);
      } catch {
        return String(error);
      }
    })();
}

async function authorized(req: Request) {
  const supplied = req.headers.get('x-qrpay-ai-token') || '';
  if (!supplied) return false;

  const { data, error } = await db
    .from('private_runtime_settings')
    .select('setting_value')
    .eq('setting_key', 'qrpay_ai_worker_token')
    .maybeSingle();

  return !error && supplied === data?.setting_value;
}

const allowedPatchFields = new Set([
  'status',
  'matched_conversation_id',
  'matched_phone',
  'matched_customer_name',
  'match_score',
  'match_reason',
  'extraction',
  'evidence',
  'locked_at',
  'completed_at',
  'updated_at',
  'next_attempt_at',
  'last_error',
]);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  if (!await authorized(req)) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, any>;
  const action = String(body.action || '');

  try {
    if (action === 'claim') {
      const { data, error } = await db.rpc('claim_qrpay_ai_jobs', {
        p_limit: Math.max(1, Math.min(10, Number(body.batch_size || 3))),
      });
      if (error) throw error;
      return json({ ok: true, jobs: data || [] });
    }

    if (action === 'update_job') {
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body.patch || {})) {
        if (allowedPatchFields.has(key)) patch[key] = value;
      }
      patch.updated_at = new Date().toISOString();

      const { data, error } = await db
        .from('qrpay_ai_jobs')
        .update(patch)
        .eq('id', body.job_id)
        .select('id,status,order_id,order_no,outbox_id')
        .maybeSingle();
      if (error) throw error;
      return json({ ok: true, job: data });
    }

    if (action === 'create_order') {
      const token = req.headers.get('x-qrpay-ai-token') || '';
      const { data, error } = await db.rpc('icetak_auto_create_qrpay_order', {
        p_job_id: body.job_id,
        p_payload: body.payload,
        p_internal_token: token,
      });
      if (error) throw error;
      return json({ ok: true, result: data });
    }

    if (action === 'create_pickup_order') {
      const token = req.headers.get('x-qrpay-ai-token') || '';
      const requestKey = String(body.request_key || '').trim();
      if (!requestKey) return json({ error: 'request_key required' }, 400);

      const { data, error } = await db.rpc('icetak_auto_create_pickup_ai_order', {
        p_request_key: requestKey,
        p_payload: body.payload || {},
        p_internal_token: token,
      });
      if (error) throw error;
      return json({ ok: true, result: data });
    }

    return json({ error: 'Unsupported action' }, 400);
  } catch (error) {
    console.error('qrpay-ai-order-bridge', error);
    return json({ ok: false, error: errorText(error) }, 500);
  }
});
