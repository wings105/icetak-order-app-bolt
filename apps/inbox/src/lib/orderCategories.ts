export const ORDER_CATEGORIES = [
  ['edible', 'Edible Image'],
  ['topper', 'Cake Topper'],
  ['acrylic', 'Acrylic'],
  ['wafer', 'Wafer'],
  ['artpaper_gold', 'Artpaper Gold'],
] as const;

export type OrderCategory = typeof ORDER_CATEGORIES[number][0];
export type OrderCategoryFilter = 'all' | OrderCategory;
export type OrderCategoryCounts = Partial<Record<OrderCategoryFilter, number>>;

type CategoryItem = {
  product_type?: string | null;
  title?: string | null;
  item_sku?: string | null;
  variation_sku?: string | null;
  variation_name?: string | null;
};

const PRODUCT_TYPES: Record<string, readonly OrderCategory[]> = {
  edible: ['edible'], edible_image: ['edible'], ei: ['edible'],
  printed: ['topper'], cake_topper: ['topper'], topper: ['topper'],
  acrylic: ['acrylic'], wafer: ['wafer'], wafer_paper: ['wafer'],
  mirror: ['artpaper_gold'], mirror_gold: ['artpaper_gold'], artpaper: ['artpaper_gold'], artpaper_gold: ['artpaper_gold'],
  burnaway: ['edible', 'wafer'], burn_away: ['edible', 'wafer'],
};

export function itemCategories(item: CategoryItem): readonly OrderCategory[] {
  const type = (item.product_type ?? '').trim().toLowerCase().replace(/[ -]+/g, '_');
  if (Object.prototype.hasOwnProperty.call(PRODUCT_TYPES, type)) return PRODUCT_TYPES[type];
  const text = [item.item_sku, item.title, item.variation_sku, item.variation_name].filter(Boolean).join(' ').toLowerCase();
  // Specific materials win over broad listing keywords such as Cake Topper or NOT Icing.
  if (/wafer/.test(text)) return ['wafer'];
  if (/art[ -]?paper|mirror[ -]?gold/.test(text)) return ['artpaper_gold'];
  if (/acrylic|akrilik/.test(text)) return ['acrylic'];
  if (/edible|icing|sugar[ -]?sheet|(^|[^a-z0-9])ei([^a-z0-9]|$)/.test(text)) return ['edible'];
  if (/topper/.test(text)) return ['topper'];
  return [];
}

export function orderCategories(order: { items?: CategoryItem[] | null; product_categories?: OrderCategory[] }): OrderCategory[] {
  if (order.product_categories) return order.product_categories;
  return [...new Set((order.items ?? []).flatMap(itemCategories))].sort();
}

export function matchesOrderCategory(order: Parameters<typeof orderCategories>[0], category: OrderCategoryFilter): boolean {
  return category === 'all' || orderCategories(order).includes(category);
}
