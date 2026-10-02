import { supabase } from './supabase';
import { normalizePhone } from './googleContactCache';

export interface MarketplaceOrderItem {
  provider_item_id?: string | null;
  provider_variation_id?: string | null;
  item_sku?: string | null;
  variation_sku?: string | null;
  title?: string | null;
  variation_name?: string | null;
  quantity?: number | null;
  unit_original_price?: number | null;
  unit_discounted_price?: number | null;
  line_subtotal?: number | null;
  image_url?: string | null;
}

export interface ExternalOrderSummary {
  id: string;
  source_project: string;
  source_channel: string;
  external_order_id?: string | null;
  order_system_order_id?: string | null;
  order_system_customer_id?: string | null;
  order_no: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_phone_normalized?: string | null;
  shopee_username?: string | null;
  shopee_buyer_id?: string | null;
  payment_status?: string | null;
  order_status?: string | null;
  admin_status?: string | null;
  delivery_method?: string | null;
  date_need?: string | null;
  ship_by_at?: string | null;
  shipped_at?: string | null;
  active_order: boolean;
  priority_level: string;
  priority_reason?: string | null;
  public_order_url?: string | null;
  clickup_url?: string | null;
  items: MarketplaceOrderItem[];
  payment_total?: number | null;
  paid_amount?: number | null;
  balance_amount?: number | null;
  shipment_status?: string | null;
  tracking_no?: string | null;
  tracking_link?: string | null;
  order_updated_at?: string | null;
  source_payload_version?: string | null;
  region?: string | null;
  shop_id?: string | null;
  buyer_shop_id?: string | null;
  delivery_address?: string | null;
  buyer_message?: string | null;
  placed_at?: string | null;
  courier_name?: string | null;
  currency?: string | null;
  detail_complete: boolean;
  item_count: number;
  shipping_fee?: number | null;
  payment_method?: string | null;
  fulfillment_status?: string | null;
  package_number?: string | null;
  metadata?: Record<string, unknown> | null;
  last_synced_at: string;
}

const fields = '*';

export async function getExternalOrderSummary(id: string) {
  const { data, error } = await supabase.from('external_order_summaries').select(fields).eq('id', id).single();
  if (error) throw error;
  return data as ExternalOrderSummary;
}

export async function listExternalOrderSummaries(query = '', mode: 'active' | 'urgent' | 'all' | 'no_phone' = 'active') {
  let builder = supabase.from('external_order_summaries').select(fields)
    .order('priority_level', { ascending: true })
    .order('ship_by_at', { ascending: true, nullsFirst: false })
    .order('last_synced_at', { ascending: false }).limit(300);

  if (mode !== 'all') builder = builder.eq('active_order', true);
  if (mode === 'urgent') builder = builder.in('priority_level', ['P0', 'P1', 'P2']);
  if (mode === 'no_phone') builder = builder.is('customer_phone_normalized', null);

  const trimmed = query.trim();
  if (trimmed) {
    const normalized = normalizePhone(trimmed);
    const like = `%${trimmed}%`;
    const phoneLike = `%${normalized || trimmed}%`;
    builder = builder.or(`order_no.ilike.${like},customer_name.ilike.${like},customer_phone.ilike.${like},customer_phone_normalized.ilike.${phoneLike},shopee_username.ilike.${like},shopee_buyer_id.ilike.${like},buyer_message.ilike.${like}`);
  }

  const { data, error } = await builder;
  if (error) throw error;
  return (data ?? []) as ExternalOrderSummary[];
}


export async function findExternalOrderConversationId(order: ExternalOrderSummary): Promise<string | null> {
  const { data, error } = await supabase
    .from('conversation_order_links')
    .select('conversation_id,is_primary,linked_at')
    .eq('source_project', order.source_project)
    .eq('order_no', order.order_no)
    .is('unlinked_at', null)
    .order('is_primary', { ascending: false })
    .order('linked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('Unable to resolve linked conversation for order', error.message);
    return null;
  }
  return data?.conversation_id ? String(data.conversation_id) : null;
}

