// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const U = Deno.env.get('SUPABASE_URL') || '';
const K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(U, K, { auth: { persistSession: false } });
const H = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};
const out = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: H });
const t = (v: unknown) => v == null ? '' : String(v).trim();

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'GET') return out({ ok: false, error: 'GET required' }, 405);
  try {
    const token = t(new URL(req.url).searchParams.get('token'));
    if (!/^qrd_[a-f0-9]{32}$/i.test(token)) return out({ ok: false, error: 'Invalid draft token' }, 401);

    const { data: draft, error } = await db.from('qrpay_order_drafts').select('*').eq('review_token', token).maybeSingle();
    if (error) throw error;
    if (!draft) return out({ ok: false, error: 'Draft not found' }, 404);

    const [{ data: events }, { data: corrections }, { data: review }] = await Promise.all([
      db.from('qrpay_order_draft_events').select('*').eq('draft_id', draft.id).order('created_at'),
      db.from('qrpay_ai_corrections').select('*,qrpay_ai_learning_rules(*)').eq('draft_id', draft.id).order('created_at'),
      db.from('admin_order_reviews').select('id,review_code,status').eq('draft_id', draft.id).maybeSingle(),
    ]);

    let order = null;
    if (draft.order_id) {
      const q = await db.from('orders').select('id,order_no,public_token,total,date_need,delivery_method,payment_status').eq('id', draft.order_id).maybeSingle();
      order = q.data || null;
    }

    return out({ ok: true, draft: { ...draft, events: events || [], corrections: corrections || [], review: review || null, order } });
  } catch (e) {
    console.error('qrpay-draft-data', e);
    return out({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
