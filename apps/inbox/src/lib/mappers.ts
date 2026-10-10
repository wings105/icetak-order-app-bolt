import { Conversation, Message, Customer, ShopeeOrder, ConversationStatus } from '../types';
import { DbConversation, DbMessage, DbOrder, DbCustomer, DbCustomerIdentity, DbCustomerAddress, DbOrderItem, DbClickupTaskLink } from './dbTypes';

function mapMsgStatus(status: string): Message['status'] {
  if (status === 'pending' || status === 'failed' || status === 'unknown') return status;
  if (status === 'read') return 'read';
  if (status === 'delivered') return 'delivered';
  if (status === 'sent') return 'sent';
  return undefined;
}

export function mapMessage(row: DbMessage): Message {
  return {
    id: row.id,
    content: row.text_content ?? '',
    direction: row.direction,
    timestamp: new Date(row.created_at),
    status: row.direction === 'outbound' ? mapMsgStatus(row.status) : undefined,
    messageType: row.message_type,
    mediaUrl: row.media_url ?? undefined,
    providerMessageId: row.provider_message_id ?? undefined,
    replyToProviderMessageId: row.reply_to_provider_message_id ?? undefined,
    ...(row.reactions ? { reactions: row.reactions } : {}),
  } as Message;
}

const ORDER_STATUS_MAP: Record<string, ConversationStatus> = {
  'Menunggu Balasan': 'Menunggu Balasan',
  'Design Belum Siap': 'Design Belum Siap',
  'Menunggu Approval': 'Menunggu Approval',
  'Approved': 'Approved',
  'Perlu Edit': 'Perlu Edit',
  'Dah Bayar': 'Dah Bayar',
  'Perlu Pos Hari Ini': 'Perlu Pos Hari Ini',
  'Selesai': 'Selesai',
  'Gagal': 'Gagal',
};

function resolveOrderStatus(order: DbOrder | null): ConversationStatus {
  if (!order) return 'Menunggu Balasan';
  const mapped = ORDER_STATUS_MAP[order.order_status];
  return mapped ?? 'Menunggu Balasan';
}

export function mapCustomer(dbCustomer: DbCustomer, identities: DbCustomerIdentity[], addresses: DbCustomerAddress[], channel: 'whatsapp' | 'shopee'): Customer {
  const waIdentity = identities.find((i) => i.channel === 'whatsapp');
  const shopeeIdentity = identities.find((i) => i.channel === 'shopee');
  const defaultAddr = addresses.find((a) => a.is_default) ?? addresses[0];
  return {
    id: dbCustomer.id,
    name: dbCustomer.display_name,
    phone: waIdentity?.normalized_phone ?? undefined,
    email: dbCustomer.email ?? undefined,
    address: defaultAddr?.address_line_1,
    postcode: defaultAddr?.postcode,
    city: defaultAddr?.city,
    state: defaultAddr?.state,
    notes: dbCustomer.notes ?? undefined,
    shopeeUsername: channel === 'shopee' ? (shopeeIdentity?.username ?? undefined) : undefined,
    tags: [],
  };
}

export function mapShopeeOrder(order: DbOrder, item: DbOrderItem | undefined): ShopeeOrder {
  const meta = order.metadata as Record<string, string>;
  const shipBy = order.ship_by_at ? new Date(order.ship_by_at).toLocaleDateString('ms-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const paidAt = order.paid_at ? new Date(order.paid_at).toLocaleString('ms-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  return {
    orderId: order.external_order_id ?? order.internal_order_number ?? order.id.slice(0, 12),
    product: item?.product_name ?? '—',
    variation: item?.variation ?? '—',
    totalPayment: `RM${Number(order.total_amount).toFixed(2)}`,
    paidTime: paidAt,
    shipByDate: shipBy,
    trackingNumber: meta.tracking_number || undefined,
    orderStatus: meta.shopee_order_status ?? order.order_status,
  };
}

export interface ConversationDetail {
  dbConv: DbConversation;
  identities: DbCustomerIdentity[];
  addresses: DbCustomerAddress[];
  items: DbOrderItem[];
  clickup: DbClickupTaskLink[];
}

export function mapConversation(detail: ConversationDetail, messages: DbMessage[]): Conversation {
  const { dbConv, identities, addresses, items } = detail;
  const customer = dbConv.customers ? mapCustomer(dbConv.customers, identities, addresses, dbConv.channel) : { id: dbConv.customer_id ?? dbConv.id, name: dbConv.external_customer_id ?? 'Unknown' };
  const mappedMessages = messages.map(mapMessage);
  const firstItem = items[0];
  return {
    id: dbConv.id,
    channel: dbConv.channel,
    customer,
    messages: mappedMessages,
    isArchived: dbConv.archived,
    isUrgent: dbConv.priority === 'urgent',
    unreadCount: dbConv.unread_count,
    lastInboundAt: dbConv.last_inbound_at ? new Date(dbConv.last_inbound_at) : undefined,
    lastMessageAt: dbConv.last_message_at ? new Date(dbConv.last_message_at) : undefined,
    orderStatus: resolveOrderStatus(dbConv.orders),
    shopeeOrder: dbConv.channel === 'shopee' && dbConv.orders ? mapShopeeOrder(dbConv.orders, firstItem) : undefined,
    needsReply: dbConv.needs_reply,
    lastMessageSender: dbConv.last_message_sender as Conversation['lastMessageSender'],
    orderId: dbConv.orders?.external_order_id ?? dbConv.orders?.internal_order_number ?? undefined,
    metadata: dbConv.metadata,
    externalCustomerId: dbConv.external_customer_id ?? undefined,
    aiPriorityScore: Number(dbConv.ai_priority_score ?? 0),
    aiRemark: dbConv.ai_remark ?? undefined,
    aiPaymentStatus: dbConv.ai_payment_status ?? undefined,
    aiIntent: dbConv.ai_intent ?? undefined,
    aiUrgency: dbConv.ai_urgency ?? undefined,
    aiDueDate: dbConv.ai_due_date ?? undefined,
    aiConfidence: dbConv.ai_confidence == null ? undefined : Number(dbConv.ai_confidence),
    aiAnalysisStatus: dbConv.ai_analysis_status ?? undefined,
    aiAnalysisVersion: dbConv.ai_analysis_version ?? undefined,
  };
}
