import { learnReplies } from '../_shared/reply-knowledge.ts';
import { replySuggestion } from './suggestion.ts';
const url = Deno.env.get('SUPABASE_URL') || '', key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const out = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
async function db(path: string, body?: unknown) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('CONTEXT_READ_FAILED');
  const text=await response.text();return text?JSON.parse(text):null;
}
// Server-to-server only. The staff gateway loads the actual chat; browsers never see this key.
Deno.serve(async req => {
  if (req.method !== 'POST') return out({ ok: false }, 405);
  try {
    const rows = await db('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
    const expected = rows[0]?.setting_value, supplied = req.headers.get('x-admin-window-token');
    if (!expected || !supplied || expected !== supplied) return out({ ok: false, error: 'Unauthorized' }, 401);
    const body = await req.json();
    if(body.action==='learn'){
      if(!Array.isArray(body.items)||body.items.length<1||body.items.length>20)return out({ok:false},400);
      return out(await learnReplies(body.items,db,(name,data)=>db(`rpc/${name}`,data)));
    }
    const c=body.conversation;
    if (!c || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.id) || !['whatsapp', 'shopee'].includes(c.channel) || !Array.isArray(c.messages) || c.messages.length > 100) return out({ ok: false }, 400);
    return out(await replySuggestion(c, (name, body) => db(`rpc/${name}`, body), db));
  } catch {
    return out({ ok: false, error: 'Konteks order belum tersedia.' }, 503);
  }
});
