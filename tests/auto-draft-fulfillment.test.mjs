import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectCurrentOrderEvidence,
  useVerifiedChatPrices,
} from '../supabase/functions/unified-inbox/order-draft-trigger/ai-learning-engine.ts';

const timestamp = (day, time) => `2026-11-${String(day).padStart(2, '0')}T${time}:00Z`;
const message = (id, day, time, body, fields = {}) => ({
  id, provider_message_id: id, at: timestamp(day, time), text: body,
  direction: 'inbound', ...fields,
});
const order = (terminal_at) => ({
  order_no: 'IC261109-0001', order_id: 'order-1', created_at: timestamp(9, '14:17'), terminal_at,
});
const cutoff = (day, time) => Date.parse(timestamp(day, time));

test('production follow-up remains associated with the old order through handover', () => {
  const old = message('old', 10, '03:28', 'topper tu saiz berapa');
  const tracking = message('tracking', 11, '03:00', 'dah buat ke', {reply_to_provider_message_id:'old'});
  const next = message('next', 15, '12:40', 'saya nak print edible baru');
  const photo = message('artwork', 15, '12:41', '', {type:'document'});
  const trigger = message('trigger', 15, '13:09', '#ok blh', {direction:'outbound'});
  const result = selectCurrentOrderEvidence([tracking, next, photo, trigger],
    [order(timestamp(10, '08:34'))], cutoff(15, '13:09'), [old]);
  assert.deepEqual(result.messages.map(m => m.id), ['next', 'artwork', 'trigger']);
  assert.deepEqual(result.previousOrderMessages, [{order_no:'IC261109-0001', count:1}]);
});

test('active order follow-up alone does not create another draft', () => {
  const result = selectCurrentOrderEvidence([message('old', 10, '12:00', 'nk topper betul size')],
    [order(null)], cutoff(10, '12:01'));
  assert.equal(result.followUpOnly, true);
  assert.equal(result.activeOrders.length, 1);
  assert.equal(result.messages.length, 0);
});

test('ready to collect ends the active window while the customer has yet to collect', () => {
  const result = selectCurrentOrderEvidence([message('new', 10, '12:00', 'edible A4 berapa')],
    [order(timestamp(10, '12:00'))], cutoff(10, '12:01'));
  assert.equal(result.followUpOnly, false);
  assert.deepEqual(result.activeOrders, []);
  assert.equal(result.messages[0].id, 'new');
});

test('same-day explicit separate order can proceed while original is active', () => {
  const result = selectCurrentOrderEvidence([
    message('old', 10, '12:00', 'jgn ubah nama topper'),
    message('new', 10, '12:05', 'order baru nak edible'),
    message('reply', 10, '12:07', 'A4', {reply_to_provider_message_id:'new'}),
    message('old-reply', 10, '12:10', 'saiz 5', {reply_to_provider_message_id:'old'}),
  ], [order(null)], cutoff(10, '12:10'));
  assert.deepEqual(result.messages.map(m => m.id), ['new', 'reply']);
  assert.equal(result.needsOrderDecision, false);
});

test('add-on from an active order requires a manual decision', () => {
  const result = selectCurrentOrderEvidence([
    message('add', 10, '12:00', 'tambah edible sekali dengan order tadi'),
  ], [order(null)], cutoff(10, '12:01'));
  assert.equal(result.followUpOnly, false);
  assert.equal(result.needsOrderDecision, true);
  assert.equal(result.activeOrders[0].order_id, 'order-1');
});

test('an overnight order preserves earlier evidence and unverified prices are removed', () => {
  const result = selectCurrentOrderEvidence([
    message('request', 10, '22:00', 'nak edible'),
    message('size', 11, '02:00', 'A4 sahaja'),
    message('detail', 11, '02:01', '4x5', {direction:'outbound'}),
  ], [], cutoff(11, '02:02'));
  assert.equal(result.messages.length, 3);
  const draft = {items:[{k:'edible',price:4,seller_deal_price:4}]};
  useVerifiedChatPrices(draft, result.messages);
  assert.equal(draft.items[0].seller_deal_price, null);
  useVerifiedChatPrices(draft, [...result.messages, message('quote', 11, '02:02', 'edible RM24', {direction:'outbound'})]);
  assert.equal(draft.items[0].seller_deal_price, 24);
  assert.equal(draft.items[0].customization.seller_quote_message_id, 'quote');
});
