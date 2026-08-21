import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import {
  applyLearningRules,
  buildLearningPrompt,
  filterOrderEvidenceMessages,
} from '../supabase/functions/unified-inbox/_shared/ai-learning-engine.ts';

const conversationId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const activeSessionId = '33333333-3333-4333-8333-333333333333';
const workerToken = 'test-internal-worker-token';
const closedBoundary = '2026-08-22T09:00:00.000Z';
const paymentTime = '2026-08-22T10:00:00.000Z';

const snippets = [
  {
    id: 'snippet-price',
    shortcut: 'acrylic',
    title: 'Acrylic prices',
    active: true,
    message: 'HARGA ACRYLIC CAKE TOPPER\nA7 Mini RM12\nA6 Standard RM20\nA5 Large RM35',
  },
  {
    id: 'snippet-courier',
    shortcut: 'pos',
    title: 'Courier options',
    active: true,
    message: 'SPX RM4.50\nJ&T RM5.90\nNinja Van RM6.90\nPrefer courier apa?',
  },
];

function message(id, direction, text, at, extra = {}) {
  return {
    id,
    conversation_id: conversationId,
    channel: 'whatsapp',
    direction,
    sender_type: direction === 'inbound' ? 'customer' : 'seller',
    message_type: 'text',
    text_content: text,
    caption: '',
    sent_at: at,
    created_at: at,
    sender_phone: direction === 'inbound' ? '60129554732' : null,
    provider_message_id: `provider-${id}`,
    media_metadata: {},
    raw_payload: {},
    ...extra,
  };
}

const oldMessage = message('old-confirmed-order', 'inbound', 'Acrylic A6 3pcs wording: ORDER LAMA', '2026-08-22T08:40:00.000Z');
const boundaryMessage = message('exact-closed-boundary', 'outbound', 'Acrylic A6 RM20 ORDER LAMA', closedBoundary);
const catalogMessage = message('seller-price-catalog', 'outbound', snippets[0].message, '2026-08-22T09:05:00.000Z');
const courierMessage = message('seller-courier-menu', 'outbound', snippets[1].message, '2026-08-22T09:06:00.000Z');
const customerOrder = message('new-customer-order', 'inbound', 'Nak edible A5 1pc\nwording: Ain & Zaim\npickup', '2026-08-22T09:35:00.000Z');
const sellerQuote = message('new-seller-quote', 'outbound', 'Edible A5 RM12 khas untuk order ini', '2026-08-22T09:48:00.000Z');
const customerPaid = message('new-customer-paid', 'inbound', 'Dah bayar', '2026-08-22T09:58:00.000Z');

const rules = [
  'preserve_distinct_products',
  'variation_from_nearest_item_context',
  'price_from_quick_order_variation',
  'price_from_latest_explicit_seller_quote',
  'qty_from_nearest_explicit_item_count',
  'shipping_from_quick_order_delivery',
  'wording_from_explicit_label',
].map((strategy_key, index) => ({
  id: `rule-${index}`,
  strategy_key,
  title: strategy_key,
  lesson: strategy_key,
  status: 'active',
  occurrence_count: 5,
}));

const state = {
  messages: [oldMessage, boundaryMessage, catalogMessage, courierMessage, customerOrder, sellerQuote, customerPaid],
  snippets,
  jobs: [],
  bridgeCalls: [],
  updates: [],
};

const settings = {
  qrpay_ai_worker_token: workerToken,
  qrpay_ai_order_bridge_url: 'https://order.example/functions/v1/qrpay-ai-order-bridge',
  openai_api_key: '',
};

function tableRows(table) {
  if (table === 'private_runtime_settings') {
    return Object.entries(settings).map(([setting_key, setting_value]) => ({ setting_key, setting_value }));
  }
  if (table === 'conversations') {
    return [{
      id: conversationId,
      customer_id: customerId,
      channel: 'whatsapp',
      last_message_at: customerPaid.created_at,
      customers: { display_name: 'Customer sebenar', order_system_master_customer_id: null },
    }];
  }
  if (table === 'customer_identities') {
    return [{
      customer_id: customerId,
      channel: 'whatsapp',
      normalized_phone: '60129554732',
      external_id: 'MY.2403797133469318',
      username: 'customer-sebenar',
    }];
  }
  if (table === 'customers') return [{ id: customerId, display_name: 'Customer sebenar' }];
  if (table === 'messages') return state.messages;
  if (table === 'quick_snippets') return state.snippets;
  throw new Error(`Unmocked database table: ${table}`);
}

