import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,apikey',
};
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'content-type': 'application/json' } }); }
function normalizePhone(phone: string) { const v = String(phone || '').replace(/\D/g, ''); if (!v) return ''; if (v.startsWith('60')) return v; if (v.startsWith('0')) return `6${v}`; if (v.startsWith('1')) return `60${v}`; return v; }
function render(text: string, vars: Record<string, unknown>) { return String(text || '').replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, (_, key) => String(vars?.[key] ?? '')); }
async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers || {}) },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  return data;
}
async function isAdmin(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  if (token === SERVICE_ROLE_KEY) return true;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${token}` } });
  const user = await res.json().catch(() => null);
  if (!res.ok || !user?.id) return false;
  const admins = await rest(`admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&limit=1`).catch(() => []);
  return Boolean(admins?.[0]);
}
async function setting(key: string) {
  const rows = await rest(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => []);
  const row = rows?.[0] || {};
  return row.secret_value || row.text_value || row.value?.url || '';
}
async function checkWindow(phone: string) {
  const url = await setting('unified_inbox_24h_url');
  const key = await setting('unified_inbox_24h_key');
  if (!url) return { can_send_freeform: false, should_use_template: true, reason: 'missing_unified_inbox_24h_url' };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ phone }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) return { can_send_freeform: false, should_use_template: true, error: data?.error || `24h_http_${response.status}` };
  return data;
}
async function wasapflow(path: string, body: unknown) {
  const base = await setting('base_url') || 'https://officialapi.wasapflow.com/bridge/v1';
  const partnerKey = await setting('partner_key');
  const wabaId = await setting('waba_id');
  if (!partnerKey || !wabaId) throw new Error('WasapFlow partner_key atau waba_id belum diisi');
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-partner-key': partnerKey, 'x-waba-id': wabaId },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data?.error?.message || `WasapFlow HTTP ${response.status}`);
  return data;
}
Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
    if (!(await isAdmin(req))) return json({ ok: false, error: 'Unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhone(body.phone || body.to || '');
    if (!phone) return json({ ok: false, error: 'phone required' }, 400);
    const eventType = body.event_type || 'manual';
    const rule = (await rest(`whatsapp_notification_rules?event_type=eq.${encodeURIComponent(eventType)}&limit=1`).catch(() => []))?.[0] || {};
    const vars = body.vars || body;
    const windowStatus = await checkWindow(phone);
    const canFreeform = Boolean(windowStatus.can_send_freeform);
    const mode = body.mode && body.mode !== 'auto' ? body.mode : (canFreeform && rule.freeform_enabled !== false ? 'text' : 'template');
    let payload: any;
    let endpoint = '';
    if (mode === 'text') {
      payload = { to: phone, text: body.text || render(rule.freeform_text || '', vars), preview_url: false };
      endpoint = '/messages/send';
    } else {
      const templateName = body.template_name || rule.template_name;
      if (!templateName) return json({ ok: false, error: 'template_name required' }, 400);
      const keys = Array.isArray(body.template_params) ? body.template_params : (Array.isArray(rule.template_params) ? rule.template_params : []);
      payload = {
        to: phone,
        template: {
          name: templateName,
          language: body.template_language || rule.template_language || 'ms',
          components: keys.length ? [{ type: 'body', parameters: keys.map((key: string) => ({ type: 'text', text: String(vars?.[key] ?? '') })) }] : [],
        },
      };
      endpoint = '/messages/template';
    }
    const provider = await wasapflow(endpoint, payload);
    await rest('whatsapp_outbox', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        event_type: eventType,
        customer_name: vars.customer_name || null,
        order_no: vars.order_id || null,
        order_token: vars.order_token || null,
        mode,
        message_type: mode === 'template' ? 'template' : 'text',
        body: payload.text || null,
        template_name: payload.template?.name || null,
        template_language: payload.template?.language || null,
        template_components: payload.template?.components || null,
        can_send_freeform: canFreeform,
        status: 'sent',
        provider_message_id: provider.message_id || null,
        request_payload: payload,
        response_payload: provider,
        source: body.source || 'system',
        sent_at: new Date().toISOString(),
      }),
    }).catch(() => null);
    return json({ ok: true, mode, to: phone, message_id: provider.message_id, can_send_freeform: canFreeform, window: windowStatus });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Server error' }, 500);
  }
});
