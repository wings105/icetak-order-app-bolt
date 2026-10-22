import { inboxClickUpHandler, packDesign } from './handler.ts';
const url = Deno.env.get('SUPABASE_URL') || '', key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
async function db(path: string, authorization = `Bearer ${key}`) {
 const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, authorization }, signal: AbortSignal.timeout(15000) });
 if (!r.ok) throw Error('BRIDGE_UNAVAILABLE'); return r.json();
}
Deno.serve(inboxClickUpHandler({
 async identity(req) {
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: req.headers.get('authorization')! }, signal: AbortSignal.timeout(10000) });
  const user = await r.json(); if (!r.ok || !user.id) throw Error('LOGIN_REQUIRED');
  const rows = await db(`workspace_members?auth_user_id=eq.${user.id}&select=auth_user_id,role,active,display_name&limit=1`);
  const m = rows[0]; if (!m) throw Error('STAFF_REQUIRED'); return { id: user.id, role: m.role, active: m.active, label: m.display_name || 'Staf Inbox' };
 },
 async order(req, id, conversationId) {
  const authorization = req.headers.get('authorization')!;
  const rows = await db(`external_order_summaries?id=eq.${id}&select=id,source_project,source_channel,order_system_order_id,order_no&limit=1`, authorization);
  const order = rows[0]; if (!order) throw Error('ORDER_NOT_FOUND');
  if (conversationId) {
   const links = await db(`conversation_order_links?conversation_id=eq.${conversationId}&source_project=eq.icetak-order-system&order_no=eq.${encodeURIComponent(order.order_no)}&unlinked_at=is.null&select=id&limit=1`, authorization);
   if (!links.length) throw Error('ORDER_NOT_FOUND');
  }
  return order;
 },
 async bridge(body, file) {
  const rows = await db('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
  const token = rows[0]?.setting_value; if (!token) throw Error('BRIDGE_UNAVAILABLE');
  return fetch('https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/inbox-task-clickup-bridge', {
   method: 'POST', headers: { 'x-admin-window-token': token, ...(!file ? { 'content-type': 'application/json' } : {}) },
   body: packDesign(body, file), redirect: 'error', signal: AbortSignal.timeout(120000),
  });
 },
}));
