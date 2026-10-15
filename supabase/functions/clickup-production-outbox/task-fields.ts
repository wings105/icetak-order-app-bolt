// Pure payload projection. Never mutate queue/component state here.
export const RM_FIELD_ID = '913a7d6e-d1ef-406d-8f0a-bcdce055077e';

const text = (value: unknown) => value == null ? '' : String(value).trim();
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);

export function taskFields(component: any, all: any[], manifest: any) {
  const item = component.order_items || {};
  const siblings = all.filter((row: any) =>
    component.order_item_id
      ? row.order_item_id === component.order_item_id
      : row.id === component.id
  );
  // all includes already-linked tasks, so retries never shift either price or set.
  const primary = siblings[0] || component;
  const totalItems = new Set(all.map((row: any) =>
    text(row.order_item_id) || text(row.id)
  )).size;
  const setRequired = totalItems > 1;
  const setIndex = Number(component.set_index) ||
    (all.findIndex((row: any) => row.id === component.id) + 1);
  const setField = text(manifest?.field_id);
  const setOption = setRequired
    ? text(component.clickup_set_option_id) ||
      text(manifest?.options?.[String(setIndex)])
    : '';
  const setLabel = setRequired
    ? text(component.set_label) || `set${setIndex}`
    : null;

  const quantity = Number(item.qty ?? 1);
  const rawPrice = item.price;
  const price = rawPrice == null || text(rawPrice) === ''
    ? NaN
    : Number(rawPrice);
  const priceReady = Number.isFinite(price) && price >= 0 &&
    Number.isInteger(quantity) && quantity > 0 &&
    Number.isSafeInteger(cents(price * quantity));
  const unitPrice = priceReady ? cents(price) / 100 : null;
  const itemTotal = priceReady ? cents(price * quantity) / 100 : null;
  // A commercial item can produce several tasks (e.g. edible + wafer).
  // With no separately stored component prices, book its amount once on the
  // first persisted component; the other task is included, never charged twice.
  const isPricePrimary = primary.id === component.id;
  const taskAmount = priceReady ? (isPricePrimary ? itemTotal : 0) : null;
  const customFields: { id: string; value: number | string[] }[] = [];
  if (priceReady) customFields.push({ id: RM_FIELD_ID, value: taskAmount! });
  if (setRequired && setField && setOption) {
    customFields.push({ id: setField, value: [setOption] });
  }

  return {
    unit_price: unitPrice,
    item_total: itemTotal,
    task_amount: taskAmount,
    price_ready: priceReady,
    price_source: 'order_items.price',
    price_allocation: siblings.length <= 1
      ? 'single_component'
      : isPricePrimary ? 'primary_component' : 'included_in_primary_component',
    price_primary_component_id: primary.id,
    price_custom_field_id: RM_FIELD_ID,
    price_currency: 'MYR',
    total_items: totalItems,
    set_required: setRequired,
    set_index: setIndex,
    set_label: setLabel,
    set_option_id: setOption || null,
    set_option_ids: setOption ? [setOption] : [],
    set_custom_field_id: setField || null,
    set_manifest_complete: !setRequired || Boolean(setField && setOption),
    custom_fields: customFields,
  };
}
