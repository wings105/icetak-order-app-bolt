import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../supabase/functions/qrpay-ai-order-bridge/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260822013000_order_session_status_batch.sql', import.meta.url), 'utf8');
const token = 'internal-test-worker-token';
const closedConversation = '4583fcdb-cabb-47a1-a0f9-15db1b1a1eb5';
const activeConversation = '0ffd66d4-ac8f-45bc-84c6-2429b97a4848';
const calls = [];
let handler;

const database = {
  from(table) {
    assert.equal(table, 'private_runtime_settings');
    return {
      select() { return this; },
      eq(column, value) {
        assert.equal(column, 'setting_key');
        assert.equal(value, 'qrpay_ai_worker_token');
        return this;
      },
      async maybeSingle() { return { data: { setting_value: token }, error: null }; },
    };
  },
  async rpc(name, arguments_) {
    calls.push({ name, arguments: arguments_ });
    assert.equal(name, 'icetak_order_session_status_batch');
    return {
      error: null,
      data: {
        [closedConversation]: {
          state: 'closed',
          session_status: 'converted',
          order_no: 'IC260822-9298',
          closed_at: '2026-08-22T00:54:36.454132+00:00',
        },
        [activeConversation]: { state: 'active', session_status: 'draft_created' },
      },
    };
  },
};

const runtime = {
  env: { get: () => 'test' },
  serve(value) { handler = value; },
};

const executable = stripTypeScriptTypes(
  source.replace(/^import\s+.*;\s*$/gm, ''),
  { mode: 'transform' },
);
new Function('createClient', 'Deno', executable)(() => database, runtime);
assert.equal(typeof handler, 'function');

function request(body, authorized = true) {
  return new Request('https://order.example/functions/v1/qrpay-ai-order-bridge', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorized ? { 'x-qrpay-ai-token': token } : {}),
    },
    body: JSON.stringify(body),
  });
}

const unauthorized = await handler(request({ action: 'order_session_status_batch', conversations: [] }, false));
assert.equal(unauthorized.status, 401);
assert.equal(calls.length, 0);

const oversized = await handler(request({
  action: 'order_session_status_batch',
  conversations: Array.from({ length: 1001 }, () => ({ conversation_id: closedConversation })),
}));
assert.equal(oversized.status, 400);
assert.equal(calls.length, 0);

const response = await handler(request({
  action: 'order_session_status_batch',
  conversations: [
    { conversation_id: closedConversation.toUpperCase(), phone: '011-2930 9043' },
    { conversation_id: closedConversation, phone: '601129309043' },
    { conversation_id: activeConversation, phone: '+60 19-422 5114' },
    { conversation_id: 'not-a-conversation', phone: '601199999999' },
  ],
}));
assert.equal(response.status, 200);
const result = await response.json();
assert.equal(result.sessions[closedConversation].state, 'closed');
assert.equal(result.sessions[closedConversation].order_no, 'IC260822-9298');
assert.equal(result.sessions[activeConversation].state, 'active');
assert.deepEqual(calls[0].arguments.p_conversations, [
  { conversation_id: closedConversation, phone: '601129309043' },
  { conversation_id: activeConversation, phone: '60194225114' },
]);

assert.match(migration, /security invoker/i);
assert.match(migration, /revoke all on function[\s\S]+from public, anon, authenticated/i);
assert.match(migration, /grant execute on function[\s\S]+to service_role/i);
assert.match(migration, /s\.conversation_id = requested\.conversation_id/);
assert.match(migration, /s\.customer_phone = requested\.customer_phone/);
assert.match(migration, /'state', case when session\.is_active then 'active' else 'closed' end/);

console.log('Order-session status bridge: authorization, batch limits, phone fallback, active/closed states, and SQL permissions verified.');
