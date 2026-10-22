import assert from 'node:assert/strict';
import { itemCategories, orderCategories, matchesOrderCategory } from '../apps/inbox/src/lib/orderCategories.ts';

const cases = [
  [{product_type:'edible',title:'Custom Topper'},['edible']],
  [{product_type:'printed'},['topper']],
  [{product_type:'mirror'},['artpaper_gold']],
  [{product_type:'burnaway'},['edible','wafer']],
  [{title:'Acrylic Cake Topper Gold'},['acrylic']],
  [{title:'Mirror Gold Artpaper Cake Topper'},['artpaper_gold']],
  [{title:'Printing Wafer Paper for Burn Away Cake NOT Icing Paper'},['wafer']],
  [{title:'Edible Image Cake Topper Icing Sheet'},['edible']],
  [{item_sku:'Ei-no-review'},['edible']],
  [{title:'Custom Name Birthday Cake Topper'},['topper']],
  [{title:'Birthday Banner'},[]],
  [{},[]],
];
for(const [item,expected] of cases) assert.deepEqual(itemCategories(item),expected);
const mixed={items:[{product_type:'edible'},{product_type:'acrylic'},{product_type:'edible'}]};
assert.deepEqual(orderCategories(mixed),['acrylic','edible']);
assert.equal(matchesOrderCategory(mixed,'edible'),true);
assert.equal(matchesOrderCategory(mixed,'acrylic'),true);
assert.equal(matchesOrderCategory(mixed,'topper'),false);
assert.equal(matchesOrderCategory({items:[]},'all'),true);
assert.equal(matchesOrderCategory({product_categories:['wafer'],items:[]},'wafer'),true);
console.log(`${cases.length + 6} Inbox category checks passed: product types, listing material precedence, mixed orders and search-detail fallback.`);