class MockQuery {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.sort = null;
    this.rowLimit = null;
    this.patch = null;
  }

  select() { return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  gt(column, value) { this.filters.push((row) => row[column] !== null && Date.parse(row[column]) > Date.parse(value)); return this; }
  gte(column, value) { this.filters.push((row) => row[column] !== null && Date.parse(row[column]) >= Date.parse(value)); return this; }
  lte(column, value) { this.filters.push((row) => row[column] !== null && Date.parse(row[column]) <= Date.parse(value)); return this; }
  is(column, value) { this.filters.push((row) => row[column] === value); return this; }
  order(column, options = {}) { this.sort = { column, ascending: options.ascending !== false }; return this; }
  limit(value) { this.rowLimit = Number(value); return this; }
  update(value) { this.patch = value; return this; }

  result(single = false) {
    let rows = [...tableRows(this.table)].filter((row) => this.filters.every((predicate) => predicate(row)));
    if (this.sort) rows.sort((left, right) => String(left[this.sort.column]).localeCompare(String(right[this.sort.column])) * (this.sort.ascending ? 1 : -1));
    if (this.rowLimit !== null) rows = rows.slice(0, this.rowLimit);
    if (this.patch) for (const row of rows) Object.assign(row, this.patch);
    return { data: single ? rows[0] || null : rows, error: null };
  }

  async maybeSingle() { return this.result(true); }
  async single() { return this.result(true); }
  then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); }
}

const database = { from: (table) => new MockQuery(table) };
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

async function bridgeFetch(input, options = {}) {
  const url = new URL(String(input));
  if (!url.pathname.endsWith('/qrpay-ai-order-bridge')) throw new Error(`Unexpected outbound request: ${url}`);
  const body = JSON.parse(String(options.body || '{}'));
  state.bridgeCalls.push(body);

  if (body.action === 'order_session_context') {
    return json({
      ok: true,
      opened_at: closedBoundary,
      boundary_at: closedBoundary,
      session_id: activeSessionId,
      session_status: 'draft_created',
    });
  }
  if (body.action === 'learning_context') return json({ ok: true, rules });
  if (body.action === 'claim') return json({ ok: true, jobs: state.jobs });
  if (body.action === 'update_job') {
    state.updates.push(body);
    return json({ ok: true, job: { id: body.job_id, ...body.patch } });
  }
  if (body.action === 'create_generic_draft') return json({ ok: true, result: { id: 'draft-id', order_session_id: activeSessionId } });
  if (body.action === 'create_draft') return json({ ok: true, result: { draft_id: 'draft-id', order_session_id: activeSessionId } });
  throw new Error(`Unexpected bridge action: ${body.action}`);
}

