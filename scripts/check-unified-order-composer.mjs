import assert from 'node:assert/strict';
import {
  EMPTY_ADJUSTMENTS,
  EMPTY_CUSTOMER,
  calculateComposerTotals,
  composerCatalogPrice,
  composerEffectivePrice,
  createComposerPayload,
  isValidWhatsAppUserId,
  makeComposerItem,
  normalizeComposerItem,
} from '../icetak-admin/src/lib/orderComposer.ts';

const item = normalizeComposerItem(makeComposerItem('acrylic'), {
  size: 'A6 Standard',
  qty: 2,
  sellerDealPrice: '18',
  priceReason: 'Deal customer',
  wording: 'Ain & Zaim',
});

assert.equal(composerCatalogPrice(item), 20, 'Acrylic A6 catalog price remains RM20');
assert.equal(composerEffectivePrice(item), 18, 'seller deal replaces the effective price only');

const adjustments = {
  ...EMPTY_ADJUSTMENTS,
  customAddon: '5',
  customAddonReason: 'Extra design',
  discountType: 'percent',
  discountValue: '10',
  discountReason: 'Promo',
};

const totals = calculateComposerTotals([item], 'jnt', adjustments);
assert.deepEqual(totals, {
  catalogSubtotal: 40,
  itemSubtotal: 36,
  sellerDealSavings: 4,
  addon: 5,
  discountAmount: 4.1,
  shipping: 5.9,
  rounding: 0,
  total: 42.8,
});

const roundedTotals = calculateComposerTotals([item], 'jnt', { ...adjustments, rounding: '-0.30' });
assert.equal(roundedTotals.total, 42.5, 'negative rounding is applied after shipping and discount');

const custom = normalizeComposerItem(makeComposerItem('printed', true), {
  title: 'Sticker logo custom',
  sellerDealPrice: '27',
  qty: 3,
});
assert.equal(custom.title, 'Sticker logo custom');
assert.equal(composerCatalogPrice(custom), 10);
assert.equal(composerEffectivePrice(custom), 27);

const payload = createComposerPayload({
  customer: { ...EMPTY_CUSTOMER, name: 'Za’imuddin', bsuid: 'MY.2403797133469318', username: '@zaimuddin.alias' },
  items: [item, custom],
  adjustments,
  delivery: 'pickup',
  paymentMode: 'cash_counter',
  dateNeed: '2026-08-24',
  source: 'Walk-in',
  note: 'Customer datang ambil.',
  notifyWhatsapp: true,
});

assert.equal(payload.customer.phone, '', 'phone stays optional when the customer uses a BSUID');
assert.equal(payload.whatsapp_identity.bsuid, 'MY.2403797133469318');
assert.equal(payload.whatsapp_identity.username, 'zaimuddin.alias');
assert.equal(payload.payment_mode, 'cash_counter');
assert.equal(payload.delivery_fee, 0);
assert.equal(payload.items[0].price, 20, 'catalog price is retained in the canonical payload');
assert.equal(payload.items[0].seller_deal_price, 18, 'seller deal is represented independently');
assert.equal(payload.items[1].title, 'Sticker logo custom', 'manual custom item names are preserved');
assert.equal(payload.items[1].is_custom_item, true);
assert.equal(payload.price_adjustments.discount_type, 'percent');
assert.equal(payload.price_adjustments.discount_value, 10);
assert.equal(isValidWhatsAppUserId('MY.2403797133469318'), true);
assert.equal(isValidWhatsAppUserId('60129554732'), false);

console.log('PASS: unified composer preserves catalog/deal prices, quantity, shipping, add-on, discount and rounding.');
console.log('PASS: custom items, pickup cash counter and WhatsApp BSUID without phone use the canonical draft contract.');
