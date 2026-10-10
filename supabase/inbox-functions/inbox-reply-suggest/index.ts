import { suggestionHandler } from './handler.ts';
const url = Deno.env.get('SUPABASE_URL') || '', key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
async function db(path: string, body?: unknown) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('READ_FAILED');
  return await response.json();
}
Deno.serve(suggestionHandler({
  async member(req) {
    const authorization = req.headers.get('authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(authorization)) return null;
    const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const user = await response.json();
    if (!user.id) return null;
    const rows = await db(`workspace_members?auth_user_id=eq.${encodeURIComponent(user.id)}&select=role,active&limit=1`);
    return rows[0] || { active: false };
  },
  async read(id) {
    const source = await db('rpc/icetak_ai_inbox_read', { p_conversation_id: id, p_channel: null, p_search: '', p_offset: 0, p_limit: 1 });
    return source.rows?.[0] || null;
  },
  async suggest(conversation) {
    const rows = await db('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
    const token = rows[0]?.setting_value;
    if (!token) throw new Error('BRIDGE_UNAVAILABLE');
    const response = await fetch('https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/inbox-reply-context', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-window-token': token },
      body: JSON.stringify({ conversation }), signal: AbortSignal.timeout(30000), redirect: 'error',
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error('CONTEXT_UNAVAILABLE');
    return result;
  },
}));
