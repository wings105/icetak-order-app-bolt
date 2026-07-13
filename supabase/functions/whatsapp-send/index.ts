import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U = Deno.env.get('SUPABASE_URL') || '';
const K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const C = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,apikey',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...C, 'content-type': 'application/json' },
});
const phoneOf = (phone: string) => {
  const value = String(phone || '').replace(/\D/g, '');
  return value.startsWith('60') ? value : value.startsWith('0') ? `6${value}` : value.startsWith('1') ? `60${value}` : value;
};
const render = (text: string, vars: Record<string, unknown>) => String(text || '')
  .replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, (_match, key) => String(vars?.[key] ?? ''));

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${U}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: K,
      authorization: `Bearer ${K}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `REST ${response.status}`);
  return data;
}

async function authorized(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  if (token === K) return true;
  const response = await fetch(`${U}/auth/v1/user`, { headers: { apikey: K, authorization: `Bearer ${token}` } });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) return false;
  const admins = await rest(`admin_users?auth_user_id=eq.${user.id}&is_active=eq.true&limit=1`).catch(() => []);
  return Boolean(admins?.[0]);
}

async function setting(key: string) {
  const rows = await rest(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => []);
  return rows?.[0]?.secret_value || rows?.[0]?.text_value || rows?.[0]?.value?.url || '';
}

async function windowStatus(phone: string) {
  const url = await setting('unified_inbox_24h_url');
  if (!url) return { ok: false, can_send_freeform: false, reason: 'missing_24h_url' };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok && data.ok !== false
    ? data
    : { ok: false, can_send_freeform: false, error: data.error || `24h_http_${response.status}` };
}

async function provider(path: string, payload: unknown) {
  const base = await setting('base_url') || 'https://officialapi.wasapflow.com/bridge/v1';
  const partner = await setting('partner_key');
  const waba = await setting('waba_id');
  if (!partner || !waba) throw new Error('WasapFlow credential belum lengkap');
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-partner-key': partner, 'x-waba-id': waba },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const detail = data?.error?.message || data?.message || JSON.stringify(data);
    throw new Error(`WasapFlow ${response.status}: ${detail}`);
  }
  return data;
}

async function logOutbox(row: Record<string, unknown>) {
  const idempotencyKey = row.idempotency_key;
  try {
    return await rest(`whatsapp_outbox${idempotencyKey ? '?on_conflict=idempotency_key' : ''}`, {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(row),
    });
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  let logId = '';
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: C });
    if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
    if (!await authorized(req)) return json({ ok: false, error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const phone = phoneOf(body.phone || body.to || '');
    if (!/^601\d{8,9}$/.test(phone)) return json({ ok: false, error: 'phone required' }, 400);

    const eventType = body.event_type || 'manual';
    const vars = { ...(body.vars || body) };
    if (vars.otp && !vars.otp_code) vars.otp_code = vars.otp;
    if (!vars.expiry_minutes) vars.expiry_minutes = '10';

    const rule = (await rest(`whatsapp_notification_rules?event_type=eq.${encodeURIComponent(eventType)}&limit=1`).catch(() => []))?.[0] || {};
    if (rule.enabled === false) return json({ ok: false, error: `notification_disabled:${eventType}` }, 409);

    const window = await windowStatus(phone);
    const canSendFreeform = Boolean(window.can_send_freeform);
    const mode = body.mode && body.mode !== 'auto'
      ? body.mode
      : canSendFreeform && rule.freeform_enabled !== false ? 'text' : 'template';
    const decisionReason = mode === 'text' ? '24h_window_open' : '24h_window_closed_or_unavailable';

    let payload: Record<string, unknown>;
    let endpoint = '';
    let templateLanguage: string | null = null;

    if (mode === 'text') {
      if (rule.freeform_enabled === false) return json({ ok: false, error: 'freeform_disabled' }, 409);
      const text = body.text || render(rule.freeform_text || '', vars);
      if (!text.trim()) return json({ ok: false, error: 'freeform_message_empty' }, 400);
      payload = { to: phone, text, preview_url: false };
      endpoint = '/messages/send';
    } else {
      if (rule.template_enabled === false) return json({ ok: false, error: 'template_disabled' }, 409);
      const name = body.template_name || rule.template_name;
      const language = body.template_language || rule.template_language || 'ms';
      templateLanguage = language;
      if (!name) return json({ ok: false, error: 'template_name_required' }, 400);

      const approved = await rest(`whatsapp_templates?name=eq.${encodeURIComponent(name)}&language=eq.${encodeURIComponent(language)}&status=eq.APPROVED&limit=1`).catch(() => []);
      if (!approved?.[0]) {
        return json({ ok: false, error: `template_not_approved:${name}:${language}`, decision_reason: decisionReason, window }, 409);
      }

      const keys = Array.isArray(body.template_params)
        ? body.template_params
        : Array.isArray(rule.template_params) ? rule.template_params : [];

      payload = {
        to: phone,
        template: {
          name,
          language: { code: language },
          components: keys.length
            ? [{ type: 'body', parameters: keys.map((key: string) => ({ type: 'text', text: String(vars[key] ?? '') })) }]
            : [],
        },
      };
      endpoint = '/messages/template';
    }

    const idempotencyKey = body.idempotency_key || null;
    if (idempotencyKey) {
      const old = await rest(`whatsapp_outbox?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&status=eq.sent&limit=1`).catch(() => []);
      if (old?.[0]) {
        return json({ ok: true, duplicate: true, mode: old[0].mode, message_id: old[0].provider_message_id, decision_reason: old[0].decision_reason });
      }
    }

    const baseLog = {
      phone,
      event_type: eventType,
      customer_name: vars.customer_name || null,
      order_no: vars.order_id || null,
      order_token: vars.order_token || null,
      mode,
      message_type: mode === 'template' ? 'template' : 'text',
      body: payload.text || null,
      template_name: payload.template?.name || null,
      template_language: templateLanguage,
      template_components: payload.template?.components || null,
      can_send_freeform: canSendFreeform,
      status: 'processing',
      request_payload: payload,
      response_payload: {},
      source: body.source || 'system',
      idempotency_key: idempotencyKey,
      attempt_count: 1,
      last_attempt_at: new Date().toISOString(),
      decision_reason: decisionReason,
      window_payload: window,
    };

    const logged = await logOutbox(baseLog);
    logId = logged?.[0]?.id || '';

    try {
      const sent = await provider(endpoint, payload);
      if (logId) {
        await rest(`whatsapp_outbox?id=eq.${logId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'sent',
            provider_message_id: sent.message_id || sent.id || null,
            response_payload: sent,
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });
      }
      return json({
        ok: true,
        mode,
        to: phone,
        message_id: sent.message_id || sent.id || null,
        can_send_freeform: canSendFreeform,
        decision_reason: decisionReason,
        window,
      });
    } catch (error) {
      if (logId) {
        await rest(`whatsapp_outbox?id=eq.${logId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'failed',
            error_code: 'provider_error',
            error_message: error instanceof Error ? error.message : String(error),
            response_payload: { error: error instanceof Error ? error.message : String(error) },
            updated_at: new Date().toISOString(),
          }),
        });
      }
      throw error;
    }
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});