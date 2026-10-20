import {supabase} from './supabase';
import type {Message} from '../types';

export interface ShopeeCatalogProduct {
  id: string; name: string; image_url: string | null; price: number | null;
  max_price: number | null; currency: string; product_url: string | null;
  shop_id: string; item_id: string; last_synced_at: string;
}
export type CardSelection =
  | {type: 'order'; id: string; title: string; orderNo: string; image?: string}
  | {type: 'product'; id: string; title: string; image?: string; itemId: string};

export async function searchShopeeProducts(conversationId: string, query: string, offset: number, signal: AbortSignal) {
  const {data, error} = await supabase.rpc('icetak_inbox_shopee_product_search', {
    p_conversation_id: conversationId, p_query: query, p_offset: offset, p_limit: 20,
  }).abortSignal(signal);
  if (error) throw new Error('Carian produk gagal. Cuba semula.');
  return data as {items: ShopeeCatalogProduct[]; total: number; shop_id: string};
}

export class CardSendError extends Error {
  uncertain: boolean;
  constructor(message: string, uncertain = false) {super(message); this.uncertain = uncertain;}
}

export async function sendShopeeCard(conversationId: string, selection: CardSelection, requestId: string): Promise<Message & {sendWarning?: string}> {
  const {data: {session}, error} = await supabase.auth.getSession();
  if (error || !session) throw new CardSendError('Sila log masuk sebagai staf iCetak.');
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/shopee-chat-send`, {
      method: 'POST', headers: {Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({request_id: requestId, conversation_id: conversationId, message_type: selection.type,
        ...(selection.type === 'order' ? {order_summary_id: selection.id} : {product_id: selection.id})}),
    });
  } catch { throw new CardSendError('Status penghantaran belum pasti. Semak chat Shopee sebelum menghantar semula.', true); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true)
    throw new CardSendError(String(payload.error || 'Kad belum dapat dihantar. Semak chat Shopee.'),
      payload.status === 'unknown' || payload.status === 'sending' || (response.status >= 500 && !payload.status));
  return {id: payload.local_message_id, content: selection.type === 'order' ? `[Order #${selection.orderNo}]` : `[Product ${selection.itemId}]`,
    direction: 'outbound', timestamp: new Date(), status: 'sent', messageType: 'text', providerMessageType: selection.type,
    providerMessageId: payload.provider_message_id, mediaMetadata: payload.card,
    sendWarning: [payload.read_warning, payload.warning].filter(Boolean).join(' ') || undefined};
}
