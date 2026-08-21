import assert from 'node:assert/strict';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const TEST_TOKEN = 'icetak_gpt_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF';
const TOKEN_HASH = createHash('sha256').update(TEST_TOKEN).digest('hex');
const draftsByRequest = new Map();
const draftsById = new Map();
let registeredHandler;
let nextId = 1;

function identifier() {
  return `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function draftTotal(payload) {
  const subtotal = payload.items.reduce((sum, item) => sum + Number(item.seller_deal_price ?? item.price) * Number(item.qty), 0);
  const adjustment = payload.price_adjustments || {};
  const addon = Number(adjustment.custom_addon || 0);
  const discount = adjustment.discount_type === 'percent'
    ? (subtotal + addon) * Number(adjustment.discount_value || 0) / 100
    : Number(adjustment.discount_value || 0);
  return Math.round((subtotal + addon - discount + Number(payload.delivery_fee || 0) + Number(adjustment.rounding || 0)) * 100) / 100;
}

function byToken(token) {
  return Array.from(draftsById.values()).find((entry) => entry.review_token === token);
}

function finalize(draft, label) {
  draft.status = 'confirmed';
  draft.order_id = identifier();
  draft.order_no = `IC-${label}-${draft.id.slice(-3)}`;
  return { success: true, order_db_id: draft.order_id, order_no: draft.order_no, order_id: draft.order_no };
}

async function fetchMock(input, options = {}) {
  const url = new URL(String(input));
  const path = url.pathname;
  const body = options.body ? JSON.parse(String(options.body)) : null;

  if (path === '/rest/v1/private_runtime_settings') return json([{ setting_value: TOKEN_HASH }]);
  if (path === '/rest/v1/product_order_profiles') return json([{ code: 'acrylic-v1', name: 'Acrylic', product_type: 'acrylic' }]);
  if (path === '/rest/v1/rpc/icetak_quick_order_price') {
    const prices = { edible: 6, burnaway: 12, wafer: 6, printed: 10, mirror: 15, acrylic: 12 };
    return json(prices[body.p_kind] || 0);
  }
  if (path === '/rest/v1/rpc/icetak_apply_draft_price_overrides_v15') return json(body.p_payload);
  if (path === '/rest/v1/rpc/icetak_qrpay_draft_totals') return json({ total: draftTotal(body.p_payload) });
  if (path === '/rest/v1/customer_identifiers_master') {
    if (url.searchParams.has('customer_master_id')) {
      return json([{ identifier_type: 'phone', identifier_value: '60129554732', scope: 'global', is_verified: true }]);
    }
    const value = String(url.searchParams.get('normalized_value') || '');
    return json(value === 'eq.60129554732' || value === 'eq.MY.2403797133469318'
      ? [{ customer_master_id: '11111111-1111-4111-8111-111111111111', identifier_type: 'phone' }]
      : []);
  }
  if (path === '/rest/v1/customer_master') {
    return json([{ id: '11111111-1111-4111-8111-111111111111', display_name: 'Customer Test', primary_phone_normalized: '60129554732', status: 'active' }]);
  }
  if (path === '/rest/v1/customer_addresses') return json([]);
  if (path === '/rest/v1/whatsapp_contacts') return json([]);
  if (path === '/rest/v1/unmatched_payment_transactions') {
    return json(url.searchParams.get('transaction_id') === 'eq.QR-12345'
      ? [{ transaction_id: 'QR-12345', amount: 12, provider: 'duitnow' }]
      : []);
  }
  if (path === '/rest/v1/payment_transactions') return json([]);
  if (path === '/rest/v1/rpc/icetak_ensure_whatsapp_customer_master') {
    return json({ customer_master_id: '11111111-1111-4111-8111-111111111111' });
  }
  if (path === '/rest/v1/rpc/icetak_create_generic_order_draft') {
    const previous = draftsByRequest.get(body.p_request_key);
    if (previous) return json({ ...previous, duplicate: true });
    const id = identifier();
    const draft = {
      id,
      review_token: `qrd_${id.replaceAll('-', '').padEnd(32, '0').slice(0, 32)}`,
      payment_mode: body.p_payment_mode,
      status: 'pending_admin',
      working_draft: body.p_payload,
      draft_total: draftTotal(body.p_payload),
    };
    draftsByRequest.set(body.p_request_key, draft);
    draftsById.set(id, draft);
    return json(draft);
  }
  if (path === '/rest/v1/rpc/icetak_save_qrpay_order_draft') {
    const draft = byToken(body.p_review_token);
    assert.ok(draft, 'draft exists before saving');
    draft.working_draft = body.p_payload;
    draft.draft_total = draftTotal(body.p_payload);
    return json(draft);
  }
  if (path === '/rest/v1/rpc/icetak_admin_set_draft_flow') {
    const draft = byToken(body.p_review_token);
    assert.ok(draft, 'draft exists before changing payment mode');
    draft.payment_mode = body.p_payment_mode;
    return json(draft);
  }
  if (path === '/rest/v1/qrpay_order_drafts') {
    const id = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
    return json(draftsById.has(id) ? [draftsById.get(id)] : []);
  }
  if (path === '/functions/v1/qrpay-draft-review') {
    const draft = byToken(body.token);
    assert.ok(draft, 'draft exists before reviewer action');
    if (body.action === 'approve_customer') return json({ ok: true, customer: { sent: true, link: 'https://shop.decocake.my/order-review.html?token=test' } });
    if (body.action === 'confirm') return json({ ok: true, result: { order: finalize(draft, 'PICKUP') } });
  }
  if (path === '/rest/v1/rpc/icetak_admin_confirm_paid_draft') return json(finalize(byToken(body.p_review_token), 'PAID'));
  if (path === '/rest/v1/rpc/icetak_admin_link_payment_to_draft_and_finalize') return json(finalize(draftsById.get(body.p_draft_id), 'QRPAY'));
  throw new Error(`Unmocked request: ${options.method || 'GET'} ${url}`);
}

const source = readFileSync('supabase/functions/gpt-order-actions/index.ts', 'utf8').replace(/^import\s+"jsr:[^\n]+";\s*/m, '');
const executable = stripTypeScriptTypes(source, { mode: 'strip' });
const deno = {
  env: { get: (name) => name === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'unit-test-service-key' },
  serve: (handler) => { registeredHandler = handler; },
};
new Function('Deno', 'fetch', 'Request', 'Response', 'crypto', executable)(deno, fetchMock, Request, Response, webcrypto);
assert.equal(typeof registeredHandler, 'function');

async function call(path, body = undefined, token = TEST_TOKEN) {
  const headers = {};
  if (token) headers['x-icetak-gpt-token'] = token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const request = new Request(`https://example.supabase.co/functions/v1/gpt-order-actions/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await registeredHandler(request);
  return { status: response.status, body: await response.json() };
}

