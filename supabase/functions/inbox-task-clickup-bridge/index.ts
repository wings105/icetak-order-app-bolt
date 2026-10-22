import { clickUpBridgeHandler } from './handler.ts';
const url = Deno.env.get('SUPABASE_URL') || '', key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
async function db(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
 const r = await fetch(`${url}/rest/v1/${path}`, { method, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'return=representation' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
 const data = await r.json().catch(() => null); if (!r.ok) throw Error(data?.message || 'BRIDGE_UNAVAILABLE'); return data;
}
async function secret() { const rows = await db('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1'); return rows[0]?.setting_value || ''; }
Deno.serve(clickUpBridgeHandler({ db, secret, async sync(id, channel) {
 const token = await secret();
 const r = await fetch(`${url}/functions/v1/order-inbox-sync-worker`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-order-sync-token': token },
  body: JSON.stringify({ source: channel === 'shopee' ? 'marketplace' : 'direct', order_ids: [id] }), redirect: 'error', signal: AbortSignal.timeout(30000) });
 const data = await r.json(); return r.ok && data.ok === true;
} }));