function loadHandler(path) {
  let handler;
  const source = readFileSync(path, 'utf8')
    .replace(/^import\s+['"]jsr:[^\n]+\n/gm, '')
    .replace(/^import\s+\{\s*createClient\s*\}\s+from\s+['"]https:[^\n]+\n/gm, '')
    .replace(/^import\s+\{[^\n]+\}\s+from\s+['"]\.\.\/_shared\/ai-learning-engine\.ts['"];?\s*$/gm, '');
  const executable = stripTypeScriptTypes(source, { mode: 'strip' });
  const deno = {
    env: {
      get: (name) => name === 'SUPABASE_URL'
        ? 'https://inbox.example'
        : name === 'SUPABASE_SERVICE_ROLE_KEY' ? 'test-service-role' : '',
    },
    serve: (callback) => { handler = callback; },
  };

  new Function(
    'Deno',
    'createClient',
    'fetch',
    'Request',
    'Response',
    'applyLearningRules',
    'buildLearningPrompt',
    'filterOrderEvidenceMessages',
    'structuredClone',
    executable,
  )(
    deno,
    () => database,
    bridgeFetch,
    Request,
    Response,
    applyLearningRules,
    buildLearningPrompt,
    filterOrderEvidenceMessages,
    structuredClone,
  );

  assert.equal(typeof handler, 'function', `${path} registered an Edge Function handler`);
  return handler;
}

async function call(handler, body, header) {
  const response = await handler(new Request('https://inbox.example/functions/v1/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [header]: workerToken },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

const draftTrigger = loadHandler('supabase/functions/unified-inbox/order-draft-trigger/index.ts');
const prepaid = await call(draftTrigger, {
  conversation_id: conversationId,
  source_type: 'chat_trigger',
  payment_mode: 'prepaid',
  cutoff_at: paymentTime,
  dry_run: true,
}, 'x-order-draft-token');

assert.equal(prepaid.status, 200, prepaid.body.error);
assert.equal(prepaid.body.order_session_id, activeSessionId);
assert.equal(prepaid.body.excluded_seller_messages, 2);
assert.deepEqual(prepaid.body.extraction.items.map((item) => item.k), ['edible']);
assert.equal(prepaid.body.extraction.items[0].price, 12);
assert.equal(prepaid.body.extraction.items[0].wording, 'Ain & Zaim');
assert.equal(prepaid.body.extraction.evidence.session_boundary_enforced, true);
assert.deepEqual(prepaid.body.extraction.evidence.seller_template_filter.excluded.map((entry) => entry.id), [
  'seller-price-catalog',
  'seller-courier-menu',
]);
assert.ok(prepaid.body.extraction.evidence.messages.some((entry) => entry.id === 'new-seller-quote'));
assert.ok(prepaid.body.extraction.evidence.messages.every((entry) => !['old-confirmed-order', 'exact-closed-boundary', 'seller-price-catalog', 'seller-courier-menu'].includes(entry.id)));

const pickup = await call(draftTrigger, {
  conversation_id: conversationId,
  source_type: 'pickup_trigger',
  payment_mode: 'cash_counter',
  cutoff_at: paymentTime,
  dry_run: true,
}, 'x-order-draft-token');
assert.equal(pickup.status, 200, pickup.body.error);
assert.equal(pickup.body.extraction.delivery, 'pickup');
assert.equal(pickup.body.extraction.evidence.seller_template_filter.excluded_count, 2);

state.jobs = [{
  id: '44444444-4444-4444-8444-444444444444',
  amount: 12,
  payment_received_at: paymentTime,
  transaction_id: 'TEST-QRPAY-SESSION',
  mode: 'dry_run',
  attempts: 0,
  evidence: {},
}];
const qrWorker = loadHandler('supabase/functions/unified-inbox/qrpay-ai-order-worker/index.ts');
const qrpay = await call(qrWorker, { batch_size: 1 }, 'x-qrpay-ai-token');

assert.equal(qrpay.status, 200, qrpay.body.error);
assert.equal(qrpay.body.results.length, 1);
assert.equal(qrpay.body.results[0].status, 'dry_run_complete');
assert.equal(qrpay.body.results[0].excluded_seller_messages, 2);
assert.deepEqual(qrpay.body.results[0].payload.items.map((item) => item.k), ['edible']);
assert.equal(qrpay.body.results[0].payload.items[0].price, 12);
assert.equal(qrpay.body.results[0].payload.evidence.order_session_id, activeSessionId);
assert.ok(qrpay.body.results[0].payload.evidence.messages.every((entry) => !['old-confirmed-order', 'exact-closed-boundary', 'seller-price-catalog', 'seller-courier-menu'].includes(entry.id)));
assert.ok(state.updates.some((entry) => entry.patch.status === 'matched'));
assert.ok(state.updates.some((entry) => entry.patch.status === 'dry_run_complete'));

const previousMessages = state.messages;
const previousConsoleError = console.error;
state.messages = [oldMessage, boundaryMessage, catalogMessage, courierMessage];
let closedOnly;
try {
  console.error = () => {};
  closedOnly = await call(draftTrigger, {
    conversation_id: conversationId,
    source_type: 'chat_trigger',
    payment_mode: 'prepaid',
    cutoff_at: paymentTime,
    dry_run: true,
  }, 'x-order-draft-token');
} finally {
  console.error = previousConsoleError;
  state.messages = previousMessages;
}

assert.equal(closedOnly.status, 500);
assert.match(closedOnly.body.error, /No order messages in current order session/);

console.log('PASS: prepaid and pickup read only the active order session and discard saved seller price/courier snippets.');
console.log('PASS: QRPay matching and extraction use the same closed-session boundary and seller-snippet filter.');
console.log('PASS: real seller deal quotes survive, old confirmed-order chat never returns, and template-only sessions cannot create drafts.');
