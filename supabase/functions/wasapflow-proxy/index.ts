import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U = Deno.env.get('SUPABASE_URL') || '';
const K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OFFICIAL = 'https://officialapi.wasapflow.com/bridge/v1';
const BSUID_RE = /^[A-Z]{2}\.\d+$/i;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-partner-key,x-waba-id',
};
const clean = (value: unknown) => String(value ?? '').trim();
const phoneOf = (value: unknown) => {
  const raw = clean(value);
  if (!raw || BSUID_RE.test(raw)) return '';
  let phone = raw.replace(/\D/g, '');
  if (phone.startsWith('00')) phone = phone.slice(2);
  if (phone.startsWith('0')) phone = `60${phone.slice(1)}`;
  else if (phone.startsWith('1') && phone.length >= 9 && phone.length <= 10) phone = `60${phone}`;
  return /^[1-9]\d{7,14}$/.test(phone) ? phone : '';
};
const bsuidOf = (value: unknown) => {
  const raw = clean(value);
  return BSUID_RE.test(raw) ? raw.toUpperCase() : '';
};
async function setting(key: string) {
  const r = await fetch(`${U}/rest/v1/whatsapp_settings?key=eq.${encodeURIComponent(key)}&limit=1`, { headers: { apikey: K, authorization: `Bearer ${K}` } });
  const rows = await r.json().catch(() => []);
  return rows?.[0]?.secret_value || rows?.[0]?.text_value || '';
}
async function templateMeta(name: string, language: string) {
  const r = await fetch(`${U}/rest/v1/whatsapp_templates?name=eq.${encodeURIComponent(name)}&language=eq.${encodeURIComponent(language)}&status=eq.APPROVED&select=category,components&limit=1`, { headers: { apikey: K, authorization: `Bearer ${K}` } });
  const rows = await r.json().catch(() => []);
  return rows?.[0] || null;
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (req.method !== 'POST') return response({ success: false, error: 'POST required' }, 405);
    const pathname = new URL(req.url).pathname.replace(/^\/functions\/v1\/wasapflow-proxy/, '').replace(/^\/wasapflow-proxy/, '') || '/';
    if (!['/messages/send', '/messages/template', '/messages/interactive'].includes(pathname)) return response({ success: false, error: `Not found: ${pathname}` }, 404);

    const partner = req.headers.get('x-partner-key') || '';
    const waba = req.headers.get('x-waba-id') || '';
    if (!partner || !waba || partner !== await setting('partner_key') || waba !== await setting('waba_id')) return response({ success: false, error: 'Unauthorized' }, 401);

    const payload: any = await req.json().catch(() => ({}));
    const phone = phoneOf(payload.to);
    const bsuid = bsuidOf(payload.recipient);
    if (payload.to && !phone) return response({ success: false, error: 'Invalid to phone. BSUID must be supplied in recipient.' }, 400);
    if (payload.recipient && !bsuid) return response({ success: false, error: 'Invalid recipient BSUID.' }, 400);
    if (!phone && !bsuid) return response({ success: false, error: 'Provide to (phone) or recipient (BSUID).' }, 400);
    if (phone) payload.to = phone;
    if (bsuid) payload.recipient = bsuid;

    if (pathname === '/messages/interactive' && !payload.interactive && payload.type) {
      payload.interactive = { type: payload.type, body: payload.body || {}, action: payload.action || {} };
      delete payload.type; delete payload.body; delete payload.action;
    }

    if (pathname === '/messages/template' && payload?.template) {
      const languageCode = typeof payload.template.language === 'string' ? payload.template.language : payload.template.language?.code || 'ms';
      payload.template.language = { code: languageCode };
      const meta = await templateMeta(String(payload.template.name || ''), languageCode);
      if (String(meta?.category || '').toUpperCase() === 'AUTHENTICATION') {
        if (!phone) return response({ success: false, error: 'Authentication templates require a real phone number in to; BSUID recipient is not supported.' }, 400);
        const components = Array.isArray(payload.template.components) ? payload.template.components : [];
        const body = components.find((c: any) => String(c?.type || '').toLowerCase() === 'body');
        const otp = body?.parameters?.[0]?.text;
        const hasButton = components.some((c: any) => String(c?.type || '').toLowerCase() === 'button');
        if (otp && !hasButton) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(otp) }] });
        payload.template.components = components;
        delete payload.recipient;
      }
    }

    const upstream = await fetch(`${OFFICIAL}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-partner-key': partner, 'x-waba-id': waba },
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { ...CORS, 'content-type': upstream.headers.get('content-type') || 'application/json' } });
  } catch (error) {
    return response({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
