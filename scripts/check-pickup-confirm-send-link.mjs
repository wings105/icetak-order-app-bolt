import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const drafts = new Map();
const orders = new Map();
const queues = new Map();
const events = [];
const dispatches = [];
let handler;
let nextOrder = 0;

const clone = (value) => value == null ? value : structuredClone(value);
const response = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

function records(table) {
  if (table === 'qrpay_order_drafts') return Array.from(drafts.values());
  if (table === 'orders') return Array.from(orders.values());
  if (table === 'notification_queue') return Array.from(queues.values());
  if (table === 'qrpay_order_draft_events') return events;
  if (table === 'whatsapp_settings') return [{ key: 'customer_app_base_url', text_value: 'https://shop.decocake.my' }];
  throw new Error(`Unexpected table: ${table}`);
}

function from(table) {
  const filters = [];
  let mutation;
  let values;
  const query = {
    select() { return this; },
    eq(key, value) { filters.push([key, value]); return this; },
    order() { return this; },
    limit() { return this; },
    update(value) { mutation = 'update'; values = value; return this; },
    insert(value) { mutation = 'insert'; values = value; return this; },
    async maybeSingle() {
      const matches = records(table).filter((row) => filters.every(([key, value]) => row[key] === value));
      return { data: clone(matches[0] || null), error: null };
    },
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        if (mutation === 'update') {
          for (const row of records(table)) {
            if (filters.every(([key, value]) => row[key] === value)) Object.assign(row, values);
          }
        } else if (mutation === 'insert') {
          assert.equal(table, 'qrpay_order_draft_events');
          events.push(clone(values));
        }
        return { data: null, error: null };
      }).then(resolve, reject);
    },
  };
  return query;
}

async function rpc(name, args) {
  if (name === 'icetak_admin_approve_draft_for_customer') {
    const draft = Array.from(drafts.values()).find((entry) => entry.review_token === args.p_review_token);
    assert.ok(draft, 'draft exists before approval');
    draft.working_draft = args.p_payload;
    draft.customer_review_token = `qrc_${draft.id.replaceAll('-', '').padEnd(32, '0').slice(0, 32)}`;
    draft.status = 'ready_customer';
    return { data: clone(draft), error: null };
  }
  if (name === 'icetak_record_generic_draft_learning') return { data: {}, error: null };
  if (name === 'icetak_customer_confirm_draft') {
    const draft = Array.from(drafts.values()).find((entry) => entry.customer_review_token === args.p_customer_token);
    assert.ok(draft, 'draft exists before pickup confirmation');
    nextOrder += 1;
    const orderId = `00000000-0000-4000-8000-${String(nextOrder).padStart(12, '0')}`;
    draft.status = 'confirmed';
    draft.customer_status = 'confirmed';
    draft.order_id = orderId;
    draft.order_no = `IC-PICKUP-${nextOrder}`;
    orders.set(orderId, {
      id: orderId,
      order_no: draft.order_no,
      public_token: `public-pickup-${nextOrder}`,
      total: 24,
      payment_status: 'cash_counter',
      payment: 'Cash at Counter',
      whatsapp_opt_in: false,
    });
    return { data: { order_id: draft.order_no, order_db_id: orderId }, error: null };
  }
  if (name === 'icetak_enqueue_whatsapp_event') {
    assert.equal(args.p_event_type, 'pickup_order_confirmed');
    assert.equal(args.p_suffix, 'draft_review');
    assert.equal(args.p_extra.payment_status, 'UNPAID');
    assert.equal(args.p_extra.delivery_method, 'Pickup');
    assert.match(args.p_extra.items_summary, /Acrylic Cake Topper/);
    assert.match(args.p_extra.items_summary, /RM24\.00/);
    const key = `${args.p_event_type}:${args.p_order_id}:draft_review`;
    const previous = Array.from(queues.values()).find((queue) => queue.idempotency_key === key);
    if (previous) return { data: null, error: null };
    const id = `queue-${queues.size + 1}`;
    queues.set(id, { id, idempotency_key: key, order_id: args.p_order_id, status: 'pending' });
    return { data: id, error: null };
  }
  throw new Error(`Unexpected RPC: ${name}`);
}

