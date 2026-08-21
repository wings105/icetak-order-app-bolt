import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  EMPTY_ADJUSTMENTS,
  EMPTY_CUSTOMER,
  createComposerPayload,
  makeComposerItem,
  normalizeComposerItem,
} from '../icetak-admin/src/lib/orderComposer.ts';

let handler;
let permissions = ['create_order', 'verify_payments'];
const draftsByRequest = new Map();
const draftsById = new Map();
const queues = [];
const customers = [];
let nextId = 1;

const identifier = () => {
  const count = String(nextId++).padStart(12, '0');
  return `00000000-0000-4000-8000-${count}`;
};

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

function total(payload) {
  const subtotal = payload.items.reduce((sum, item) => sum + Number(item.seller_deal_price ?? item.price) * Number(item.qty || 1), 0);
  const adjustments = payload.price_adjustments || {};
  const addon = Number(adjustments.custom_addon || 0);
  const discount = adjustments.discount_type === 'percent'
    ? (subtotal + addon) * Math.min(100, Number(adjustments.discount_value || 0)) / 100
    : Math.min(subtotal + addon, Number(adjustments.discount_value || 0));
  return Math.round((subtotal + addon - discount + Number(payload.delivery_fee || 0) + Number(adjustments.rounding || 0)) * 100) / 100;
}

function findByToken(token) {
  return Array.from(draftsById.values()).find((draft) => draft.review_token === token);
}

function finish(draft, label) {
  draft.status = 'confirmed';
  draft.order_id = identifier();
  draft.order_no = `IC-${label}-${draft.id.slice(-3)}`;
  return { success: true, order_db_id: draft.order_id, order_id: draft.order_no, order_no: draft.order_no };
}

const fetchMock = async (input, options = {}) => {
  const url = new URL(String(input));
  const path = url.pathname;
  const body = options.body ? JSON.parse(String(options.body)) : null;

  if (path === '/auth/v1/user') return json({ id: '11111111-1111-4111-8111-111111111111' });
  if (path === '/rest/v1/admin_users') return json([{ username: 'admin1', role: 'admin' }]);
  if (path === '/rest/v1/admin_permissions') return json([{ permissions }]);

  if (path === '/rest/v1/rpc/icetak_ensure_whatsapp_customer_master') {
    customers.push(body);
    return json({ customer_master_id: identifier() });
  }
  if (path === '/rest/v1/rpc/icetak_create_generic_order_draft') {
    const previous = draftsByRequest.get(body.p_request_key);
    if (previous) return json({ ...previous, duplicate: true });
    const id = identifier();
    const draft = {
      id,
      review_token: `qrd_${id.replaceAll('-', '').padEnd(32, '0').slice(0, 32)}`,
      request_key: body.p_request_key,
      status: 'pending_admin',
      source_type: 'admin_manual',
      payment_mode: body.p_payment_mode,
      working_draft: body.p_payload,
      evidence: body.p_payload.evidence,
      draft_total: total(body.p_payload),
    };
    draftsByRequest.set(body.p_request_key, draft);
    draftsById.set(id, draft);
    return json({ ...draft, duplicate: false });
  }
  if (path === '/rest/v1/rpc/icetak_save_qrpay_order_draft') {
    const draft = findByToken(body.p_review_token);
    assert.ok(draft, 'saved draft exists');
    draft.working_draft = body.p_payload;
    draft.draft_total = total(body.p_payload);
    return json(draft);
  }
  if (path === '/rest/v1/rpc/icetak_admin_set_draft_flow') {
    const draft = findByToken(body.p_review_token);
    assert.ok(draft, 'draft exists before changing its payment flow');
    draft.payment_mode = body.p_payment_mode;
    draft.working_draft.delivery = body.p_delivery;
    return json(draft);
  }
  if (path === '/rest/v1/qrpay_order_drafts') {
    const draftId = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
    const draft = draftsById.get(draftId);
    if (options.method === 'PATCH') Object.assign(draft, body);
    return json(draft ? [draft] : []);
  }
  if (path === '/functions/v1/qrpay-draft-review') {
    const draft = findByToken(body.token);
    assert.ok(draft, 'review draft exists');
    if (body.action === 'approve_customer') {
      draft.status = 'ready_customer';
      return json({ ok: true, customer: { sent: true, link: 'https://shop.decocake.my/order-review.html?token=test' } });
    }
    if (body.action === 'confirm') return json({ ok: true, result: { success: true, payment_required: false, order: finish(draft, 'PICKUP') } });
  }
  if (path === '/rest/v1/rpc/icetak_admin_confirm_paid_draft') {
    const draft = findByToken(body.p_review_token);
    assert.ok(draft, 'paid draft exists');
    return json(finish(draft, 'PAID'));
  }
  if (path === '/rest/v1/rpc/icetak_admin_link_payment_to_draft_and_finalize') {
    const draft = draftsById.get(body.p_draft_id);
    assert.ok(draft, 'linked QR draft exists');
    return json({ ...finish(draft, 'QRPAY'), transaction_id: body.p_transaction_id });
  }
  if (path === '/rest/v1/orders') return json([{ id: String(url.searchParams.get('id') || '').replace(/^eq\./, ''), whatsapp_opt_in: true }]);
  if (path === '/rest/v1/rpc/icetak_enqueue_whatsapp_event') {
    queues.push(body);
    return json(identifier());
  }
  throw new Error(`Unmocked request: ${options.method || 'GET'} ${url}`);
};

