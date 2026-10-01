import assert from 'node:assert/strict';
import { defaults, assessment, factor, summary } from '../src/cake-mockup/model.ts';
import { edibleCatalog, edibleChoice, presetDimensions, rotatedOutline } from '../src/cake-mockup/edible.ts';

const c = defaults();
assert.equal(assessment(c).margin, 0.5, '5-inch edible on 6-inch cake leaves half an inch per side');
assert.equal(assessment(c).warnings.length, 0);
c.unit = 'cm';
assert.equal(factor(c.unit) * assessment(c).margin, 1.27, 'unit conversion preserves physical clearance');
assert.match(summary(c), /12.7 cm/);
c.unit = 'inch';
c.product.placement = 'side';
assert.ok(assessment(c).warnings.some(w => w.includes('tinggi dinding')), '5-inch-high edible cannot fit 4-inch-high wall');
c.product.width = c.product.height = 3;
assert.equal(assessment(c).warnings.length, 0, '3-inch side image fits the 4-inch wall');
c.product.width = 20;
assert.ok(assessment(c).warnings.some(w => w.includes('keliling')), 'full-wrap overlap is flagged');
const square = defaults(); square.product.shape = 'square'; square.product.width = square.product.height = 5;
assert.ok(assessment(square).margin < 0, '5-inch square corners overhang a 6-inch round cake');
square.shape = 'rect'; square.tiers[0].depth = 6;
assert.equal(assessment(square).margin, 0.5);
square.product.rotation = 45;
assert.ok(assessment(square).margin < 0, 'rotated square overhang is measured');
const tiers = defaults(); tiers.tiers.push({ width: 8, depth: 8, height: 4 });
assert.ok(assessment(tiers).warnings.some(w => w.includes('Tier 2')), 'larger upper tier is flagged');
const acrylic = defaults(); acrylic.product.kind = 'acrylic'; acrylic.product.width = 14 / 2.54; acrylic.product.height = 10 / 2.54;
assert.equal(assessment(acrylic).warnings.length, 0);
acrylic.product.placement = 'side'; acrylic.product.y = 100;
assert.ok(assessment(acrylic).warnings.some(w => w.includes('tinggi dinding')), 'position offset can overhang even when dimensions fit');
console.log('PASS: cake/product clearance, unit conversion, curved-side height and wrap, rotated square bounds, tier ordering, acrylic position.');

// Independent price boundaries: square 4-inch differs from round/love 4-inch.
const at = (shape, width, height = width) => edibleChoice({ kind: 'edible', shape, width, height });
assert.equal(edibleCatalog.length, 34);
for (const shape of ['round', 'square', 'heart']) {
  for (const size of [3, 3.5]) assert.equal(at(shape, size).price, 6);
  for (const size of [4.5, 5, 5.5]) assert.equal(at(shape, size).price, 12);
  for (const size of [6, 6.5, 7, 7.5]) assert.equal(at(shape, size).price, 24);
}
assert.equal(at('round', 4).price, 6); assert.equal(at('heart', 4).price, 6); assert.equal(at('square', 4).price, 12);
assert.equal(at('round', 1.8).price, 1.2); assert.equal(at('round', 1.8).capacity, 24);
assert.equal(at('round', 2), null); assert.equal(at('heart', 4.2), null);
for (const [width, height, price] of [[5.5, 3.7, 6], [7.5, 5.5, 12], [11, 7.5, 24]]) {
  assert.equal(at('rect', width, height).price, price); assert.equal(at('rect', height, width).price, price);
  assert.deepEqual(presetDimensions(at('rect', width, height), 'portrait'), { width: height, height: width });
}
const heart = defaults(); heart.product.shape = 'heart'; heart.product.width = heart.product.height = 4;
assert.ok(assessment(heart).margin > 0, '4-inch love fits a 6-inch round cake');
heart.shape = 'rect'; heart.product.rotation = 90;
assert.equal(assessment(heart).margin, 1, 'rotated love respects exact bounding dimensions on square cake');
assert.match(summary(heart), /Love/); assert.match(summary(heart), /RM6.00/);
heart.product.shape = 'round'; heart.product.width = heart.product.height = 1.8;
assert.match(summary(heart), /24 pcs \/ A4/);
const points = rotatedOutline('heart', 4, 4, 0);
assert.equal(Math.min(...points.map(p => p[0])), -2); assert.equal(Math.max(...points.map(p => p[0])), 2);
assert.equal(Math.min(...points.map(p => p[1])), -2); assert.equal(Math.max(...points.map(p => p[1])), 2);
console.log('PASS: 34 edible presets, shape-specific prices, cupcake capacity, rectangular orientations, custom pricing, true heart bounds and WhatsApp summary.');
