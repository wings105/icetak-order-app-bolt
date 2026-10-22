import { actions, inspectDesign, messages, packDesign, readDesignRequest, roles, taskId, uuid, type Data } from '../../functions/_shared/inbox-clickup-contract.ts';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info' };
const out = (body: Data, status = 200) => Response.json(body, { status, headers: { ...cors, 'cache-control': 'no-store' } });
export function inboxClickUpHandler(deps: {
 identity: (req: Request) => Promise<{ id: string; role: string; active: boolean; label: string }>;
 order: (req: Request, id: string, conversationId?: string) => Promise<Data>;
 bridge: (body: Data, file: File | null) => Promise<Response>;
}) {
 return async (req: Request) => {
  if (req.method === 'OPTIONS') return out({ ok: true }); if (req.method !== 'POST') return out({ ok: false }, 405);
  let pending: Data | null = null;
  try {
   if (!req.headers.get('authorization')) throw Error('LOGIN_REQUIRED');
   const actor = await deps.identity(req);
   if (!uuid(actor.id) || !actor.active || !roles.includes(actor.role)) throw Error('STAFF_REQUIRED');
   const { body: b, file } = await readDesignRequest(req);
   if (!b || !uuid(b.summary_id) || !actions.includes(b.action) || b.conversation_id != null && !uuid(b.conversation_id)
    || b.action !== 'list' && !taskId(b.task_id)) throw Error('INVALID_REQUEST');
   if (!['list', 'options'].includes(b.action) && actor.role === 'viewer') throw Error('EDIT_REQUIRED');
   if (!['list', 'options'].includes(b.action) && !uuid(b.request_id)) throw Error('INVALID_REQUEST');
   if (file) { if (b.action !== 'upload') throw Error('INVALID_REQUEST'); await inspectDesign(file); }
   const order = await deps.order(req, b.summary_id, b.conversation_id);
   if (!order || order.source_project !== 'icetak-order-system' || !uuid(order.order_system_order_id) || !['whatsapp', 'shopee'].includes(order.source_channel)) throw Error('ORDER_NOT_FOUND');
   // Credentials, actor/role, canonical order and channel are derived on the server.
   const trusted = { action: b.action, summary_id: order.id, canonical_id: order.order_system_order_id, source_channel: order.source_channel,
    actor_id: actor.id, actor_role: actor.role, actor_label: actor.label.slice(0, 100), task_id: b.task_id, request_id: b.request_id,
    comment: b.comment, status: b.status, expected_status: b.expected_status, expected_updated_at: b.expected_updated_at };
   if (uuid(b.request_id)) pending = { request_id: b.request_id, task_id: b.task_id };
   const r = await deps.bridge(trusted, file); const data = await r.json(); return out(data, r.status);
  } catch (e) {
   const code = e instanceof Error ? e.message : 'BRIDGE_UNAVAILABLE';
   return out({ ok: false, error: messages[code] || messages.BRIDGE_UNAVAILABLE, ...(pending ? { ...pending, uncertain: true } : {}) }, /LOGIN/.test(code) ? 401 : /STAFF|EDIT/.test(code) ? 403 : /INVALID|LARGE|ORDER/.test(code) ? 400 : 503);
  }
 };
}
export { packDesign };