const source = readFileSync('supabase/functions/admin-draft-control/index.ts', 'utf8').replace(/^import\s+"jsr:[^\n]+";\s*/m, '');
const executable = stripTypeScriptTypes(source, { mode: 'strip' });
const deno = {
  env: { get: (name) => name === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'unit-test-service-key' },
  serve: (callback) => { handler = callback; },
};
new Function('Deno', 'fetch', 'Request', 'Response', 'structuredClone', executable)(deno, fetchMock, Request, Response, structuredClone);
assert.equal(typeof handler, 'function', 'edge handler registered');

const makePayload = (mode = 'prepaid', phone = '0129554732') => {
  const catalog = normalizeComposerItem(makeComposerItem('acrylic'), { size: 'A6 Standard', qty: 2, sellerDealPrice: '18' });
  const custom = normalizeComposerItem(makeComposerItem('printed', true), { title: 'Custom logo sticker', sellerDealPrice: '12' });
  return createComposerPayload({
    customer: { ...EMPTY_CUSTOMER, name: 'Test Customer', phone, bsuid: phone ? '' : 'MY.2403797133469318', username: '@customer' },
    items: [catalog, custom],
    adjustments: { ...EMPTY_ADJUSTMENTS, customAddon: '5', discountType: 'percent', discountValue: '10' },
    delivery: mode === 'cash_counter' ? 'pickup' : 'jnt',
    paymentMode: mode,
    dateNeed: '2026-08-24',
    source: 'WhatsApp',
    note: 'Composer regression test',
    notifyWhatsapp: false,
  });
};

async function call(operation, requestId, payload, extras = {}, authorization = true) {
  const headers = { 'content-type': 'application/json' };
  if (authorization) headers.authorization = 'Bearer unit-test-admin-token';
  const request = new Request('https://example.supabase.co/functions/v1/admin-draft-control', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'compose_order', operation, request_id: requestId, payload, ...extras }),
  });
  const response = await handler(request);
  return { status: response.status, body: await response.json() };
}

const prepaidRequest = randomUUID();
const prepaid = makePayload();
const saved = await call('save_draft', prepaidRequest, prepaid);
assert.equal(saved.status, 200);
assert.equal(saved.body.success, true);
assert.equal(draftsById.size, 1);
const savedDraft = draftsById.get(saved.body.draft_id);
assert.equal(savedDraft.working_draft.items[0].catalog_price, 20);
assert.equal(savedDraft.working_draft.items[0].seller_deal_price, 18);
assert.equal(savedDraft.working_draft.items[1].title, 'Custom logo sticker');
assert.equal(savedDraft.order_id, undefined, 'saving does not create an order');

const sent = await call('send_customer', prepaidRequest, prepaid);
assert.equal(sent.body.success, true);
assert.equal(sent.body.customer_sent, true);
assert.equal(draftsById.size, 1, 'same request is idempotent across Save Draft and Send Review');
assert.equal(savedDraft.order_id, undefined, 'unpaid prepaid remains a draft');

const changedRequest = randomUUID();
const initiallyPrepaid = await call('save_draft', changedRequest, makePayload());
assert.equal(initiallyPrepaid.body.success, true);
const changedToPickup = await call('confirm_pickup', changedRequest, makePayload('cash_counter'));
assert.equal(changedToPickup.body.success, true, 'saved prepaid draft can change to cash-counter pickup');
assert.equal(draftsById.get(initiallyPrepaid.body.draft_id).payment_mode, 'cash_counter');

const pickup = await call('confirm_pickup', randomUUID(), makePayload('cash_counter', ''));
assert.equal(pickup.body.success, true);
assert.match(pickup.body.order_no, /^IC-PICKUP-/);
assert.equal(customers.length, 1, 'BSUID-only customer is synced to customer master');

const paid = await call('confirm_paid', randomUUID(), makePayload(), { payment_method: 'bank_transfer', payment_reference: 'TX123', notify_whatsapp: true });
assert.equal(paid.body.success, true);
assert.match(paid.body.order_no, /^IC-PAID-/);
assert.equal(paid.body.notification.queued, true);
assert.equal(queues.length, 1, 'customer notification is queued once when explicitly enabled');

const linked = await call('confirm_qrpay', randomUUID(), makePayload(), { transaction_id: 'QR-12345' });
assert.equal(linked.body.success, true);
assert.match(linked.body.order_no, /^IC-QRPAY-/);

const unauthorized = await call('save_draft', randomUUID(), makePayload(), {}, false);
assert.equal(unauthorized.status, 401, 'anonymous callers cannot compose orders');

permissions = ['create_order'];
const forbidden = await call('confirm_paid', randomUUID(), makePayload(), { payment_method: 'bank_transfer' });
assert.equal(forbidden.status, 403, 'paid confirmation requires verify_payments');

console.log('PASS: prepaid stays draft-only, Save → Send is idempotent, and pickup/paid/QRPay create one real order.');
console.log('PASS: custom names/deal pricing survive, BSUID-only customers sync, notification opt-in works, and auth/permissions are enforced.');
