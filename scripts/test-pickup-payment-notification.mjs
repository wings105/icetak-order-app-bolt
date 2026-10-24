import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { buildPickupPaymentMessage, isPickupOrder, pickupPaymentStage } from '../supabase/functions/whatsapp-send/pickup-payment-message.ts';

const source = stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/whatsapp-send/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''));
const baseOrder = { id: 'order-1', order_no: 'IC-1', delivery_method: 'pickup', whatsapp_opt_in: true, payment_status: 'paid', pickup_ready_at: '2026-10-24T01:00:00Z', status: 'Ready for Pickup' };
const vars = { customer_name: 'Test Customer', order_id: 'IC-1', order_total: 'RM12.00', order_link: 'https://shop.decocake.my/?order=test' };
const oldRule = { enabled: true, freeform_enabled: true, template_enabled: true, freeform_text: 'Hi {customer_name}, bayaran diterima. Kami akan proses order anda.', template_name: 'order_paid_notice', template_language: 'ms', template_params: ['customer_name', 'order_id', 'order_total'] };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
let assertions = 0;

function setup(options = {}) {
  const order = { ...baseOrder, ...options.order };
  const state = { handler: null, providerCalls: [], writes: [], reads: [], mirrors: 0, orderReads: 0 };
  const templates = options.templates || [{ name: 'pickup_payment_received_ms', language: 'ms', status: 'APPROVED' }];
  const ctx = vm.createContext({
    Deno: { env: { get: (key) => key === 'SUPABASE_URL' ? 'https://mock.supabase.co' : 'service-role-test' }, serve: (handler) => { state.handler = handler; } },
    buildPickupPaymentMessage, isPickupOrder,
    mirrorWhatsApp: async () => { state.mirrors++; },
    Response, Request, AbortController, setTimeout, clearTimeout, console,
    fetch: async (url, init = {}) => {
      const parsed = new URL(url), path = parsed.pathname.replace('/rest/v1/', '');
      if (url === 'https://window.test') return response({ ok: true, can_send_freeform: options.windowOpen !== false });
      if (parsed.origin === 'https://provider.test') {
        if (parsed.pathname.endsWith('/templates')) return response({ success: true, templates: options.upstreamTemplates || templates });
        state.providerCalls.push({ endpoint: parsed.pathname, body: JSON.parse(init.body) });
        return response({ success: true, message_id: 'provider-test-1' });
      }
      if (parsed.origin !== 'https://mock.supabase.co') throw new Error(`Unexpected network request: ${url}`);
      state.reads.push(path);
      if (path === 'whatsapp_settings') {
        const key = parsed.searchParams.get('key')?.slice(3);
        return response([{ text_value: { enabled: 'true', unified_inbox_24h_url: 'https://window.test', base_url: 'https://provider.test', wasapflow_official_base_url: 'https://provider.test', partner_key: 'test-key', waba_id: 'test-waba' }[key] || '' }]);
      }
      if (path === 'orders') {
        state.orderReads++;
        if (state.orderReads > 1 && options.finalOrder) Object.assign(order, options.finalOrder);
        return response([order]);
      }
      if (path === 'whatsapp_notification_rules') return response([oldRule]);
      if (path === 'pickup_checkouts') return response(options.checkoutMissing ? [] : [{ id: 'checkout-1', status: options.checkoutStatus || 'paid' }]);
      if (path === 'pickup_checkout_orders') {
        if (options.bundleError) return response({ message: 'Database unavailable' }, 503);
        const bundle = options.bundle || [{ amount: 12, orders: order }];
        return response(bundle);
      }
      if (path === 'whatsapp_templates') {
        if (init.method === 'POST') {
          assert.equal(parsed.searchParams.get('on_conflict'), 'waba_id,name,language');
          assert.equal(JSON.parse(init.body).waba_id, 'test-waba');
          state.writes.push({ table: path, body: JSON.parse(init.body) }); return response([JSON.parse(init.body)]);
        }
        const name = parsed.searchParams.get('name')?.slice(3);
        return response(templates.filter((t) => t.name === name && t.status === 'APPROVED'));
      }
      if (path === 'whatsapp_outbox') {
        if (!init.method || init.method === 'GET') return response(options.duplicate ? [{ id: 'outbox-1', status: 'sent', mode: 'text', provider_message_id: 'already-sent' }] : []);
        const body = JSON.parse(init.body);
        state.writes.push({ table: path, body });
        return response([{ id: 'outbox-1', ...body }]);
      }
      throw new Error(`Unexpected REST request: ${url}`);
    },
  });
  vm.runInContext(source, ctx);
  state.invoke = async (body = {}) => {
    const result = await state.handler(new Request('https://mock.supabase.co/functions/v1/whatsapp-send', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer service-role-test' }, body: JSON.stringify({ phone: '60123456789', event_type: 'payment_received', order_db_id: order.id, vars, dry_run: true, ...body }) }));
    return { status: result.status, ...(await result.json()) };
  };
  return state;
}

for (const [order, stage] of [
  [baseOrder, 'ready'],
  [{ ...baseOrder, pickup_collected_at: '2026-10-24T02:00:00Z' }, 'collected'],
  [{ delivery_method: 'pickup', fulfillment_stage: 'ready_for_pickup' }, 'ready'],
  [{ delivery_method: 'pickup', admin_status: 'Customer Collected', pickup_ready_at: 'today' }, 'collected'],
  [{ delivery_method: 'pickup', fulfillment_stage: 'completed' }, 'collected'],
  [{ delivery_method: 'pickup', status: 'Processing' }, 'pending'],
]) {
  assert.equal(pickupPaymentStage(order), stage);
  assert.doesNotMatch(buildPickupPaymentMessage([order], vars).text, /akan proses order|akan diproses/);
  assertions++;
}

{
  const x = setup(), result = await x.invoke({ text: 'Kami akan proses order anda.' });
  assert.equal(result.ok, true); assert.match(result.message_preview, /sudah siap dan boleh diambil/);
  assert.match(result.message_preview, /Jumlah bayaran: RM12.00/); assert.doesNotMatch(result.message_preview, /akan proses/);
  assert.equal(x.providerCalls.length, 0); assert.equal(x.writes.length, 0); assertions++;
}
{
  const result = await setup({ order: { pickup_collected_at: '2026-10-24T02:00:00Z' } }).invoke();
  assert.match(result.message_preview, /telah diambil/); assert.doesNotMatch(result.message_preview, /boleh diambil|akan proses|Lokasi:/); assertions++;
}
{
  const result = await setup({ order: { pickup_ready_at: null, status: 'Processing' } }).invoke();
  assert.match(result.message_preview, /akan maklumkan apabila order siap/); assert.doesNotMatch(result.message_preview, /boleh diambil/); assertions++;
}

const bundleOrders = Array.from({ length: 24 }, (_, i) => ({ amount: 10, orders: { ...baseOrder, id: `order-${i + 1}`, order_no: `IC-${i + 1}`, pickup_collected_at: '2026-10-24T02:00:00Z' } }));
const bulkVars = { ...vars, pickup_checkout_no: 'PU261024-TEST', order_id: bundleOrders.map((r) => r.orders.order_no).join(', '), order_total: 'RM240.00' };
{
  const result = await setup({ bundle: bundleOrders }).invoke({ vars: bulkVars });
  assert.match(result.message_preview, /Semua order ini telah diambil/); assert.match(result.message_preview, /IC-24/);
  assert.match(result.message_preview, /RM240.00/); assert.doesNotMatch(result.message_preview, /boleh diambil|akan proses/); assertions++;
}
{
  const bundle = [{ amount: 12, orders: baseOrder }, { amount: 10, orders: { ...baseOrder, id: 'order-2', order_no: 'IC-2', pickup_collected_at: 'today' } }, { amount: 6, orders: { ...baseOrder, id: 'order-3', order_no: 'IC-3', pickup_ready_at: null, status: 'Processing' } }];
  const result = await setup({ bundle }).invoke({ vars: { ...vars, pickup_checkout_no: 'PU-TEST', order_id: 'IC-1, IC-2, IC-3' } });
  assert.match(result.message_preview, /Sudah diambil: 1 order/); assert.match(result.message_preview, /Siap untuk pickup: 1 order/); assert.match(result.message_preview, /Belum siap untuk pickup: 1 order/); assert.match(result.message_preview, /RM28.00/); assertions++;
}
{
  const bundle = [{ amount: 12, orders: baseOrder }, { amount: 10, orders: { ...baseOrder, id: 'order-2', order_no: 'IC-2', pickup_payment_whatsapp_enabled: false } }];
  const result = await setup({ bundle }).invoke({ vars: { ...vars, pickup_checkout_no: 'PU-TEST', order_id: 'IC-1, IC-2' } });
  assert.doesNotMatch(result.message_preview, /IC-2/); assert.match(result.message_preview, /RM12.00/); assertions++;
}
{
  const result = await setup({ bundle: bundleOrders }).invoke({ vars: { ...bulkVars, pickup_checkout_no: '' }, idempotency_key: 'payment_received:order-1:pickup_bundle:00000000-0000-0000-0000-000000000001' });
  assert.match(result.message_preview, /Semua order ini telah diambil/); assertions++;
}
for (const options of [{ bundleError: true }, { checkoutMissing: true }, { checkoutStatus: 'voided' }]) {
  const x = setup(options), result = await x.invoke({ vars: { ...vars, pickup_checkout_no: 'PU-TEST' } });
  assert.equal(result.ok, false); assert.equal(x.providerCalls.length, 0); assert.equal(x.writes.length, 0); assertions++;
}
{
  const result = await setup({ windowOpen: false }).invoke({ template_name: 'order_paid_notice' });
  assert.equal(result.ok, true); assert.equal(result.template_preview.name, 'pickup_payment_received_ms');
  assert.equal(result.template_preview.components[0].parameters.length, 5);
  assert.match(result.template_preview.components[0].parameters[3].text, /sudah siap/); assertions++;
}
{
  const result = await setup({ windowOpen: false, bundle: bundleOrders }).invoke({ vars: bulkVars });
  assert.match(result.template_preview.components[0].parameters[3].text, /Semua order ini telah diambil/); assertions++;
}
{
  const x = setup({ windowOpen: false, templates: [], upstreamTemplates: [{ name: 'pickup_payment_received_ms', language: 'ms', status: 'APPROVED', components: [] }] }), result = await x.invoke();
  assert.equal(result.ok, true); assert.equal(x.writes[0].table, 'whatsapp_templates'); assert.equal(x.providerCalls.length, 0); assertions++;
}
{
  const x = setup({ windowOpen: false, templates: [], upstreamTemplates: [{ name: 'pickup_payment_received_ms', language: 'ms', status: 'PENDING' }] }), result = await x.invoke();
  assert.equal(result.ok, false); assert.equal(result.error, 'pickup_payment_template_pending'); assert.equal(x.providerCalls.length, 0); assertions++;
}
{
  const result = await setup({ order: { delivery_method: 'shipping' } }).invoke();
  assert.match(result.message_preview, /Kami akan proses order anda/); assertions++;
}
for (const order of [{ whatsapp_opt_in: false }, { status: 'Cancelled' }]) {
  const x = setup({ order }), result = await x.invoke();
  assert.equal(result.ok, false); assert.equal(x.providerCalls.length, 0); assertions++;
}
{
  const x = setup({ finalOrder: { pickup_collected_at: '2026-10-24T02:00:00Z' } }), result = await x.invoke({ dry_run: false });
  assert.equal(result.ok, true); assert.match(x.providerCalls[0].body.text, /telah diambil/);
  assert.equal(x.providerCalls.length, 1); assert.equal(x.mirrors, 1); assertions++;
}
{
  const x = setup({ duplicate: true }), result = await x.invoke({ dry_run: false, idempotency_key: 'duplicate-test' });
  assert.equal(result.duplicate, true); assert.equal(x.providerCalls.length, 0); assertions++;
}

// Execute the real dispatcher to verify a pending external approval does not
// exhaust delivery retries, while ordinary provider failures still do.
const dispatcherSource = stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/whatsapp-dispatch/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''));
for (const [error, expectedStatus] of [['pickup_payment_template_pending', 'pending'], ['provider unavailable', 'failed'], ['order_auto_opted_out', 'cancelled']]) {
  let handler;
  const writes = [];
  const context = vm.createContext({
    Deno: { env: { get: (key) => key === 'SUPABASE_URL' ? 'https://mock.supabase.co' : 'service-role-test' }, serve: (fn) => { handler = fn; } },
    flushWhatsAppInbox: async () => ({ processed: 0, synced: 0 }),
    Response, Request, console,
    fetch: async (url, init = {}) => {
      if (url.endsWith('/functions/v1/whatsapp-send')) return response({ ok: false, error }, 409);
      if (url.includes('icetak_claim_notification_jobs')) return response([{ id: 'queue-1', order_id: 'order-1', attempts: 5, payload: { event_type: 'payment_received' } }]);
      if (url.includes('notification_queue?id=eq.')) { writes.push(JSON.parse(init.body)); return response([]); }
      if (url.includes('icetak_requeue_stale_notification_jobs')) return response([]);
      throw new Error(`Unexpected dispatcher request: ${url}`);
    },
  });
  vm.runInContext(dispatcherSource, context);
  const result = await handler(new Request('https://mock.supabase.co/functions/v1/whatsapp-dispatch', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer service-role-test' }, body: '{}' }));
  assert.equal((await result.json()).ok, true);
  assert.equal(writes[0].status, expectedStatus);
  if (expectedStatus === 'pending') {
    assert.equal(writes[0].attempts, 4);
    assert.equal(writes[0].locked_at, null);
    assert.ok(Date.parse(writes[0].scheduled_at) > Date.now() + 14 * 60000);
  }
  assertions++;
}

console.log(`PASS: ${assertions} pickup payment regression scenarios (single, 24-order bulk, mixed status, QRPay/cash message routing, template refresh, dispatch-time handover, opt-out, cancellation and duplicate guards). No live services called.`);
