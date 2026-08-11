import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U = Deno.env.get('SUPABASE_URL') || '';
const K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const C = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-wasapflow-signature,x-wasapflow-event',
};
const BSUID_RE = /^[A-Z]{2}\.\d+$/i;
const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...C, 'content-type': 'application/json' } });
const clean = (v: unknown) => String(v ?? '').trim();
const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const bsuidOf = (v: unknown) => { const x = clean(v); return BSUID_RE.test(x) ? x.toUpperCase() : ''; };
const phoneOf = (v: unknown) => {
  const raw = clean(v);
  if (!raw || BSUID_RE.test(raw)) return '';
  let p = raw.replace(/\D/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0')) p = `60${p.slice(1)}`;
  else if (p.startsWith('1') && p.length >= 9 && p.length <= 10) p = `60${p}`;
  return /^[1-9]\d{7,14}$/.test(p) ? p : '';
};

async function r(path: string, opt: RequestInit = {}) {
  const x = await fetch(`${U}/rest/v1/${path}`, {
    ...opt,
    headers: { apikey: K, authorization: `Bearer ${K}`, 'content-type': 'application/json', prefer: 'return=representation', ...(opt.headers || {}) },
  });
  const data = await x.json().catch(() => null);
  if (!x.ok) throw new Error(data?.message || data?.error || `REST ${x.status}`);
  return data;
}
async function setting(key: string) {
  const a = await r(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => []);
  const z = a?.[0] || {};
  return z.secret_value || z.text_value || z.value?.url || '';
}
async function privateSetting(key: string) {
  const a = await r(`private_runtime_settings?setting_key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => []);
  return a?.[0]?.setting_value || '';
}
async function hmac(raw: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  return `sha256=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function extractIdentity(d: Record<string, any>) {
  const raw = obj(d.raw);
  const message = obj(raw.message);
  const contacts = Array.isArray(raw.contacts) ? raw.contacts.map(obj) : [];
  const first = contacts[0] || {};
  const profile = obj(first.profile);
  return {
    phone: phoneOf(d.from) || phoneOf(first.wa_id) || phoneOf(message.from) || '',
    bsuid: bsuidOf(d.bsuid) || bsuidOf(message.from_user_id) || bsuidOf(first.user_id) || '',
    username: clean(profile.username || d.username || ''),
    name: clean(d.contact_name || profile.name || ''),
  };
}

async function masterForIdentity(phone: string, bsuid: string) {
  if (bsuid) {
    const rows = await r(`customer_identifiers_master?identifier_type=eq.whatsapp_bsuid&channel=eq.whatsapp&normalized_value=eq.${encodeURIComponent(bsuid)}&select=customer_master_id&limit=1`).catch(() => []);
    if (rows?.[0]?.customer_master_id) return String(rows[0].customer_master_id);
  }
  if (phone) {
    const rows = await r(`customer_identifiers_master?identifier_type=eq.phone&normalized_value=eq.${encodeURIComponent(phone)}&select=customer_master_id&limit=1`).catch(() => []);
    if (rows?.[0]?.customer_master_id) return String(rows[0].customer_master_id);
  }
  return '';
}

async function upsertBsuidMaster(masterId: string, bsuid: string, phone: string, username: string) {
  if (!masterId || !bsuid) return;
  await r('customer_identifiers_master?on_conflict=identifier_type,normalized_value,scope', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      customer_master_id: masterId,
      identifier_type: 'whatsapp_bsuid',
      channel: 'whatsapp',
      identifier_value: bsuid,
      normalized_value: bsuid,
      scope: 'waba:939302461880264',
      is_verified: true,
      confidence: 1,
      source_system: 'wasapflow-webhook',
      metadata: { current_username: username || null, last_phone_seen: phone || null },
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => null);
}

async function contact(identity: { phone: string; bsuid: string; username: string; name: string }) {
  let rows: any[] = [];
  if (identity.bsuid) rows = await r(`whatsapp_contacts?bsuid=eq.${encodeURIComponent(identity.bsuid)}&limit=1`).catch(() => []);
  if (!rows?.[0] && identity.phone) rows = await r(`whatsapp_contacts?normalized_phone=eq.${encodeURIComponent(identity.phone)}&limit=1`).catch(() => []);
  let existing = rows?.[0] || null;

  const masterId = await masterForIdentity(identity.phone, identity.bsuid);
  let customerId = existing?.customer_id || null;
  if (!customerId && masterId) {
    const customers = await r(`customers?customer_master_id=eq.${encodeURIComponent(masterId)}&select=id&limit=1`).catch(() => []);
    customerId = customers?.[0]?.id || null;
  }

  if (existing) {
    const patch = {
      phone: identity.phone || existing.phone || null,
      normalized_phone: identity.phone || existing.normalized_phone || null,
      bsuid: identity.bsuid || existing.bsuid || null,
      username: identity.username || existing.username || null,
      name: identity.name || existing.name || null,
      customer_id: customerId,
      source: 'wasapflow',
      updated_at: new Date().toISOString(),
    };
    const updated = await r(`whatsapp_contacts?id=eq.${existing.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    existing = updated?.[0] || { ...existing, ...patch };
  } else {
    const created = await r('whatsapp_contacts', {
      method: 'POST',
      body: JSON.stringify({
        phone: identity.phone || null,
        normalized_phone: identity.phone || null,
        bsuid: identity.bsuid || null,
        username: identity.username || null,
        name: identity.name || identity.username || identity.phone || identity.bsuid || 'WhatsApp customer',
        customer_id: customerId,
        source: 'wasapflow',
      }),
    });
    existing = created?.[0];
  }
  if (!existing) throw new Error('Unable to resolve WhatsApp contact');
  await upsertBsuidMaster(masterId, identity.bsuid, identity.phone, identity.username);
  return existing;
}

function buttonId(d: any) {
  return clean(d?.raw?.message?.button?.payload || d?.raw?.message?.interactive?.button_reply?.id || d?.interactive?.button_reply?.id || d?.button_reply?.id || d?.button?.payload || d?.button?.id || d?.reply?.id || '');
}
function messageText(d: any) {
  const rawMessage = obj(obj(d.raw).message);
  const rawType = clean(d.type || rawMessage.type || 'text').toLowerCase();
  const text = clean(d.text || d.body || rawMessage?.text?.body || rawMessage?.button?.text || rawMessage?.interactive?.button_reply?.title || d?.interactive?.button_reply?.title || d?.button_reply?.title || '');
  if (text) return text;
  const labels: Record<string, string> = { image: '[Image]', document: '[Document]', audio: '[Audio]', video: '[Video]', sticker: '[Sticker]', reaction: '[Reaction]', location: '[Location]' };
  return labels[rawType] || `[${rawType}]`;
}
async function adminControl(phone: string, d: any) {
  if (!phone) return;
  const admin = phoneOf(await setting('admin_order_notify_phone') || '60129554732');
  if (phone !== admin) return;
  const token = await privateSetting('qrpay_ai_worker_token');
  if (!token) return;
  await fetch(`${U}/functions/v1/admin-order-control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-order-token': token },
    body: JSON.stringify({ action: 'incoming', phone, text: messageText(d), button_id: buttonId(d), raw: d }),
  }).catch(() => null);
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: C });
    if (req.method !== 'POST') return j({ ok: false, error: 'POST required' }, 405);
    const raw = await req.text();
    const sig = req.headers.get('x-wasapflow-signature') || '';
    const secret = await setting('webhook_secret');
    let verified = !secret;
    if (secret) verified = sig === await hmac(raw, secret);
    if (!verified) return j({ ok: false, error: 'invalid signature' }, 401);

    const p = JSON.parse(raw || '{}');
    const event = clean(p.event || req.headers.get('x-wasapflow-event') || 'unknown').toLowerCase();
    const d = obj(p.data);
    const now = new Date().toISOString();
    const incomingIdentity = event === 'message.received' ? extractIdentity(d) : { phone: phoneOf(d.from || d.to || d.recipient), bsuid: bsuidOf(d.bsuid || d.recipient_bsuid || d.recipient), username: '', name: '' };

    await r('wasapflow_webhook_events', {
      method: 'POST',
      body: JSON.stringify({
        event,
        waba_id: p.waba_id || null,
        phone_number_id: p.phone_number_id || null,
        provider_message_id: d.message_id || null,
        phone: incomingIdentity.phone || null,
        signature_valid: verified,
        raw_payload: p,
      }),
    }).catch(() => null);

    if (event === 'message.received') {
      if (!incomingIdentity.phone && !incomingIdentity.bsuid) return j({ ok: true, event, ignored: true, reason: 'missing_identity' });
      const c = await contact(incomingIdentity);
      await r(`whatsapp_contacts?id=eq.${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          bsuid: incomingIdentity.bsuid || c.bsuid || null,
          username: incomingIdentity.username || c.username || null,
          phone: incomingIdentity.phone || c.phone || null,
          normalized_phone: incomingIdentity.phone || c.normalized_phone || null,
          last_message_at: now,
          last_inbound_at: now,
          window_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          window_status: 'open',
          unread_count: (c.unread_count || 0) + 1,
          updated_at: now,
        }),
      });
      await r('whatsapp_messages', {
        method: 'POST',
        body: JSON.stringify({
          contact_id: c.id,
          direction: 'inbound',
          message_type: clean(d.type || 'text').toLowerCase(),
          body: messageText(d),
          provider_message_id: d.message_id || null,
          raw_payload: p,
          event_type: event,
          status: 'received',
        }),
      });
      await adminControl(incomingIdentity.phone, d);
    }

    if (['message.sent', 'message.delivered', 'message.read', 'message.failed'].includes(event) && d.message_id) {
      const status = d.status || event.replace('message.', '');
      const patch: any = { status, updated_at: now, raw_payload: p };
      if (event === 'message.delivered') patch.delivered_at = now;
      if (event === 'message.read') patch.read_at = now;
      await r(`whatsapp_messages?provider_message_id=eq.${encodeURIComponent(d.message_id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await r(`whatsapp_outbox?provider_message_id=eq.${encodeURIComponent(d.message_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, response_payload: p, error_message: d.errors ? JSON.stringify(d.errors) : null, updated_at: now }),
      });
    }
    return j({ ok: true, event, identity: event === 'message.received' ? incomingIdentity : undefined });
  } catch (e) {
    return j({ ok: false, error: e instanceof Error ? e.message : 'Server error' }, 500);
  }
});
