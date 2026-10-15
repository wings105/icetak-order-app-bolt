import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { taskFields, RM_FIELD_ID } from './task-fields.ts';
import { code as mapTaskMagic } from '../../../scripts/taskmagic-production-map.mjs';

const manifest = { field_id: 'set-field', options: { 1: 'option-1', 2: 'option-2', 3: 'option-3' } };
const row = (id, index, itemId, price, qty = 1, linked = false) => ({
  id, set_index: index, set_label: `set${index}`, order_item_id: itemId,
  clickup_task_id: linked ? 'existing-task' : null,
  order_items: { id: itemId, price, qty, title: 'Test Item' },
});

test('single item, multiple units: no set and correct line amount', () => {
  const c = row('a', 1, 'item-a', '12.00', 2);
  const result = taskFields(c, [c], manifest);
  assert.equal(result.task_amount, 24);
  assert.equal(result.unit_price, 12);
  assert.equal(result.set_required, false);
  assert.equal(result.set_label, null);
  assert.deepEqual(result.set_option_ids, []);
  assert.deepEqual(result.custom_fields, [{ id: RM_FIELD_ID, value: 24 }]);
});

test('multiple items: stable sets and individual prices across claims/retries', () => {
  const all = [row('a', 1, 'item-a', 24, 1, true), row('b', 2, 'item-b', 10, 3), row('c', 3, 'item-c', 6)];
  for (const c of all) {
    const fields = taskFields(c, all, manifest);
    assert.equal(fields.set_label, `set${c.set_index}`);
    assert.deepEqual(fields.set_option_ids, [`option-${c.set_index}`]);
    assert.equal(fields.total_items, 3);
  }
  const retried = taskFields(all[1], all, manifest);
  assert.equal(retried.task_amount, 30);
  assert.equal(retried.set_index, 2);
  assert.deepEqual(retried.custom_fields, [{ id: RM_FIELD_ID, value: 30 }, { id: 'set-field', value: ['option-2'] }]);
});

test('zero price remains valid, unknown price never becomes free', () => {
  for (const price of [null, '', undefined, 'invalid', -1]) {
    const c = row('a', 1, 'item', price);
    const result = taskFields(c, [c], manifest);
    assert.equal(result.task_amount, null);
    assert.equal(result.price_ready, false);
    assert.deepEqual(result.custom_fields, []);
  }
  const free = row('a', 1, 'item', 0);
  assert.deepEqual(taskFields(free, [free], manifest).custom_fields, [{ id: RM_FIELD_ID, value: 0 }]);
});

test('rounds MYR amounts to cents', () => {
  const c = row('a', 1, 'item', '3.35', 3);
  assert.equal(taskFields(c, [c], manifest).task_amount, 10.05);
});

test('split item: sum of task amounts equals item total including already-linked sibling', () => {
  const all = [row('edible', 1, 'burnaway', 18, 2, true), row('wafer', 2, 'burnaway', 18, 2)];
  const results = all.map(c => taskFields(c, all, manifest));
  assert.equal(results.reduce((sum, c) => sum + c.task_amount, 0), 36);
  assert.equal(results[1].task_amount, 0);
  assert.equal(results[1].price_allocation, 'included_in_primary_component');
  assert.equal(results[1].price_primary_component_id, 'edible');
  assert.equal(results[0].set_required, false);
  assert.equal(results[1].set_required, false);
});

test('unmapped set beyond manifest is never changed to another set', () => {
  const all = [row('a', 1, 'item-a', 10), row('b', 11, 'item-b', 12)];
  const result = taskFields(all[1], all, manifest);
  assert.equal(result.set_label, 'set11');
  assert.equal(result.set_manifest_complete, false);
  assert.deepEqual(result.set_option_ids, []);
});

test('TaskMagic mapper carries IDs/courier and merges typed RM/set only when present', async () => {
  const single = row('a', 1, 'item-a', 12, 2);
  const component = { ...taskFields(single, [single], manifest), webapp_order_id: 'order-id', webapp_component_id: 'a', wording: 'Test' };
  const inputs = { component: [component], order: { customer_phone: '60123456789', customer_token: 'fixture-token', delivery_address: 'Street', delivery_postcode: '12345' }, clickup_order_customer: 'Fixture', courier_option_id: 'courier-id' };
  const mapped = await mapTaskMagic(inputs);
  const values = Object.fromEntries(mapped.custom_fields.map(f => [f.id, f.value]));
  assert.equal(values[RM_FIELD_ID], 24);
  assert.equal(values['1bf24635-5405-47ec-9985-4b4d21f9c937'], 'order-id');
  assert.equal(values['1aa98168-cf59-4f52-a892-3acce4977e52'], 'a');
  assert.equal(values['55526fc6-8c57-4fc7-83b5-4c487c94c0c8'], 'courier-id');
  assert.ok(!('set-field' in values));
  const other = row('b', 2, 'item-b', 0);
  inputs.component = { ...component, ...taskFields(other, [single, other], manifest) };
  const multi = await mapTaskMagic(inputs);
  assert.equal(multi.custom_fields.find(f => f.id === RM_FIELD_ID).value, 0);
  assert.deepEqual(multi.custom_fields.find(f => f.id === 'set-field').value, ['option-2']);
});

