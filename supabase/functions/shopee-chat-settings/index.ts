import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const U = Deno.env.get('SUPABASE_URL') || '', K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info' };
const out = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, 'cache-control': 'no-store' } });
async function rest(path: string) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: { apikey: K, authorization: `Bearer ${K}` }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Database unavailable');
  return await r.json();
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return out({ ok: false, error: 'POST required' }, 405);
  try {
    const authorization = req.headers.get('authorization');
    if (!authorization) return out({ ok: false, error: 'Admin login diperlukan.' }, 401);
    const auth = await fetch(`${U}/auth/v1/user`, { headers: { apikey: K, authorization }, signal: AbortSignal.timeout(10000) });
    const user = await auth.json().catch(() => null);
    if (!auth.ok || !user?.id) return out({ ok: false, error: 'Admin login diperlukan.' }, 401);
    const admins = await rest(`admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=username,role&limit=1`);
    const admin = admins[0];
    // Credential management is owner-only, regardless of general staff permissions.
    if (admin?.role !== 'owner') return out({ ok: false, error: 'Hanya owner boleh urus credential Shopee.' }, 403);
    const raw = await req.text();
    if (raw.length > 16000) return out({ ok: false, error: 'Payload terlalu besar.' }, 413);
    const b = JSON.parse(raw);
    if (!['get', 'save', 'check', 'rotate_webhook'].includes(b.action)) return out({ ok: false, error: 'Action tidak sah.' }, 400);
    const rows = await rest('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
    if (!rows[0]?.setting_value) return out({ ok: false, error: 'Inbox bridge belum tersedia.' }, 503);
    const result = await fetch('https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-chat-config', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-window-token': rows[0].setting_value }, body: JSON.stringify({ ...b, actor: admin.username }), signal: AbortSignal.timeout(45000) });
    const data = await result.json().catch(() => ({ ok: false, error: 'Inbox tidak memberi respons yang sah.' }));
    return out(data, result.status);
  } catch { return out({ ok: false, error: 'Tetapan Shopee tidak dapat diproses.' }, 500); }
});
