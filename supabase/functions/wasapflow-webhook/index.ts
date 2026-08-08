import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const U = Deno.env.get('SUPABASE_URL') || '';
const K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const C = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-wasapflow-signature,x-wasapflow-event',
};
function j(d: unknown, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...C, 'content-type': 'application/json' } }); }
function n(p: string) { const v = String(p || '').replace(/\D/g, ''); if (!v) return ''; if (v.startsWith('60')) return v; if (v.startsWith('0')) return `6${v}`; if (v.startsWith('1')) return `60${v}`; return v; }
async function r(path: string, opt: any = {}) {
  const x = await fetch(`${U}/rest/v1/${path}`, { ...opt, headers: { apikey: K, authorization: `Bearer ${K}`, 'content-type': 'application/json', prefer: 'return=representation', ...(opt.headers || {}) } });
  return x.json().catch(() => null);
}
async function setting(key: string) { const a = await r(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&limit=1`) || []; const z = a[0] || {}; return z.secret_value || z.text_value || z.value?.url || ''; }
async function hmac(raw: string, secret: string) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)); return `sha256=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}`; }
async function contact(phone: string, name = '') { const p = n(phone); let a = await r(`whatsapp_contacts?normalized_phone=eq.${p}&limit=1`) || []; if (a[0]) return a[0]; a = await r('whatsapp_contacts', { method: 'POST', body: JSON.stringify({ phone: p, normalized_phone: p, name, source: 'wasapflow' }) }) || []; return a[0]; }
Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: C });
    const raw = await req.text();
    const sig = req.headers.get('x-wasapflow-signature') || '';
    const secret = await setting('webhook_secret');
    let verified = !secret;
    if (secret) verified = sig === await hmac(raw, secret);
    if (!verified) return j({ ok: false, error: 'invalid signature' }, 401);

    const p = JSON.parse(raw || '{}');
    const event = p.event || req.headers.get('x-wasapflow-event') || 'unknown';
    const d = p.data || {};
    const now = new Date().toISOString();
    await r('wasapflow_webhook_events', { method: 'POST', body: JSON.stringify({ event, waba_id: p.waba_id || null, phone_number_id: p.phone_number_id || null, provider_message_id: d.message_id || null, phone: n(d.from || d.to || ''), signature_valid: verified, raw_payload: p }) }).catch(() => null);

    if (event === 'message.received') {
      const phone = n(d.from || '');
      if (phone) {
        const c = await contact(phone, d.contact_name || '');
        await r(`whatsapp_contacts?id=eq.${c.id}`, { method: 'PATCH', body: JSON.stringify({ bsuid: d.bsuid || c.bsuid || null, last_message_at: now, last_inbound_at: now, window_expires_at: new Date(Date.now() + 86400000).toISOString(), window_status: 'open', unread_count: (c.unread_count || 0) + 1 }) });
        await r('whatsapp_messages', { method: 'POST', body: JSON.stringify({ contact_id: c.id, direction: 'inbound', message_type: d.type || 'text', body: d.text || '', provider_message_id: d.message_id || null, raw_payload: p, event_type: event, status: 'received' }) });
      }
    }
    if (['message.sent', 'message.delivered', 'message.read', 'message.failed'].includes(event) && d.message_id) {
      const status = d.status || event.replace('message.', '');
      const patch: any = { status, updated_at: now, raw_payload: p };
      if (event === 'message.delivered') patch.delivered_at = now;
      if (event === 'message.read') patch.read_at = now;
      await r(`whatsapp_messages?provider_message_id=eq.${encodeURIComponent(d.message_id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await r(`whatsapp_outbox?provider_message_id=eq.${encodeURIComponent(d.message_id)}`, { method: 'PATCH', body: JSON.stringify({ status, response_payload: p, error_message: d.errors ? JSON.stringify(d.errors) : null }) });
    }
    return j({ ok: true, event });
  } catch (e) { return j({ ok: false, error: e?.message || 'Server error' }, 500); }
});
