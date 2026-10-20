import {shopeeRequest} from './shopee-direct.ts';

const text = (value: unknown) => String(value ?? '').trim();
export const isShopeeCard = (body: Record<string, any>) => ['order', 'product'].includes(body.message_type);
export class CardError extends Error {
  status: number;
  constructor(message: string, status = 422) { super(message); this.status = status; }
}

// Only trusted, shop-scoped DB snapshots supply the displayed card. Browser fields never set its recipient.
export async function resolveShopeeCard(db: any, body: Record<string, any>, conversation: any, order: any) {
  const shop = text(conversation.metadata?.shop_id);
  if (body.message_type === 'order') {
    if (!order || order.source_channel !== 'shopee' || text(order.shop_id) !== shop)
      throw new CardError('Pilih order Shopee daripada kedai chat ini.');
    const orderNo = text(order.order_no);
    if (!/^[A-Z0-9]{10,32}$/.test(orderNo)) throw new CardError('Order ID tidak sah.');
    const first = Array.isArray(order.items) ? order.items[0] : null;
    return {type: 'order', content: {order_sn: orderNo}, preview: `[Order #${orderNo}]`,
      metadata: {shop_id: shop, order_sn: orderNo, title: `Order #${orderNo}`,
        order_status: order.order_status, image_url: first?.image_url || null}};
  }
  if (!/^[0-9a-f-]{36}$/i.test(text(body.product_id))) throw new CardError('Pilih produk daripada katalog iCetak.');
  const {data: product, error} = await db.from('product_catalog_cache')
    .select('id,name,image_url,price,currency,product_url,metadata,external_product_id')
    .eq('id', body.product_id).eq('source_project', 'icetak-order-system')
    .eq('source_channel', 'shopee').eq('active', true).eq('metadata->>shop_id', shop).maybeSingle();
  if (error || !product) throw new CardError('Produk tidak tersedia dalam katalog kedai chat ini.');
  const item = text(product.metadata?.item_id);
  if (!/^[1-9]\d{0,14}$/.test(item) || !Number.isSafeInteger(Number(item)) || product.external_product_id !== `${shop}:${item}`)
    throw new CardError('Identiti produk belum disahkan.');
  return {type: 'product', content: {item_id: Number(item)}, preview: `[Product ${shop}:${item}]`,
    metadata: {shop_id: shop, item_id: item, product_name: product.name, image_url: product.image_url,
      catalog_price: product.price, currency: product.currency, product_url: product.product_url}};
}

export async function verifyShopeeCard(config: any, card: any, buyer: string) {
  if (card.type === 'order') {
    const response = await shopeeRequest(config, '/api/v2/order/get_order_detail', {
      order_sn_list: card.content.order_sn, response_optional_fields: 'buyer_user_id,buyer_username',
    }, 'GET');
    const body = await response.json();
    const order = body.response?.order_list?.find((row: any) => text(row.order_sn) === card.content.order_sn);
    if (!response.ok || body.error || body.error_code || !order || text(order.buyer_user_id) !== buyer)
      throw new CardError('Shopee tidak dapat mengesahkan order ini milik buyer dalam chat. Tiada kad dihantar.');
  } else {
    const response = await shopeeRequest(config, '/api/v2/product/get_item_base_info', {
      item_id_list: String(card.content.item_id),
    }, 'GET');
    const body = await response.json();
    const item = body.response?.item_list?.find((row: any) => text(row.item_id) === String(card.content.item_id));
    if (!response.ok || body.error || body.error_code || !item || item.item_status !== 'NORMAL')
      throw new CardError('Produk tidak aktif atau belum dapat disahkan di Shopee. Tiada kad dihantar.');
    if (text(item.item_name)) card.metadata.product_name = text(item.item_name);
  }
}
