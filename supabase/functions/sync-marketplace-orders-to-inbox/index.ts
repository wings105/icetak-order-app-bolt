import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function num(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function priority(order: Record<string, unknown>) {
  const status = String(order.current_status ?? '').toUpperCase();
  if (['COMPLETED', 'CANCELLED', 'IN_CANCEL', 'TO_RETURN', 'RETURNED'].includes(status)) return { active: false, level: 'P4', reason: 'Order terminal' };
  const shipBy = order.ship_by_at ? new Date(String(order.ship_by_at)) : null;
  if (shipBy && !Number.isNaN(shipBy.getTime())) {
    const hours = (shipBy.getTime() - Date.now()) / 3600000;
    if (hours < 0) return { active: true, level: 'P0', reason: 'Ship-by overdue' };
    if (hours <= 24) return { active: true, level: 'P1', reason: 'Ship-by within 24 hours' };
    if (hours <= 48) return { active: true, level: 'P2', reason: 'Ship-by within 48 hours' };
  }
  if (String(order.payment_status ?? '').toLowerCase() === 'paid') return { active: true, level: 'P3', reason: 'Paid order' };
  return { active: true, level: 'P4', reason: 'Marketplace order' };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const inboxUrl = Deno.env.get('INBOX_ORDER_SUMMARY_UPSERT_URL') ??
    'https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/inbox-order-summary-upsert';
  const inboxServiceKey = Deno.env.get('INBOX_PROJECT_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey || !inboxServiceKey) return json({ ok: false, error: 'Missing sync environment variables' }, 500);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const orderSn = String(body.order_sn ?? '').trim();
  const limit = Math.max(1, Math.min(Number(body.limit ?? 500), 1000));
  const offset = Math.max(0, Number(body.offset ?? 0));
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let query = db.from('marketplace_orders').select('*').order('updated_at', { ascending: false });
  if (orderSn) query = query.eq('order_sn', orderSn);
  else query = query.range(offset, offset + limit - 1);
  const { data: orders, error } = await query;
  if (error) return json({ ok: false, error: error.message }, 500);
  if (!orders?.length) return json({ ok: true, pulled: 0, saved: 0 });

  const ids = orders.map((order) => order.id);
  const [itemsRes, shipmentsRes] = await Promise.all([
    db.from('marketplace_order_items').select('*').in('order_id', ids).eq('is_current', true).order('line_no'),
    db.from('marketplace_shipments').select('*').in('order_id', ids).order('updated_at', { ascending: false }),
  ]);
  if (itemsRes.error) return json({ ok: false, error: itemsRes.error.message }, 500);
  if (shipmentsRes.error) return json({ ok: false, error: shipmentsRes.error.message }, 500);

  const payloads = orders.map((order) => {
    const items = (itemsRes.data ?? []).filter((item) => item.order_id === order.id).map((item) => ({
      provider_item_id: item.provider_item_id,
      provider_variation_id: item.provider_variation_id,
      item_sku: item.item_sku,
      variation_sku: item.variation_sku,
      title: item.title,
      variation_name: item.variation_name,
      quantity: item.quantity,
      unit_original_price: item.unit_original_price,
      unit_discounted_price: item.unit_discounted_price,
      line_subtotal: item.line_subtotal,
      image_url: item.image_url,
    }));
    const shipment = (shipmentsRes.data ?? []).find((row) => row.order_id === order.id);
    const raw = order.raw_detail && typeof order.raw_detail === 'object' ? order.raw_detail as Record<string, unknown> : {};
    const buyerPaid = num(raw.buyer_paid);
    const shippingFee = num(raw.shipping_fee);
    const p = priority(order);
    return {
      source_project: 'icetak-order-system',
      source_channel: 'shopee',
      external_order_id: order.order_sn,
      order_system_order_id: order.id,
      order_system_customer_id: order.buyer_customer_id,
      order_no: order.order_sn,
      customer_name: order.buyer_username,
      shopee_username: order.buyer_username,
      shopee_buyer_id: order.buyer_user_id,
      payment_status: order.payment_status,
      order_status: order.current_status,
      delivery_method: order.courier_name,
      ship_by_at: order.ship_by_at,
      shipped_at: String(shipment?.shipment_status ?? '').toUpperCase().includes('SHIPPED') ? shipment?.last_event_at : null,
      active_order: p.active,
      priority_level: p.level,
      priority_reason: p.reason,
      items,
      payment_total: buyerPaid,
      paid_amount: String(order.payment_status ?? '').toLowerCase() === 'paid' ? buyerPaid : null,
      balance_amount: String(order.payment_status ?? '').toLowerCase() === 'paid' ? 0 : buyerPaid,
      shipment_status: shipment?.shipment_status ?? shipment?.fulfillment_status ?? order.fulfillment_status,
      tracking_no: shipment?.tracking_number,
      order_updated_at: order.updated_at,
      source_payload_version: 'marketplace-order-v2',
      region: order.region,
      shop_id: order.shop_id,
      buyer_shop_id: order.buyer_shop_id,
      delivery_address: order.delivery_address,
      buyer_message: order.buyer_message,
      placed_at: order.placed_at,
      courier_name: order.courier_name,
      currency: order.currency,
      detail_complete: order.detail_complete,
      item_count: items.reduce((total, item) => total + Number(item.quantity ?? 0), 0),
      shipping_fee: shippingFee,
      payment_method: raw.payment_method ?? null,
      fulfillment_status: order.fulfillment_status,
      package_number: shipment?.package_number,
      metadata: {
        completed_scenario: order.completed_scenario,
        detail_received_at: order.detail_received_at,
        latest_provider_update_at: order.latest_provider_update_at,
        provider: order.provider,
      },
    };
  });

  const response = await fetch(inboxUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inboxServiceKey}`, apikey: inboxServiceKey },
    body: JSON.stringify({ orders: payloads }),
  });
  const text = await response.text();
  let result: unknown = text;
  try { result = JSON.parse(text); } catch { /* keep text */ }
  if (!response.ok) return json({ ok: false, status: response.status, inbox_result: result }, 502);
  return json({ ok: true, pulled: orders.length, inbox_result: result });
});