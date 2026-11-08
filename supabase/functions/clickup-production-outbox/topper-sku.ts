export const SKU_FIELD_ID = '34c62cbb-c174-42e8-9c50-8301f68269a8';
const text = (v: unknown) => v == null ? '' : String(v).trim();
export function topperSku(status: unknown, item: any) {
  if (text(status).toLowerCase() !== 'design editing -topper') return '';
  return [item?.sku, item?.product_snapshot?.variant_sku, item?.customization?.variant_sku, item?.product_snapshot?.parent_sku].map(text).find(Boolean) || '';
}
