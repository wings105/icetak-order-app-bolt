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

async function trackingAutoPreflight(body: Record<string, any>) {
  const shipmentId = String(body.shipment_id || body?.vars?.shipment_id || '').trim();
  if (!shipmentId) return { ok: false, error: 'tracking_shipment_id_required' };

  const settings = await rest('tracking_system_settings?singleton=eq.true&select=auto_send_enabled,provider_ready&limit=1').catch(() => []);
  const config = settings?.[0];
  if (!config?.auto_send_enabled) return { ok: false, error: 'tracking_auto_disabled' };
  if (!config?.provider_ready) return { ok: false, error: 'tracking_provider_not_ready' };

  const states = await rest(`shipment_tracking_state?shipment_id=eq.${encodeURIComponent(shipmentId)}&select=send_status,manual_cancelled_at&limit=1`).catch(() => []);
  const state = states?.[0];
  if (!state) return { ok: false, error: 'tracking_state_missing' };
  if (state.send_status === 'cancelled' || state.manual_cancelled_at) return { ok: false, error: 'tracking_cancelled' };
  if (state.send_status === 'sent') return { ok: true, duplicate: true };
  if (!['queued', 'ready', 'failed'].includes(String(state.send_status || ''))) {
    return { ok: false, error: `tracking_not_sendable:${state.send_status || 'unknown'}` };
  }
  return { ok: true, duplicate: false };
}

async function pickupAutoPreflight(body: Record<string, any>) {
  const orderId = String(body.order_db_id || body?.vars?.order_db_id || '').trim();
  if (!orderId) return { ok: false, error: 'pickup_order_id_required' };
  const settings = await rest('pickup_notification_settings?singleton=eq.true&select=auto_send_enabled,provider_ready,auto_send_activated_at&limit=1').catch(() => []);
  const config = settings?.[0];
  if (!config?.auto_send_enabled) return { ok: false, error: 'pickup_auto_disabled' };
  if (!config?.provider_ready) return { ok: false, error: 'pickup_provider_not_ready' };
  const orders = await rest(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,delivery_method,delivery,pickup_ready_at,pickup_collected_at,status,admin_status,fulfillment_stage&limit=1`).catch(() => []);
  const order = orders?.[0];
  if (!order) return { ok: false, error: 'pickup_order_missing' };
  if (!String(order.delivery_method || order.delivery || '').toLowerCase().includes('pickup')) return { ok: false, error: 'pickup_not_pickup' };
  if (!order.pickup_ready_at) return { ok: false, error: 'pickup_order_not_ready' };
  if (order.pickup_collected_at) return { ok: false, error: 'pickup_collected' };
  const state = `${order.status || ''} ${order.admin_status || ''} ${order.fulfillment_stage || ''}`.toLowerCase();
  if (state.includes('cancel')) return { ok: false, error: 'pickup_cancelled' };
  if (config.auto_send_activated_at && new Date(order.pickup_ready_at).getTime() < new Date(config.auto_send_activated_at).getTime()) return { ok: false, error: 'pickup_historical_ready' };
  return { ok: true };
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

    if (eventType === 'shipment_auto_tracking') {
      const preflight = await trackingAutoPreflight(body);
      if (preflight.duplicate) return json({ ok: true, duplicate: true, mode: 'auto', decision_reason: 'tracking_already_sent' });
      if (!preflight.ok) return json({ ok: false, error: preflight.error }, 409);
    }
    if (eventType === 'order_ready_pickup_auto') {
      const preflight = await pickupAutoPreflight(body);
      if (!preflight.ok) return json({ ok: false, error: preflight.error }, 409);
    }

    const rule = (await rest(`whatsapp_notification_rules?event_type=eq.${encodeURIComponent(eventType)}&limit=1`).catch(() => []))?.[0] || {};
    if (rule.enabled === false) return json({ ok: false, error: `notification_disabled:${eventType}` }, 409);

    const window = await windowStatus(phone);
    const canSendFreeform = Boolean(window.can_send_freeform);
    const mode = body.mode && body.mode !== 'auto'
      ? body.mode
      : canSendFreeform && rule.freeform_enabled !== false ? 'text' : 'template';
    const decisionReason = mode === 'text' ? '24h_window_open' : '24h_window_closed_or_unavailable';

    let payload: Record<string, any>;
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
      if (!approved?.[0]) return json({ ok: false, error: `template_not_approved:${name}:${language}`, decision_reason: decisionReason, window }, 409);

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
      if (old?.[0]) return json({ ok: true, duplicate: true, mode: old[0].mode, message_id: old[0].provider_message_id, decision_reason: old[0].decision_reason });
    }

    if (eventType === 'shipment_auto_tracking') {
      const finalPreflight = await trackingAutoPreflight(body);
      if (finalPreflight.duplicate) return json({ ok: true, duplicate: true, mode: 'auto', decision_reason: 'tracking_already_sent' });
      if (!finalPreflight.ok) return json({ ok: false, error: finalPreflight.error }, 409);
    }
    if (eventType === 'order_ready_pickup_auto') {
      const finalPreflight = await pickupAutoPreflight(body);
      if (!finalPreflight.ok) return json({ ok: false, error: finalPreflight.error }, 409);
    }

    const baseLog = {
      phone, event_type: eventType, customer_name: vars.customer_name || null,
      order_no: vars.order_id || null, order_token: vars.order_token || null,
      mode, message_type: mode === 'template' ? 'template' : 'text', body: payload.text || null,
      template_name: payload.template?.name || null, template_language: templateLanguage,
      template_components: payload.template?.components || null, can_send_freeform: canSendFreeform,
      status: 'processing', request_payload: payload, response_payload: {}, source: body.source || 'system',
      idempotency_key: idempotencyKey, attempt_count: 1, last_attempt_at: new Date().toISOString(),
      decision_reason: decisionReason, window_payload: window,
    };

    const logged = await logOutbox(baseLog);
    logId = logged?.[0]?.id || '';

    try {
      const sent = await provider(endpoint, payload);
      if (logId) {
        await rest(`whatsapp_outbox?id=eq.${logId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'sent', provider_message_id: sent.message_id || sent.id || null,
            response_payload: sent, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }),
        });
      }
      return json({ ok: true, mode, to: phone, message_id: sent.message_id || sent.id || null, can_send_freeform: canSendFreeform, decision_reason: decisionReason, window });
    } catch (error) {
      if (logId) {
        await rest(`whatsapp_outbox?id=eq.${logId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'failed', error_code: 'provider_error', error_message: error instanceof Error ? error.message : String(error),
            response_payload: { error: error instanceof Error ? error.message : String(error) }, updated_at: new Date().toISOString(),
          }),
        });
      }
      throw error;
    }
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