function order(flow = 'prepaid') {
  return {
    customer: { name: 'Customer Test', phone: '0129554732', username: '@customer' },
    items: [{ product: 'acrylic', size: 'A7', quantity: 2, seller_deal_price: 11 }],
    delivery: flow === 'cash_counter' ? 'pickup' : 'jnt',
    payment_flow: flow,
    date_need: '2026-08-24',
    price_adjustments: { custom_addon: 2, discount_type: 'amount', discount_value: 1 },
  };
}

assert.equal((await call('catalog', undefined, '')).status, 401, 'anonymous callers are denied');
assert.equal((await call('catalog', undefined, `${TEST_TOKEN}wrong`)).status, 401, 'wrong tokens are denied');

const catalog = await call('catalog');
assert.equal(catalog.status, 200);
assert.equal(catalog.body.products.length, 6, 'all six live product categories are listed');
assert.equal(catalog.body.products.find((item) => item.product === 'acrylic').variations[0].catalog_price, 12);

const specific = await call('catalog?product=acrylic&size=A7');
assert.equal(specific.body.products[0].variations[0].size, 'A7 Mini');

const knownCustomer = await call('customers?identifier=0129554732');
assert.equal(knownCustomer.body.found, true, 'exact phone resolves a customer');
const missingCustomer = await call('customers?identifier=unknown_username');
assert.equal(missingCustomer.body.found, false, 'unknown identity never lists other customers');

const payment = await call('payments?transaction_id=QR-12345');
assert.equal(payment.body.available, true);

