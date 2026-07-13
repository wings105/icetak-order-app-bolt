import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U = Deno.env.get('SUPABASE_URL') || '';
const A = Deno.env.get('SUPABASE_ANON_KEY') || '';
const C = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,apikey',
};
const J = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...C, 'content-type': 'application/json' },
});

async function rpc(req: Request, name: string, args: unknown = {}) {
  const auth = req.headers.get('authorization') || '';
  const response = await fetch(`${U}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: A, authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `RPC ${response.status}`);
  return data;
}

function routePath(req: Request) {
  const pathname = new URL(req.url).pathname;
  return pathname
    .replace(/^\/functions\/v1\/whatsapp-admin/, '')
    .replace(/^\/whatsapp-admin/, '') || '/';
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: C });
    const path = routePath(req);

    if (req.method === 'GET') {
      const snapshot = await rpc(req, 'icetak_admin_whatsapp_snapshot');
      if (path === '/' || path === '/snapshot') return J({ ok: true, ...snapshot });
      if (path === '/status') return J({ ok: true, ...snapshot.status });
      if (path === '/rules') return J({ ok: true, rules: snapshot.rules || [] });
      if (path === '/templates') return J({ ok: true, templates: snapshot.templates || [] });
      if (path === '/outbox') return J({ ok: true, outbox: snapshot.outbox || [] });
    }

    const body = await req.json().catch(() => ({}));
    if (req.method === 'POST' && path === '/settings') {
      return J(await rpc(req, 'icetak_admin_whatsapp_save_settings', { p_payload: body }));
    }
    if (req.method === 'POST' && path === '/rules') {
      return J(await rpc(req, 'icetak_admin_whatsapp_save_rule', { p_payload: body }));
    }
    if (req.method === 'POST' && path === '/templates/sync') {
      const credentials = await rpc(req, 'icetak_admin_whatsapp_credentials');
      if (!credentials.partner_key || !credentials.waba_id) throw new Error('Partner Key atau WABA ID belum diisi');
      const response = await fetch(`${credentials.base_url}/templates`, {
        headers: { 'x-partner-key': credentials.partner_key, 'x-waba-id': credentials.waba_id },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data?.error?.message || `WasapFlow ${response.status}`);
      const synced = await rpc(req, 'icetak_admin_whatsapp_upsert_templates', {
        p_templates: data.templates || [],
        p_waba_id: credentials.waba_id,
      });
      return J({ ok: true, synced });
    }
    return J({ ok: false, error: `Not found: ${path}` }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /JWT|auth|permission|forbidden|admin/i.test(message) ? 403 : 500;
    return J({ ok: false, error: message }, status);
  }
});
