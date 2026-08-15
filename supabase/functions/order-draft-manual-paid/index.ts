// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const U = Deno.env.get('SUPABASE_URL') || '';
const K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(U, K, { auth: { persistSession: false } });
const H = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};
const out = (x: any, s = 200) => new Response(JSON.stringify(x), { status: s, headers: H });
const t = (v: any) => String(v ?? '').trim();

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'POST') return out({ ok: false, error: 'POST required' }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const token = t(b.token);
    const method = t(b.payment_method);
    const reference = t(b.reference);
    if (!/^qrd_[a-f0-9]{32}$/i.test(token)) return out({ ok: false, error: 'Invalid draft token' }, 401);
    if (!method) return out({ ok: false, error: 'payment_method required' }, 400);
    const q = await db.rpc('icetak_admin_confirm_paid_draft', {
      p_review_token: token,
      p_payment_method: method,
      p_reference: reference || null,
      p_actor: 'admin-link',
    });
    if (q.error) throw q.error;
    return out({ ok: true, result: q.data, endpoint_version: 'draft-manual-paid-v1' });
  } catch (e) {
    console.error('order-draft-manual-paid', e);
    return out({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
