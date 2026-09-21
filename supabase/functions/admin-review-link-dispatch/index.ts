// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const U = Deno.env.get('SUPABASE_URL') || '';
const K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(U, K, { auth: { persistSession: false } });
const H = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const out = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s, headers: H });
const t = (v: unknown) => String(v ?? '').trim();
const digits = (v: unknown) => t(v).replace(/\D/g, '');

async function pset(key: string) {
  const q = await db.from('private_runtime_settings').select('setting_value').eq('setting_key', key).maybeSingle();
  return t(q.data?.setting_value);
}

async function wset(key: string) {
  const q = await db.from('whatsapp_settings').select('text_value,secret_value').eq('key', key).maybeSingle();
  return t(q.data?.secret_value || q.data?.text_value);
}

async function auth(req: Request) {
  const token = t(req.headers.get('x-admin-order-token'));
  return Boolean(token) && token === await pset('qrpay_ai_worker_token');
}

async function adminPhone() {
  return await wset('admin_order_notify_phone') || '60129554732';
}

async function publicBase() {
  return (await wset('customer_app_base_url') || 'https://shop.decocake.my').replace(/\/$/, '');
}

function method(value: unknown) {
  const s = t(value).toLowerCase();
  return s === 'pickup' ? 'Pickup' : s === 'spx' ? 'SPX' : s === 'jnt' ? 'J&T' : s === 'ninja' ? 'Ninja Van' : s || 'Not set';
}

function items(rows: any[]) {
  return rows.map((x, i) => `${i + 1}. ${x.title || x.product_type || x.k || 'Item'} x${Number(x.qty || 1)} | RM${Number(x.price || 0).toFixed(2)}${x.size ? ` | ${x.size}` : ''}${x.wording ? `\n   ${String(x.wording).replace(/\n/g, ' / ')}` : ''}`).join('\n');
}

function totals(payload: any) {
  const rows = Array.isArray(payload?.items) ? payload.items : [];
  const sub = rows.reduce((sum: number, x: any) => sum + Number(x.price || 0) * Math.max(1, Number(x.qty || 1)), 0);
  const ship = Number(payload?.delivery_fee || 0);
  return { sub, ship, total: sub + ship };
}

function customerContactLines(draft: any, payload: any) {
  const identity = payload?.whatsapp_identity || payload?.evidence?.whatsapp_identity || {};
  const phone = digits(draft?.customer_phone || payload?.customer?.phone || identity.phone);
  const username = t(identity.username || payload?.customer?.username).replace(/^@+/, '');
  const bsuid = t(identity.bsuid || identity.user_id || payload?.evidence?.whatsapp_identity?.bsuid);
  const lines: string[] = [];
  if (phone) lines.push(`Phone: ${phone}`, `WhatsApp: https://wa.me/${phone}`);
  else if (username) lines.push(`WhatsApp: https://wa.me/${encodeURIComponent(username)}`);
  if (username) lines.push(`Username: @${username}`);
  if (bsuid) lines.push(`User ID: ${bsuid}`);
  return lines;
}

async function enqueue(draft: any, message: string) {
  const version = Math.max(1, Number(draft.version || 1));
  const idempotencyKey = `admin-draft-review:${draft.id}:v${version}`;
  const payload = {
    phone: digits(await adminPhone()),
    event_type: 'admin_draft_review',
    mode: 'auto',
    text: message,
    draft_id: draft.id,
    vars: { draft_id: draft.id, order_token: draft.review_token },
  };

  const old = await db.from('notification_queue').select('id,status,attempts,last_error,sent_at')
    .eq('idempotency_key', idempotencyKey).maybeSingle();
  if (old.error) throw old.error;

  if (old.data?.status === 'sent') {
    if (!draft.admin_link_sent_at && old.data.sent_at) {
      const updated = await db.from('qrpay_order_drafts').update({ admin_link_sent_at: old.data.sent_at, updated_at: new Date().toISOString() }).eq('id', draft.id);
      if (updated.error) throw updated.error;
    }
    return { sent: true, queued: false, queue_id: old.data.id, status: 'sent', duplicate: true };
  }

  if (old.data) {
    const patch: Record<string, unknown> = { payload };
    if (['failed', 'cancelled'].includes(t(old.data.status))) {
      Object.assign(patch, { status: 'pending', attempts: 0, last_error: null, locked_at: null, processed_at: null, scheduled_at: new Date().toISOString() });
    }
    const updated = await db.from('notification_queue').update(patch).eq('id', old.data.id).select('id,status,attempts,last_error').single();
    if (updated.error) throw updated.error;
    return { sent: false, queued: true, queue_id: updated.data.id, status: updated.data.status, duplicate: true, last_error: updated.data.last_error || null };
  }

  const created = await db.from('notification_queue').insert({
    event_type: 'admin_draft_review',
    channel: 'whatsapp',
    phone: payload.phone,
    payload,
    status: 'pending',
    attempts: 0,
    scheduled_at: new Date().toISOString(),
    idempotency_key: idempotencyKey,
  }).select('id,status,attempts').single();
  if (created.error) throw created.error;
  return { sent: false, queued: true, queue_id: created.data.id, status: created.data.status, duplicate: false };
}

