import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'content-type': 'application/json' } });
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

async function currentAdmin(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${token}` },
  });
  const user = await authResponse.json();
  if (!authResponse.ok || !user?.id) return null;

  const rows = await rest(`admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&limit=1`).catch(() => []);
  const admin = rows?.[0];
  if (!admin) return null;
  const permissionRows = await rest(`admin_permissions?username=eq.${encodeURIComponent(admin.username)}&limit=1`).catch(() => []);
  return { ...admin, permissions: permissionRows?.[0]?.permissions || [] };
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const admin = await currentAdmin(req);
    if (!admin) return json({ error: 'Unauthorized' }, 401);

    const url = new URL(req.url);
    const path = url.pathname
      .replace(/^\/functions\/v1\/api-admin-secure/, '')
      .replace(/^\/api-admin-secure/, '')
      .replace(/^\/admin/, '') || '/';

    if (path === '/dashboard') {
      if (!admin.permissions.includes('view_orders')) return json({ error: 'Forbidden' }, 403);
      const orders = await rest('orders?order=created_at.desc');
      const users = await rest('admin_users?order=created_at.asc');
      const admins = [];
      for (const user of users) {
        const permissionRows = await rest(`admin_permissions?username=eq.${encodeURIComponent(user.username)}&limit=1`).catch(() => []);
        admins.push({
          username: user.username,
          email: user.email,
          display_name: user.display_name,
          role: user.role,
          permissions: permissionRows?.[0]?.permissions || [],
        });
      }

      return json({
        admin: {
          username: admin.username,
          email: admin.email,
          display_name: admin.display_name,
          role: admin.role,
          permissions: admin.permissions,
          paymentWebhookConfigured: true,
          shipmentWebhookConfigured: true,
          orderWebhookConfigured: false,
          whatsappSettings: { enabled: false },
          productionIntegration: { configured: false, url: '' },
        },
        orders,
        admins,
      });
    }

    return json({ error: `Not found: ${path}` }, 404);
  } catch (error) {
    return json({ error: error?.message || 'Server error' }, 500);
  }
});
