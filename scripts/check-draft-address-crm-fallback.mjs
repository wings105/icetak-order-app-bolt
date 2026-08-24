import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const draftId = '17ef3749-0f17-4db1-a183-454ee1740fbf';
const addressId = '5892ce61-fa74-4060-aa28-e14d90a7c9d9';
const masterId = '12b168b9-dba8-4e1f-baf0-2cb02d44f0bf';
const rows = {
  customers: [{ id: 'f3a5b234-e4a5-4d9a-b6fe-4348e804d1f6', customer_master_id: masterId, name: 'aishahkamil', phone: '60143688059' }],
  customer_identifiers_master: [],
  customer_addresses: [{
    id: addressId,
    customer_id: 'f3a5b234-e4a5-4d9a-b6fe-4348e804d1f6',
    customer_master_id: masterId,
    recipient_name: 'aishahkamil',
    phone: '60143688059',
    address_line1: 'No.67 Kg Parit Sempadan',
    address_line2: '',
    city: 'Parit Raja',
    postcode: '86400',
    state: 'Johor',
    is_default: true,
    is_verified: true,
    last_used_at: '2026-08-19T02:52:41.675973Z',
    source_provider: 'draft_checkout',
    archived_at: null,
  }],
  qrpay_order_drafts: [{
    id: draftId,
    review_token: `qrd_${'1'.padStart(32, '0')}`,
    status: 'pending_admin',
    version: 1,
    customer_name: 'aishahkamil',
    customer_phone: '60143688059',
    working_draft: { customer: { name: 'aishahkamil', phone: '60143688059', address_line1: '', postcode: '', city: '', state: '' } },
  }],
  qrpay_order_draft_events: [],
  private_runtime_settings: [{ setting_key: 'draft_address_make_webhook_url', setting_value: 'https://clickup.example.test/address' }],
  admin_users: [],
  admin_permissions: [],
  orders: [],
};

const clone = (value) => value == null ? value : structuredClone(value);
const matches = (row, filters) => filters.every(({ type, key, value }) => {
  if (type === 'eq') return row[key] === value;
  if (type === 'in') return value.includes(row[key]);
  if (type === 'is') return row[key] === value;
  if (type === 'gte') return String(row[key] || '') >= String(value);
  if (type === 'or') {
    return value.split(',').some((part) => {
      const [column, operator, expected] = part.split('.');
      return operator === 'eq' && String(row[column]) === expected;
    });
  }
  return true;
});

function from(table) {
  const filters = [];
  let mutation = null;
  let mutationValue = null;
  const query = {
    select() { return this; },
    eq(key, value) { filters.push({ type: 'eq', key, value }); return this; },
    in(key, value) { filters.push({ type: 'in', key, value }); return this; },
    is(key, value) { filters.push({ type: 'is', key, value }); return this; },
    gte(key, value) { filters.push({ type: 'gte', key, value }); return this; },
    or(value) { filters.push({ type: 'or', value }); return this; },
    order() { return this; },
    limit() { return this; },
    update(value) { mutation = 'update'; mutationValue = value; return this; },
    insert(value) { mutation = 'insert'; mutationValue = value; return this; },
    async maybeSingle() {
      const found = rows[table].filter((row) => matches(row, filters));
      if (mutation === 'update') {
        const row = found[0] || null;
        if (row) Object.assign(row, clone(mutationValue));
        return { data: clone(row), error: null };
      }
      return { data: clone(found[0] || null), error: null };
    },
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        const found = rows[table].filter((row) => matches(row, filters));
        if (mutation === 'insert') rows[table].push(clone(mutationValue));
        if (mutation === 'update') found.forEach((row) => Object.assign(row, clone(mutationValue)));
        return { data: clone(found), error: null };
      }).then(resolve, reject);
    },
  };
  return query;
}