async function sendDraft(id: string) {
  const q = await db.from('qrpay_order_drafts').select('*').eq('id', id).maybeSingle();
  if (q.error) throw q.error;
  const draft = q.data;
  if (!draft) throw Error('draft_not_found');
  if (!/^qrd_[a-f0-9]{32}$/i.test(t(draft.review_token))) throw Error('draft_review_token_invalid');

  const link = `${await publicBase()}/qrpay-draft.html?token=${encodeURIComponent(draft.review_token)}`;
  const payload = (draft.status === 'confirmed' ? (draft.confirmed_draft || draft.working_draft) : draft.working_draft) || {};
  const amount = totals(payload);
  const line = items(Array.isArray(payload.items) ? payload.items : []);
  const source = t(draft.source_type || 'qrpay_payment');
  const paid = source === 'qrpay_payment';
  const cash = ['cash_counter', 'cash_at_counter'].includes(t(draft.payment_mode));
  const title = draft.status === 'confirmed' ? '✅ ORDER CONFIRMED — ADMIN RECORD' : source === 'pickup_trigger' ? '🟡 PICKUP AI DRAFT — ADMIN CHECK' : source === 'chat_trigger' ? '🟡 CHAT ORDER DRAFT — ADMIN CHECK' : '🟡 QRPay AI DRAFT — ADMIN CHECK';
  const payLine = paid ? `Payment Received: RM${Number(draft.payment_amount || 0).toFixed(2)}` : cash ? 'Payment: Cash at Counter' : 'Payment: Awaiting customer confirmation / web payment';
  const message = [
    title,
    `Ref: ${draft.transaction_id || draft.request_key || String(draft.id).slice(0, 8)}`,
    `Customer: ${draft.customer_name || '-'}`,
    ...customerContactLines(draft, payload),
    `Source: ${source}`,
    `Date Need: ${payload.date_need || '-'}`,
    '', 'ORDER', line || 'Item belum cukup', '',
    `Shipping: ${method(payload.delivery)} | RM${amount.ship.toFixed(2)}`,
    `Item Subtotal: RM${amount.sub.toFixed(2)}`,
    `TOTAL: RM${amount.total.toFixed(2)}`,
    payLine,
    ...(paid ? [`Difference: ${(amount.total - Number(draft.payment_amount || 0)) >= 0 ? '+' : ''}RM${(amount.total - Number(draft.payment_amount || 0)).toFixed(2)}`] : []),
    '',
    draft.status === 'confirmed' ? 'Buka record (read-only):' : 'Buka draft untuk edit / add / remove item / shipping / Date Need:',
    link,
    '',
    draft.status === 'confirmed' ? '🔒 Sudah Confirm.' : '⚠️ Draft sahaja. Belum create Order / ClickUp.',
  ].join('\n');

  return { draft_id: draft.id, status: draft.status, public_link: link, ...(await enqueue(draft, message)) };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return out({ ok: false, error: 'POST required' }, 405);
  if (!await auth(req)) return out({ ok: false, error: 'Unauthorized' }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === 'send_draft_link' && body.draft_id) return out({ ok: true, result: await sendDraft(String(body.draft_id)) });
    return out({ ok: true, count: 0, results: [] });
  } catch (error) {
    return out({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
