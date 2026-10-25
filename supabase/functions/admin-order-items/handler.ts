const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info',
};
const json = (body, status = 200) => Response.json(body, { status, headers: { ...cors, 'cache-control': 'no-store' } });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const locked = o => ['cancelled','completed','delivered','customer collected'].includes(String(o.status || '').toLowerCase())
  || ['cancelled','ready_for_pickup','collected','delivered','completed'].includes(String(o.fulfillment_stage || '').toLowerCase())
  || o.pickup_ready_at || o.pickup_collected_at || o.delivered_at
  || ['picked_up','shipped','in_transit','out_for_delivery','delivered'].includes(String(o.shipment_status_group || '').toLowerCase());

export function createAdminOrderItemsHandler({ url, key, fetcher = fetch }) {
  const service = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  async function db(path, body, headers = service, method = body === undefined ? 'GET' : 'POST') {
    const r = await fetcher(url + '/rest/v1/' + path, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw Error(data?.message || 'Gagal menyimpan perubahan order.');
    return data;
  }
  async function task(token, id, archived) {
    const r = await fetcher('https://api.clickup.com/api/v2/task/' + encodeURIComponent(id), {
      method: archived === undefined ? 'GET' : 'PUT',
      headers: { authorization: token, 'content-type': 'application/json' },
      ...(archived === undefined ? {} : { body: JSON.stringify({ archived }) }),
      redirect: 'error', signal: AbortSignal.timeout(25000),
    });
    if (r.status === 404) return null;
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || data.err || data.error || String(data.id) !== id) throw Error('ClickUp belum dapat disahkan. Item belum dibuang.');
    return data;
  }
  return async request => {
    if (request.method === 'OPTIONS') return json({ ok: true });
    if (request.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
    let payload, token = '', selected = [], changed = [], dbAttempted = false;
    const archivedTasks = [];
    try {
      const authorization = request.headers.get('authorization');
      if (!authorization) return json({ ok: false, error: 'Sila log masuk sebagai admin.' }, 401);
      const auth = await fetcher(url + '/auth/v1/user', { headers: { apikey: key, authorization }, signal: AbortSignal.timeout(10000) });
      const user = await auth.json().catch(() => null);
      if (!auth.ok || !user?.id) return json({ ok: false, error: 'Sila log masuk semula.' }, 401);
      const userHeaders = { ...service, authorization };
      const allowed = await db('rpc/icetak_admin_has_permission', { p_permission: 'edit_order' }, userHeaders);
      if (allowed !== true) return json({ ok: false, error: 'Kebenaran edit order diperlukan.' }, 403);
      const admins = await db('admin_users?auth_user_id=eq.' + user.id + '&is_active=eq.true&select=username&limit=1');
      if (!admins?.[0]?.username) return json({ ok: false, error: 'Admin tidak aktif.' }, 403);
      payload = await request.json();
      if (!uuid(payload?.order_db_id) || !Array.isArray(payload.delete_ids) || payload.delete_ids.length > 50
          || !payload.delete_ids.every(uuid) || !Array.isArray(payload.items) || payload.items.length > 100) {
        return json({ ok: false, error: 'Data item tidak sah.' }, 400);
      }
      // Never trust client-supplied internal attestation or actor fields.
      delete payload._archived_task_ids; delete payload._actor;
      const orders = await db('orders?id=eq.' + payload.order_db_id + '&select=id,status,fulfillment_stage,pickup_ready_at,pickup_collected_at,delivered_at,shipment_status_group,total');
      if (!orders.length) return json({ ok: false, error: 'Order tidak dijumpai.' }, 404);
      if (locked(orders[0])) return json({ ok: false, error: 'Item dikunci selepas Ready Pickup, penghantaran atau order selesai.' }, 409);
      const items = await db('order_items?order_id=eq.' + payload.order_db_id + '&select=id');
      selected = items.filter(i => payload.delete_ids.includes(i.id)).map(i => i.id);
      if (items.length - selected.length + payload.items.filter(i => !i.id).length < 1) {
        return json({ ok: false, error: 'Order mesti mempunyai sekurang-kurangnya satu item.' }, 400);
      }
      for (const item of payload.items) {
        if (item.id && (!uuid(item.id) || !items.some(i => i.id === item.id)) || selected.includes(item.id)
            || !Number.isInteger(Number(item.qty)) || Number(item.qty) < 1 || !Number.isFinite(Number(item.price)) || Number(item.price) < 0) {
          return json({ ok: false, error: 'Semak ID, kuantiti dan harga item sebelum menyimpan.' }, 400);
        }
      }
      const [components, links] = await Promise.all([
        db('production_components?order_id=eq.' + payload.order_db_id + '&select=id,order_item_id,clickup_task_id'),
        db('clickup_tasks?order_id=eq.' + payload.order_db_id + '&select=id,order_item_id,component_id,clickup_task_id'),
      ]);
      const selectedComponents = new Set(components.filter(c => selected.includes(c.order_item_id)).map(c => c.id));
      const ids = [...new Set([
        ...components.filter(c => selected.includes(c.order_item_id)).map(c => c.clickup_task_id),
        ...links.filter(t => selected.includes(t.order_item_id) || selectedComponents.has(t.component_id)).map(t => t.clickup_task_id),
      ].filter(Boolean))];
      if (ids.some(id => !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) throw Error('Pautan task ClickUp tidak sah.');
      if (ids.length) {
        const filter = ids.map(encodeURIComponent).join(',');
        const shared = await db('production_components?clickup_task_id=in.(' + filter + ')&select=id,order_id,order_item_id,clickup_task_id');
        if (shared.some(c => c.order_id !== payload.order_db_id || !selected.includes(c.order_item_id))) {
          throw Error('Task ClickUp dikongsi dengan item lain. Semak pautan dahulu.');
        }
        const settings = await db('private_runtime_settings?setting_key=eq.clickup_designer_api_token&select=setting_value&limit=1');
        token = settings[0]?.setting_value || '';
        if (!token) throw Error('Sambungan API ClickUp belum disediakan dalam Settings.');
      }
      for (const id of ids) {
        const original = await task(token, id);
        if (!original) { archivedTasks.push(id); continue; }
        if (!original.archived) {
          changed.push(id); // Include uncertain writes in compensation/reconciliation.
          await task(token, id, true);
        }
        const verified = await task(token, id);
        if (verified && verified.archived !== true) throw Error('Arkib task ClickUp belum disahkan. Item belum dibuang.');
        archivedTasks.push(id);
      }
      dbAttempted = true;
      const result = await db('rpc/icetak_admin_order_items_reconcile', {
        p_payload: { ...payload, _actor: admins[0].username, _archived_task_ids: archivedTasks },
      });
      if (!result?.ok) throw Error('Perubahan item belum dapat disahkan.');
      // Keep the task workspace projection in agreement with the archived task.
      for (const id of archivedTasks) {
        try {
          const fresh = await task(token, id);
          if (fresh) await db('rpc/icetak_project_clickup_work', { p_task: fresh, p_observed_at: new Date().toISOString() });
        } catch { /* The existing task sync can refresh this projection. */ }
      }
      return json({ ...result, archived_tasks: archivedTasks.length });
    } catch (error) {
      let remaining;
      try {
        if (payload?.order_db_id && selected.length) {
          remaining = await db('order_items?order_id=eq.' + payload.order_db_id + '&id=in.(' + selected.join(',') + ')&select=id');
          // A timeout after commit is success; never reactivate an already removed task.
          if (dbAttempted && remaining.length === 0) {
            const orders = await db('orders?id=eq.' + payload.order_db_id + '&select=total');
            return json({ ok: true, deleted: selected.length, total: orders[0]?.total, archived_tasks: archivedTasks.length, reconciled: true });
          }
        }
      } catch { remaining = undefined; }
      let restorationFailed = false;
      // If database state is uncertain, keep production archived until a retry can verify it.
      if (!dbAttempted || remaining?.length) {
        for (const id of changed.reverse()) {
          try { await task(token, id, false); const restored = await task(token, id); if (restored?.archived) restorationFailed = true; }
          catch { restorationFailed = true; }
        }
      }
      const message = error instanceof Error ? error.message : 'Gagal membuang item.';
      return json({ ok: false, error: message + (restorationFailed ? ' Pemulihan task perlu disemak admin.' : '') }, 409);
    }
  };
}