globalThis.createClient = () => ({ from, rpc });
globalThis.Deno = {
  env: { get: (key) => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' }[key]) },
  serve: (callback) => { handler = callback; },
};
globalThis.fetch = async (input, options = {}) => {
  assert.equal(String(input), 'https://example.supabase.co/functions/v1/whatsapp-dispatch');
  assert.equal(options.headers.authorization, 'Bearer service-role-test');
  const body = JSON.parse(options.body);
  const queue = queues.get(body.queue_id);
  assert.ok(queue, 'dispatch only claims the requested pickup notification');
  queue.status = 'sent';
  queue.provider_message_id = `wamid-${body.queue_id}`;
  dispatches.push(body);
  return response({ ok: true, processed: 1, results: [{ id: queue.id, status: 'sent', message_id: queue.provider_message_id }] });
};

const edgeSource = readFileSync(new URL('../supabase/functions/qrpay-draft-review/index.ts', import.meta.url), 'utf8');
const executable = stripTypeScriptTypes(edgeSource.replace(/^import .*;\n/gm, ''), { mode: 'strip' });
new Function(executable)();
assert.equal(typeof handler, 'function', 'edge handler registered');

function makeDraft(number, { bsuidOnly = false, prepaid = false } = {}) {
  const token = `qrd_${String(number).padStart(32, '0')}`;
  const id = `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
  const draft = {
    id,
    review_token: token,
    status: 'pending_admin',
    source_type: 'pickup_trigger',
    payment_mode: prepaid ? 'prepaid' : 'cash_counter',
    customer_name: 'Customer Test',
    customer_phone: bsuidOnly ? null : '60129554732',
    customer_status: 'not_sent',
    working_draft: {
      customer: { name: 'Customer Test', phone: bsuidOnly ? null : '60129554732' },
      whatsapp_identity: { phone: bsuidOnly ? null : '60129554732', bsuid: 'MY.2403797133469318' },
      delivery: 'pickup',
      date_need: '2026-08-25',
      items: [{ k: 'acrylic', title: 'Acrylic Cake Topper', size: 'A7 Mini', style: 'Gold', qty: 2, price: 12 }],
    },
    evidence: {},
  };
  drafts.set(id, draft);
  return draft;
}

async function action(draft, name, extra = {}) {
  const result = await handler(new Request('https://example.supabase.co/functions/v1/qrpay-draft-review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: draft.review_token, action: name, payload: draft.working_draft, ...extra }),
  }));
  return { status: result.status, body: await result.json() };
}

const original = makeDraft(1);
const originalResult = await action(original, 'confirm');
assert.equal(originalResult.status, 200);
assert.equal(originalResult.body.ok, true);
assert.equal(queues.size, 0, 'original Confirm Pickup Order stays silent');
assert.equal(orders.get(original.order_id).whatsapp_opt_in, false);

const enhanced = makeDraft(2);
const enhancedResult = await action(enhanced, 'confirm_send_customer');
assert.equal(enhancedResult.status, 200);
assert.equal(enhancedResult.body.customer.sent, true);
assert.equal(enhancedResult.body.customer.link, 'https://shop.decocake.my/?order=public-pickup-2');
assert.equal(enhancedResult.body.customer.payment_link, 'https://shop.decocake.my/?order=public-pickup-2&page=payment');
assert.equal(orders.get(enhanced.order_id).whatsapp_opt_in, true);
assert.ok(enhanced.customer_link_sent_at, 'pickup draft records customer link delivery');
assert.equal(enhanced.customer_status, 'confirmed', 'sending the link does not regress confirmed status');
assert.equal(events.filter((event) => event.event_type === 'pickup_order_link_sent').length, 1);

const optedOut = makeDraft(5);
const optedOutResult = await action(optedOut, 'confirm_send_customer', { whatsapp_opt_in: false });
assert.equal(optedOutResult.status, 200);
assert.equal(optedOutResult.body.customer.sent, false, 'unticked WhatsApp keeps confirmation silent');
assert.equal(optedOutResult.body.customer.skipped, true);
assert.equal(orders.get(optedOut.order_id).whatsapp_opt_in, false);

const duplicate = await action(enhanced, 'confirm_send_customer');
assert.equal(duplicate.body.duplicate, true);
assert.equal(duplicate.body.customer.duplicate, true);
assert.equal(dispatches.length, 1, 'retry does not send the same customer notification twice');

const bsuidOnly = makeDraft(3, { bsuidOnly: true });
const bsuidResult = await action(bsuidOnly, 'confirm_send_customer');
assert.equal(bsuidResult.body.customer.sent, true, 'BSUID-only customers remain supported');

const prepaid = makeDraft(4, { prepaid: true });
const prepaidResult = await action(prepaid, 'confirm_send_customer');
assert.equal(prepaidResult.status, 409, 'prepaid drafts keep their original approve/send flow');

const invalid = await handler(new Request('https://example.supabase.co/functions/v1/qrpay-draft-review', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: 'invalid', action: 'confirm_send_customer' }),
}));
assert.equal(invalid.status, 401, 'new action remains protected by the draft review token');

const html = readFileSync(new URL('../public/qrpay-draft.html', import.meta.url), 'utf8');
assert.match(html, /Confirm Pickup Order<\/button><button data-main id="confirmSend"/);
assert.match(html, /Confirm Pickup & Send Link/);
assert.match(html, /api\('confirm_send_customer'/);
assert.match(html, /reviewWhatsappOptIn/);
assert.match(html, /WhatsApp notification ON/);
assert.match(html, /action==='approve'/);
assert.match(edgeSource, /whatsapp_opt_in/);
assert.match(edgeSource, /notify_whatsapp:b\.whatsapp_opt_in!==false/);
assert.match(edgeSource, /c\.error\)throw c\.error;d=await load\(token\);if\(!d\.order_id\)/, 'cash-counter confirm reloads the draft before using its order ID');

const portal = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
assert.match(portal, /params\.get\('page'\)==='payment'/);
assert.match(portal, /await loadPayment\(orderToken\)/);

const control = readFileSync(new URL('../icetak-admin/src/pages/WhatsAppControl.tsx', import.meta.url), 'utf8');
assert.match(control, /items_summary/);
assert.match(control, /payment_status/);
assert.match(control, /delivery_method/);

const rule = readFileSync(new URL('../supabase/functions/qrpay-draft-review/pickup-notification-rule.sql', import.meta.url), 'utf8');
assert.match(rule, /pickup_order_confirmed/);
assert.match(rule, /\{items_summary\}/);
assert.match(rule, /\{payment_link\}/);
assert.match(rule, /on conflict \(event_type\) do nothing/);

console.log('Pickup confirmation + customer payment link regression checks passed.');
