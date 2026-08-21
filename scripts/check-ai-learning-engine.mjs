import assert from 'node:assert/strict';
import {
  applyLearningRules,
  buildLearningPrompt,
  quickOrderPrice,
} from '../supabase/functions/unified-inbox/_shared/ai-learning-engine.ts';

const rules = [
  ['preserve_distinct_products', 'Keep separate products distinct.'],
  ['variation_from_nearest_item_context', 'Bind size and style to the nearest item.'],
  ['price_from_quick_order_variation', 'Use the official Quick Order catalog matrix.'],
  ['price_from_latest_explicit_seller_quote', 'Use the latest explicit seller quote.'],
  ['qty_from_nearest_explicit_item_count', 'Bind quantity to the nearest product.'],
  ['shipping_from_quick_order_delivery', 'Use the official courier fee matrix.'],
  ['shipping_from_latest_explicit_quote', 'Use the latest courier decision.'],
  ['date_from_latest_customer_need', 'Use the latest customer-required date.'],
  ['wording_from_explicit_label', 'Use the customer-provided wording.'],
  ['customer_identity_from_strong_payment_context', 'Use the current conversation identity.'],
].map(([strategy_key, lesson], index) => ({
  id: `rule-${index}`,
  strategy_key,
  title: strategy_key,
  lesson,
  status: 'active',
  occurrence_count: 10,
  examples: [],
}));

function message(direction, text, index) {
  return { id: `message-${index}`, direction, text_content: text, created_at: `2026-08-21T0${index}:00:00Z` };
}

function initial(items = [{ k: 'acrylic', product_type: 'acrylic', title: 'Acrylic Cake Topper', size: 'A6', qty: 1, price: 12 }]) {
  return { customer: { name: 'WhatsApp Customer', phone: '60179860656' }, items, delivery: 'unknown', delivery_fee: 0, date_need: null };
}

assert.equal(quickOrderPrice('acrylic', 'Pre-order', 'A6 Standard'), 20);
assert.equal(quickOrderPrice('edible', 'Pre-order', 'A5'), 12);
assert.equal(quickOrderPrice('mirror', 'Pre-order', 'A7 Mini'), 15);

const corrected = applyLearningRules(initial(), [
  message('inbound', 'Nak acrylic A6 gold 2pcs', 1),
  message('outbound', 'Acrylic A6 RM18 x 2pcs', 2),
  message('outbound', '1️⃣ SPX RM4.50\n2️⃣ J&T RM5.90\nPrefer courier apa?', 3),
  message('inbound', 'J&T, tarikh 24/8/2026\nwording: Ain & Zaim', 4),
], rules, {
  flow: 'chat_trigger',
  referenceTime: '2026-08-21T10:00:00Z',
  customerIdentity: { name: 'Customer sebenar', phone: '60129554732' },
});

assert.equal(corrected.customer.phone, '60129554732', 'business number must never replace customer identity');
assert.equal(corrected.customer.name, 'Customer sebenar');
assert.equal(corrected.items[0].size, 'A6 Standard', 'admin-corrected A6 normalization must be enforced');
assert.equal(corrected.items[0].catalog_price, 20, 'catalog price must follow the official A6 matrix');
assert.equal(corrected.items[0].price, 18, 'seller-specific quote must override the catalog price');
assert.equal(corrected.items[0].seller_deal_price, 18);
assert.equal(corrected.items[0].qty, 2);
assert.equal(corrected.items[0].wording, 'Ain & Zaim');
assert.equal(corrected.delivery, 'jnt', 'customer choice must win over the earlier courier menu');
assert.equal(corrected.delivery_fee, 5.9);
assert.equal(corrected.date_need, '2026-08-24');
assert.ok(corrected.evidence.learning.applied_change_count >= 7);
assert.equal(corrected.evidence.learning.mode, 'rule_engine');

const multiple = applyLearningRules(initial([
  { k: 'edible', product_type: 'edible', title: 'Edible Image', size: 'A5', qty: 1, price: 0 },
]), [
  message('inbound', 'Nak edible A5 dan acrylic A7', 1),
  message('outbound', 'Edible A5 RM12\nAcrylic A7 RM12', 2),
], rules, { flow: 'pickup_trigger', referenceTime: '2026-08-21T10:00:00Z' });

assert.deepEqual(multiple.items.map((item) => item.k).sort(), ['acrylic', 'edible']);
assert.equal(multiple.items.find((item) => item.k === 'acrylic').size, 'A7 Mini');
assert.equal(multiple.delivery, 'pickup', 'pickup flow defaults to pickup only when no other choice exists');

const inactive = applyLearningRules(initial(), [message('inbound', 'Acrylic A6', 1)], rules.map((rule) => ({ ...rule, status: 'candidate' })), {
  flow: 'chat_trigger',
});
assert.equal(inactive.items[0].size, 'A6', 'candidate/deactivated rules must not execute');
assert.equal(inactive.evidence.learning.active_rule_count, 0);

const sensitivePrompt = buildLearningPrompt([{
  ...rules.find((rule) => rule.strategy_key === 'customer_identity_from_strong_payment_context'),
  examples: [{ field_path: 'customer.phone', ai_value: '', human_value: '60123456789' }],
}]);
assert.match(sensitivePrompt, /MANDATORY ACTIVE RULES/);
assert.doesNotMatch(sensitivePrompt, /60123456789/, 'another customer phone must never leak into a later AI prompt');

console.log('PASS: active rules change draft values, seller deals, products, quantity, courier, dates and identity.');
console.log('PASS: inactive rules do not execute and private customer examples are redacted from AI instructions.');