const firstPreview = await call('preview', order());
assert.equal(firstPreview.status, 200);
assert.equal(firstPreview.body.ready_to_create, true);
assert.equal(firstPreview.body.totals.total, 28.9, 'seller deal, add-on, discount and J&T are included');
assert.equal(draftsById.size, 0, 'preview has no side effects');

const unconfirmed = await call('orders', { ...order(), operation: 'save_draft', request_id: firstPreview.body.request_id, confirmed: false });
assert.equal(unconfirmed.status, 409, 'admin confirmation is mandatory');
assert.equal(draftsById.size, 0, 'unconfirmed requests cannot create a draft');

const saved = await call('orders', { ...order(), operation: 'save_draft', request_id: firstPreview.body.request_id, confirmed: true });
assert.equal(saved.body.state, 'draft_created');
assert.equal(draftsById.size, 1);
assert.equal(draftsById.get(saved.body.draft_id).order_id, undefined);

const sent = await call('orders', { ...order(), operation: 'send_customer', request_id: firstPreview.body.request_id, confirmed: true });
assert.equal(sent.body.state, 'review_sent');
assert.equal(draftsById.size, 1, 'same UUID prevents duplicate drafts');

const pickupBody = { ...order('cash_counter'), customer: { name: 'Hidden Phone Customer', bsuid: 'MY.2403797133469318' } };
const pickupRequest = randomUUID();
const pickup = await call('orders', { ...pickupBody, operation: 'confirm_pickup', request_id: pickupRequest, confirmed: true });
assert.equal(pickup.body.state, 'order_created');
assert.match(pickup.body.order_no, /^IC-PICKUP-/);
const pickupRetry = await call('orders', { ...pickupBody, operation: 'confirm_pickup', request_id: pickupRequest, confirmed: true });
assert.equal(pickupRetry.body.duplicate, true);

const beforeBadPaid = draftsById.size;
const invalidPaid = await call('orders', { ...order('paid'), operation: 'confirm_paid', request_id: randomUUID(), confirmed: true });
assert.equal(invalidPaid.status, 400);
assert.equal(draftsById.size, beforeBadPaid, 'invalid payment cannot leave an accidental draft');
const paid = await call('orders', { ...order('paid'), operation: 'confirm_paid', request_id: randomUUID(), confirmed: true, payment_method: 'bank_transfer' });
assert.match(paid.body.order_no, /^IC-PAID-/);

const linked = await call('orders', { ...order('qrpay'), operation: 'confirm_qrpay', request_id: randomUUID(), confirmed: true, transaction_id: 'QR-12345' });
assert.match(linked.body.order_no, /^IC-QRPAY-/);

const custom = await call('preview', {
  ...order(),
  items: [{ is_custom_item: true, title: 'Custom logo sticker', unit_price: 27 }],
});
assert.equal(custom.body.payload.items[0].title, 'Custom logo sticker');
assert.equal(custom.body.payload.items[0].price, 27);

const schema = JSON.parse(readFileSync('public/gpt-actions-openapi.json', 'utf8'));
assert.equal(schema.openapi, '3.1.0');
assert.equal(schema.components.securitySchemes.IcetakGptToken.name, 'x-icetak-gpt-token');
assert.equal(Object.keys(schema.paths).length, 5);
assert.equal(schema.paths['/functions/v1/gpt-order-actions/orders'].post['x-openai-isConsequential'], true);
for (const route of ['/functions/v1/gpt-order-actions/preview', '/functions/v1/gpt-order-actions/orders']) {
  const reference = schema.paths[route].post.requestBody.content['application/json'].schema.$ref;
  const component = schema.components.schemas[reference.split('/').at(-1)];
  assert.equal(component.type, 'object', `${route} requestBody must directly resolve to an object for GPT Actions`);
  assert.equal(component.allOf, undefined, `${route} requestBody cannot depend on root-level allOf composition`);
}
assert.equal(JSON.stringify(schema).includes(TEST_TOKEN), false, 'API tokens never appear in public schema');

console.log(`PASS GPT Actions: token security, ${catalog.body.products.length} products, identity lookup, preview, prepaid, pickup, paid, QRPay, custom items and OpenAPI schema`);
