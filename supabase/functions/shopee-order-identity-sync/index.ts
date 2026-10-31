import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const url = Deno.env.get('SUPABASE_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const out = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return out({ ok: false, error: 'POST_REQUIRED' }, 405);
  try {
    const supplied = req.headers.get('x-admin-window-token');
    const service = !!serviceKey && req.headers.get('authorization') === `Bearer ${serviceKey}`;
    if (!service && !supplied) return out({ ok: false, error: 'UNAUTHORIZED' }, 401);
    const { data: setting, error: settingError } = await db.from('private_runtime_settings')
      .select('setting_value').eq('setting_key', 'admin_window_bridge_token').single();
    const token = setting?.setting_value;
    if (settingError || !token || (!service && supplied !== token)) return out({ ok: false, error: 'UNAUTHORIZED' }, 401);
    const raw = await req.text();
    if (raw.length > 2000) return out({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
    const body = raw.trim() ? JSON.parse(raw) : {};
    const orderSn = body.order_sn == null ? null : String(body.order_sn);
    if (orderSn && !/^[0-9]{6}[A-Z0-9]{6,12}$/.test(orderSn)) return out({ ok: false, error: 'INVALID_ORDER' }, 400);
    const { data: jobs, error: claimError } = await db.rpc('claim_marketplace_identity_sync', {
      p_limit: 50, p_order_sn: orderSn
    });
    if (claimError) throw Error('IDENTITY_CLAIM_FAILED');
    const groups = new Map<string, any[]>();
    for (const row of jobs || []) groups.set(row.shop_id, [...(groups.get(row.shop_id) || []), row]);
    let synced = 0;
    const results = await Promise.all([...groups].map(async ([shop, rows]) => {
      try {
        const response = await fetch('https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-order-audit-source', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-window-token': token },
          body: JSON.stringify({ action: 'order_identity', shop_id: shop, order_sn_list: rows.map(row => row.order_sn) }),
          signal: AbortSignal.timeout(25000)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok || !Array.isArray(result.orders) || result.orders.length !== rows.length)
          throw Error(String(result.error || 'IDENTITY_READ_FAILED'));
        for (const row of rows) {
          const identity = result.orders.find((item: any) => item.order_sn === row.order_sn && item.shop_id === shop);
          if (!identity) throw Error('IDENTITY_ORDER_MISMATCH');
          const { data: applied, error } = await db.rpc('finish_marketplace_identity_sync', {
            p_order_id: row.id, p_lease_id: row.lease_id, p_buyer_id: identity.buyer_user_id,
            p_username: identity.buyer_username, p_error: null
          });
          if (error) throw Error('IDENTITY_APPLY_FAILED');
          if (applied?.updated) synced++;
        }
        return { shop_id: shop, checked: rows.length, ok: true };
      } catch (reason) {
        const error = reason instanceof Error && /^[A-Za-z0-9_.-]{1,100}$/.test(reason.message) ? reason.message : 'IDENTITY_SYNC_FAILED';
        for (const row of rows) {
          await db.rpc('finish_marketplace_identity_sync', {
            p_order_id: row.id, p_lease_id: row.lease_id, p_buyer_id: null, p_username: null, p_error: error
          });
        }
        return { shop_id: shop, checked: rows.length, ok: false, error };
      }
    }));
    return out({ ok: results.every(result => result.ok), claimed: jobs?.length || 0, synced, results });
  } catch {
    return out({ ok: false, error: 'IDENTITY_SYNC_UNAVAILABLE' }, 503);
  }
});
