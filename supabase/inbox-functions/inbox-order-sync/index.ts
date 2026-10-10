import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
function clean(value: unknown) { return String(value ?? '').trim(); }
function nullable(value: unknown) { const result = clean(value); return result || null; }
function numberOrNull(value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function normalizePhone(value: unknown) {
  let digits = clean(value).replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = '60' + digits.slice(1);
  else if (!digits.startsWith('60') && digits.length >= 9 && digits.length <= 10) digits = '60' + digits;
  return digits;
}
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

const changeFields = [
  'payment_status','order_status','admin_status','ship_by_at','shipped_at','active_order',
  'priority_level','items','payment_total','paid_amount','balance_amount','shipment_status',
  'tracking_no','buyer_message','delivery_address','fulfillment_status'
] as const;

function changesBetween(oldRow: Record<string, unknown> | null, nextRow: Record<string, unknown>) {
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const field of changeFields) {
    const before = oldRow?.[field] ?? null;
    const after = nextRow[field] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      oldValue[field] = before;
      newValue[field] = after;
    }
  }
  return { oldValue, newValue, changed: Object.keys(newValue).length > 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: 'Server configuration missing' }, 500);

  const authDb = createClient(supabaseUrl, serviceKey, {auth:{persistSession:false}});
  const {data: credential} = await authDb.from('private_runtime_settings').select('setting_value').eq('setting_key','admin_window_bridge_token').single();
  const token = req.headers.get('x-order-sync-token');
  if (!token || !credential?.setting_value || token !== credential.setting_value) return json({ok:false,error:'Unauthorized'},401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const rows = Array.isArray(body.orders) ? body.orders as Record<string, unknown>[] : [body];
  if (rows.length > 100) return json({ok:false,error:'Maximum 100 orders per batch'},400);
  const now = new Date().toISOString();

  const payloads = rows.flatMap((item) => {
    const orderNo = clean(item.order_no ?? item.external_order_id);
    if (!orderNo) return [];
    const phoneRaw = clean(item.customer_phone ?? item.phone);
    const paymentTotal = numberOrNull(item.payment_total ?? item.total);
    const paidAmount = numberOrNull(item.paid_amount);
    const balanceAmount = numberOrNull(item.balance_amount) ??
      (paymentTotal != null && paidAmount != null ? Math.max(0, paymentTotal - paidAmount) : null);
    const items = arrayValue(item.items);
    return [{
      source_project: clean(item.source_project) || 'icetak-order-system',
      source_channel: clean(item.source_channel) || 'unknown',
      external_order_id: clean(item.external_order_id) || orderNo,
      order_system_order_id: nullable(item.order_system_order_id),
      order_system_customer_id: nullable(item.order_system_customer_id),
      order_no: orderNo,
      customer_name: nullable(item.customer_name),
      customer_phone: phoneRaw || null,
      customer_phone_normalized: normalizePhone(item.customer_phone_normalized || phoneRaw) || null,
      shopee_username: nullable(item.shopee_username),
      shopee_buyer_id: nullable(item.shopee_buyer_id),
      payment_status: nullable(item.payment_status),
      order_status: nullable(item.order_status),
      admin_status: nullable(item.admin_status),
      delivery_method: nullable(item.delivery_method),
      date_need: nullable(item.date_need),
      ship_by_at: nullable(item.ship_by_at),
      shipped_at: nullable(item.shipped_at),
      active_order: Boolean(item.active_order),
      priority_level: clean(item.priority_level) || 'P4',
      priority_reason: nullable(item.priority_reason),
      public_order_url: nullable(item.public_order_url),
      clickup_url: nullable(item.clickup_url),
      items,
      payment_total: paymentTotal,
      paid_amount: paidAmount,
      balance_amount: balanceAmount,
      shipment_status: nullable(item.shipment_status),
      tracking_no: nullable(item.tracking_no),
      tracking_link: nullable(item.tracking_link),
      order_updated_at: nullable(item.order_updated_at) || now,
      source_payload_version: nullable(item.source_payload_version) || 'marketplace-order-v2',
      region: nullable(item.region),
      shop_id: nullable(item.shop_id),
      buyer_shop_id: nullable(item.buyer_shop_id),
      delivery_address: nullable(item.delivery_address),
      buyer_message: nullable(item.buyer_message),
      placed_at: nullable(item.placed_at),
      courier_name: nullable(item.courier_name),
      currency: nullable(item.currency),
      detail_complete: Boolean(item.detail_complete),
      item_count: Number(item.item_count ?? items.length) || 0,
      shipping_fee: numberOrNull(item.shipping_fee),
      payment_method: nullable(item.payment_method),
      fulfillment_status: nullable(item.fulfillment_status),
      package_number: nullable(item.package_number),
      metadata: {...objectValue(item.metadata), provisional:false, source:'canonical_order_sync'},
      last_synced_at: now,
      updated_at: now,
    }];
  });

  if (payloads.length === 0) return json({ ok: false, error: 'No valid orders supplied' }, 400);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const changes: Array<{ payload: Record<string, unknown>; oldValue: Record<string, unknown>; newValue: Record<string, unknown>; created: boolean }> = [];

  const accepted: typeof payloads = [];
  for (const payload of payloads) {
    const { data: existing, error } = await db.from('external_order_summaries').select('*')
      .eq('source_project', payload.source_project).eq('order_no', payload.order_no).maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (existing?.metadata?.source === 'canonical_order_sync' && existing?.order_updated_at && Date.parse(existing.order_updated_at) > Date.parse(payload.order_updated_at)) continue;
    accepted.push(payload);
    const compared = changesBetween(existing as Record<string, unknown> | null, payload);
    if (!existing || compared.changed) changes.push({ payload, oldValue: compared.oldValue, newValue: compared.newValue, created: !existing });
  }

  if (!accepted.length) return json({ok:true,saved:0,skipped:payloads.length});
  const { data: saved, error } = await db.from('external_order_summaries')
    .upsert(accepted.sort((a,b) => a.order_no.localeCompare(b.order_no)), { onConflict: 'source_project,order_no' }).select('id,source_project,order_no');
  if (error) return json({ ok: false, error: error.message }, 500);

  let linked = 0;
  for (const row of saved ?? []) {
    const { data: linkedCount, error: linkError } = await db.rpc('auto_link_external_order_summary', { p_summary_id: row.id });
    if (linkError) return json({ok:false,error:linkError.message},500);
    linked += Number(linkedCount ?? 0);
  }

  let activityCount = 0;
  for (const change of changes) {
    const orderNo = String(change.payload.order_no);
    const sourceProject = String(change.payload.source_project);
    const { data: links } = await db.from('conversation_order_links').select('conversation_id')
      .eq('source_project', sourceProject).eq('order_no', orderNo).is('unlinked_at', null);
    for (const link of links ?? []) {
      const { error: activityError } = await db.from('conversation_activity_logs').insert({
        conversation_id: link.conversation_id,
        event_type: change.created ? 'order_summary_created' : 'order_summary_updated',
        actor_type: 'integration',
        actor_label: 'Order System',
        source: sourceProject,
        summary: change.created ? `Order ${orderNo} diterima daripada Order System` : `Order ${orderNo} dikemas kini`,
        old_value: change.oldValue,
        new_value: change.newValue,
        metadata: { order_no: orderNo, source_project: sourceProject, payload_version: change.payload.source_payload_version },
        importance: change.newValue.shipment_status || change.newValue.payment_status ? 'high' : 'normal',
      });
      if (!activityError) activityCount += 1;
    }
  }

  return json({ ok: true, processed: rows.length, saved: payloads.length, changed: changes.length, linked, activities_created: activityCount });
});