let handler;
let clickupCalls = 0;
globalThis.createClient = () => ({ from });
globalThis.Deno = {
  env: { get: (key) => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' }[key]) },
  serve: (callback) => { handler = callback; },
};
globalThis.fetch = async () => {
  clickupCalls += 1;
  throw new Error('ClickUp must not be called when CRM has a valid saved address');
};

const edgeSource = readFileSync(new URL('../supabase/functions/draft-address-fetch/index.ts', import.meta.url), 'utf8');
const executable = stripTypeScriptTypes(edgeSource.replace(/^import .*;\n/gm, ''), { mode: 'strip' });
new Function(executable)();
assert.equal(typeof handler, 'function');

const draft = rows.qrpay_order_drafts[0];
const response = await handler(new Request('https://example.supabase.co/functions/v1/draft-address-fetch', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: draft.review_token, phone: draft.customer_phone }),
}));
const body = await response.json();

assert.equal(response.status, 200);
assert.equal(body.ok, true);
assert.equal(body.found, true);
assert.equal(body.source, 'customer_crm');
assert.equal(body.address.id, addressId);
assert.equal(clickupCalls, 0, 'Customer CRM wins before ClickUp');
assert.equal(draft.working_draft.customer.address_line1, 'No.67 Kg Parit Sempadan');
assert.equal(draft.working_draft.customer.postcode, '86400');
assert.equal(draft.working_draft.customer.address_id, addressId);
assert.equal(draft.working_draft.address_evidence.source, 'customer_crm');
assert.equal(draft.version, 2);
assert.ok(rows.qrpay_order_draft_events.some((event) => event.event_type === 'crm_address_fetched'));

rows.customers.length = 0;
rows.customer_addresses.length = 0;
const clickupDraft = {
  id: '27ef3749-0f17-4db1-a183-454ee1740fbf',
  review_token: `qrd_${'2'.padStart(32, '0')}`,
  status: 'pending_admin',
  version: 1,
  customer_name: 'ClickUp Customer',
  customer_phone: '60123456789',
  working_draft: { customer: { name: 'ClickUp Customer', phone: '60123456789' } },
};
rows.qrpay_order_drafts.push(clickupDraft);
globalThis.fetch = async (input) => {
  clickupCalls += 1;
  assert.equal(String(input), 'https://clickup.example.test/address');
  return new Response(JSON.stringify({
    found: true,
    phone: '+60123456789',
    nama: 'ClickUp Customer',
    address: 'PT 123 Kampung Ujian',
    bandar: 'Pasir Puteh',
    poskod: '16800',
    negeri: 'Kelantan',
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const clickupResponse = await handler(new Request('https://example.supabase.co/functions/v1/draft-address-fetch', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: clickupDraft.review_token, phone: clickupDraft.customer_phone }),
}));
const clickupBody = await clickupResponse.json();
assert.equal(clickupResponse.status, 200);
assert.equal(clickupBody.source, 'clickup');
assert.equal(clickupDraft.working_draft.customer.address_line1, 'PT 123 Kampung Ujian');
assert.equal(clickupDraft.working_draft.address_evidence.source, 'clickup_webhook');
assert.equal(clickupCalls, 1, 'ClickUp runs only when Customer CRM has no saved address');

const invalid = await handler(new Request('https://example.supabase.co/functions/v1/draft-address-fetch', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: 'invalid', phone: '60143688059' }),
}));
assert.equal(invalid.status, 401);

const html = readFileSync(new URL('../public/qrpay-draft.html', import.meta.url), 'utf8');
assert.match(html, /Cari Alamat Customer/);
assert.match(html, /result\.source==='customer_crm'/);
assert.match(html, /queueMicrotask\(maybeAutoFetchAddress\)/);
assert.match(html, /Customer CRM atau ClickUp/);

const createOrder = readFileSync(new URL('../icetak-admin/src/pages/CreateOrder.tsx', import.meta.url), 'utf8');
const quickOrder = readFileSync(new URL('../icetak-admin/src/pages/QuickOrder.tsx', import.meta.url), 'utf8');
const orders = readFileSync(new URL('../icetak-admin/src/pages/Orders.tsx', import.meta.url), 'utf8');
assert.match(createOrder, /Cari Alamat Customer/);
assert.match(createOrder, /response\.source === 'customer_crm'/);
assert.match(quickOrder, /fetched\.source==='customer_crm'/);
assert.match(orders, /result\.source === 'customer_crm'/);

console.log('Draft address CRM-first fallback checks passed.');
