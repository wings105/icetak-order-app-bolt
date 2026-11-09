import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

const path = process.argv[2] || 'supabase/functions/clickup-order-brief/index.ts';
const source = stripTypeScriptTypes(readFileSync(path, 'utf8').replace(/^import .*;\n/gm, ''));
const rule = new Function('Deno', source + '\nreturn completeMultilineNoteRule;')({
  env: {get: () => ''},
  serve: () => {},
});
const note = 'Nama : Sample Child\nUmur : 4 Tahun';
const echo = {direction: 'inbound', message_type: 'text', text_content: note};
const orderReference = 'QA_ORDER_01';
const orderCard = {direction: 'inbound', channel: 'shopee', message_type: 'order', order_sn: orderReference};
const input = {
  note: note.replace('\n', '\\n'),
  existingWord: note,
  items: [{item_sku: 'YS0312', provider_item_id: '12345678901', quantity: 1}],
  siblingTasks: [{task_id: 'synthetic'}],
  provider: {available: true, order_status: 'READY_TO_SHIP', messages: [echo, orderCard]},
  context: {},
  decision: {},
  sku: 'YS0312',
  task_id: 'synthetic',
  order_reference: orderReference,
  multi: false,
  messages: [echo],
};

assert.deepEqual(rule(input), {
  eligible: true, reason: 'COMPLETE_ORDER_BUYER_NOTE', wording: 'Sample Child 4', confidence: 88,
});
assert.equal(rule({...input, existingWord: 'Sample Child 4'}).eligible, true);
assert.equal(rule({...input, existingWord: 'Staff Wording'}).reason, 'STAFF_WORDING_PROTECTED');
assert.equal(rule({...input, messages: [echo, {...echo, text_content: 'Tukar umur kepada 5'}]}).reason,
  'CUSTOMER_REPLY_REQUIRES_REVIEW');
assert.equal(rule({...input, messages: [{...echo, message_type: 'image'}]}).reason,
  'CUSTOMER_REPLY_REQUIRES_REVIEW');
assert.equal(rule({...input, messages: [{...orderCard, order_sn: 'DIFFERENT_ORDER'}]}).reason,
  'CUSTOMER_REPLY_REQUIRES_REVIEW');
assert.equal(rule({...input, messages: [{...orderCard, caption: 'Change the name'}]}).reason,
  'CUSTOMER_REPLY_REQUIRES_REVIEW');
assert.equal(rule({...input, decision: {age_conflict: true}}).reason, 'DETAIL_CONFLICT');
assert.equal(rule({...input, context: {truncated: true}}).reason, 'INCOMPLETE_CONTEXT');
assert.equal(rule({...input, multi: true}).reason, 'SINGLE_PRODUCT_REQUIRED');
assert.equal(rule({...input, provider: {...input.provider, order_status: 'UNPAID'}}).reason,
  'FRESH_ORDER_REQUIRED');
console.log('PASS checkout note copy, mirrored text, and staff, chat, media, order and context guards.');