// Exercise the real HTTP handler with an in-memory Supabase adapter. No writes
// reach production. In particular, preview must never claim or update a queue.
test('HTTP handler preserves one-per-claim, auth, and read-only preview', async () => {
  const secret = 'fixture-only-secret';
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))].map(x => x.toString(16).padStart(2, '0')).join('');
  const all = [row('a', 1, 'item-a', 24, 1, true), row('b', 2, 'item-b', 10, 2), row('c', 3, 'item-c', 6)];
  const orderId = '11111111-1111-4111-8111-111111111111';
  const calls = [];
  const db = {
    from(table) {
      const state = { table, operation: 'select' };
      const chain = new Proxy({}, { get(_, name) {
        if (name === 'then') return (resolve, reject) => {
          calls.push({ ...state });
          let data;
          if (table === 'clickup_integration_settings') data = { value: { secret_sha256: hash } };
          else if (table === 'system_settings') data = { value: state.key === 'clickup_component_set_manifest' ? manifest : { base_url: 'https://shop.example.test' } };
          else if (table === 'orders') data = { id: orderId, order_no: 'TEST-1', date_need: '2026-10-16', delivery_method: 'SPX', total: 50, delivery_name: 'Fixture' };
          else if (table === 'production_components') data = all;
          else data = null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        };
        return (...args) => {
          if (name === 'eq' && args[0] === 'key') state.key = args[1];
          if (['insert', 'update'].includes(name)) state.operation = name;
          return chain;
        };
      } });
      return chain;
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      if (name === 'icetak_clickup_initial_status_v2') return { data: 'new custom', error: null };
      if (name === 'peek_clickup_production_outbox') return { data: [{ id: 'event-1', order_id: orderId, event_type: 'clickup.production.create' }], error: null };
      if (name === 'claim_clickup_production_outbox_event') return { data: [{ id: 'event-1' }], error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const originalDeno = globalThis.Deno;
  let handler;
  globalThis.Deno = { env: { get: () => 'fixture' }, serve: fn => { handler = fn; } };
  globalThis.__outboxFixtureDb = db;
  try {
    let source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    source = source.replace(/import \{ createClient \} from '[^']+';/, 'const createClient = () => globalThis.__outboxFixtureDb;');
    source = source.replace("'./task-fields.ts'", JSON.stringify(pathToFileURL(new URL('./task-fields.ts', import.meta.url).pathname).href));
    await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
    const invoke = (suffix = '', authorized = true) => handler(new Request(`https://example.test/?${suffix}`, { headers: authorized ? { 'x-ap-secret': secret } : {} }));
    assert.equal((await invoke('', false)).status, 401);
    calls.length = 0;
    const preview = await (await invoke(`preview_order_id=${orderId}`)).json();
    assert.equal(preview.preview, true);
    assert.equal(preview.queue_claimed, false);
    assert.equal(preview.events[0].components[0].task_amount, 24);
    assert.ok(!calls.some(c => c.rpc?.includes('claim') || (c.table === 'integration_outbox' && c.operation === 'update')));
    calls.length = 0;
    const normal = await (await invoke()).json();
    assert.equal(normal.events[0].components.length, 1);
    assert.equal(normal.events[0].components[0].id, 'b');
    assert.equal(normal.events[0].components[0].task_amount, 20);
    assert.equal(normal.events[0].components[0].set_label, 'set2');
    assert.equal(normal.events[0].components[0].awb_primary, false);
    assert.equal(normal.events[0].order.total_items, 3);
    assert.ok(calls.some(c => c.rpc === 'claim_clickup_production_outbox_event' && c.args.p_expected_missing_count === 2));
    assert.equal((await invoke('preview_order_id=invalid')).status, 400);
  } finally {
    globalThis.Deno = originalDeno;
    delete globalThis.__outboxFixtureDb;
  }
});
