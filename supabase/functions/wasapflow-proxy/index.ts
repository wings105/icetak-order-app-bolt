import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U = Deno.env.get('SUPABASE_URL') || '';
const K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OFFICIAL = 'https://officialapi.wasapflow.com/bridge/v1';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-partner-key,x-waba-id',
};

async function setting(key: string) {
  const response = await fetch(`${U}/rest/v1/whatsapp_settings?key=eq.${encodeURIComponent(key)}&limit=1`, {
    headers: { apikey: K, authorization: `Bearer ${K}` },
  });
  const rows = await response.json().catch(() => []);
  return rows?.[0]?.secret_value || rows?.[0]?.text_value || '';
}

async function templateMeta(name: string, language: string) {
  const response = await fetch(
    `${U}/rest/v1/whatsapp_templates?name=eq.${encodeURIComponent(name)}&language=eq.${encodeURIComponent(language)}&status=eq.APPROVED&select=category,components&limit=1`,
    { headers: { apikey: K, authorization: `Bearer ${K}` } },
  );
  const rows = await response.json().catch(() => []);
  return rows?.[0] || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ success:false, error:'POST required' }), {
        status:405,
        headers:{...CORS,'content-type':'application/json'},
      });
    }
    const pathname = new URL(req.url).pathname
      .replace(/^\/functions\/v1\/wasapflow-proxy/, '')
      .replace(/^\/wasapflow-proxy/, '') || '/';
    if (!['/messages/send','/messages/template'].includes(pathname)) {
      return new Response(JSON.stringify({ success:false, error:`Not found: ${pathname}` }), {
        status:404,
        headers:{...CORS,'content-type':'application/json'},
      });
    }
    const partner = req.headers.get('x-partner-key') || '';
    const waba = req.headers.get('x-waba-id') || '';
    if (!partner || !waba || partner !== await setting('partner_key') || waba !== await setting('waba_id')) {
      return new Response(JSON.stringify({ success:false, error:'Unauthorized' }), {
        status:401,
        headers:{...CORS,'content-type':'application/json'},
      });
    }

    const payload = await req.json().catch(() => ({}));
    if (pathname === '/messages/template' && payload?.template) {
      const languageCode = typeof payload.template.language === 'string'
        ? payload.template.language
        : payload.template.language?.code || 'ms';
      payload.template.language = { code: languageCode };

      const meta = await templateMeta(String(payload.template.name || ''), languageCode);
      if (String(meta?.category || '').toUpperCase() === 'AUTHENTICATION') {
        const components = Array.isArray(payload.template.components) ? payload.template.components : [];
        const body = components.find((component: any) => String(component?.type || '').toLowerCase() === 'body');
        const otp = body?.parameters?.[0]?.text;
        const hasButton = components.some((component: any) => String(component?.type || '').toLowerCase() === 'button');
        if (otp && !hasButton) {
          components.push({
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: String(otp) }],
          });
        }
        payload.template.components = components;
      }
    }

    const upstream = await fetch(`${OFFICIAL}${pathname}`, {
      method:'POST',
      headers:{'content-type':'application/json','x-partner-key':partner,'x-waba-id':waba},
      body:JSON.stringify(payload),
    });
    const text = await upstream.text();
    return new Response(text, {
      status:upstream.status,
      headers:{...CORS,'content-type':upstream.headers.get('content-type') || 'application/json'},
    });
  } catch (error) {
    return new Response(JSON.stringify({ success:false, error:error instanceof Error ? error.message : String(error) }), {
      status:500,
      headers:{...CORS,'content-type':'application/json'},
    });
  }
});