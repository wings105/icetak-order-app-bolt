import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,x-bootstrap-key',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  return data;
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ ok: false, error: 'Unauthorized' }, 401);

    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${token}` },
    });
    const user = await authResponse.json();
    if (!authResponse.ok || !user?.id) return json({ ok: false, error: 'Invalid user session' }, 401);

    const bootstrapKey = req.headers.get('x-bootstrap-key') || '';
    const settings = await rest('integration_settings?key=eq.admin_bootstrap&limit=1');
    if (!bootstrapKey || !settings?.[0]?.key_hash || await sha256(bootstrapKey) !== settings[0].key_hash) {
      return json({ ok: false, error: 'Invalid bootstrap key' }, 401);
    }

    const existing = await rest('admin_users?auth_user_id=not.is.null&limit=1');
    if (existing?.length) return json({ ok: false, error: 'Admin Auth sudah dikonfigurasi' }, 409);

    const body = await req.json().catch(() => ({}));
    await rest('admin_users?username=eq.admin1', {
      method: 'PATCH',
      body: JSON.stringify({
        auth_user_id: user.id,
        email: user.email,
        display_name: body.display_name || 'Owner',
        role: 'owner',
        is_active: true,
        updated_at: new Date().toISOString(),
      }),
    });
    await rest('admin_permissions?username=eq.admin1', {
      method: 'PATCH',
      body: JSON.stringify({ auth_user_id: user.id, email: user.email }),
    }).catch(() => null);
    await rest('integration_settings?key=eq.admin_bootstrap', {
      method: 'PATCH',
      body: JSON.stringify({ key_hash: null, updated_at: new Date().toISOString() }),
    });

    return json({ ok: true, email: user.email });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Server error' }, 500);
  }
});
