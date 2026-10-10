export type MessageStatus = 'pending' | 'failed' | 'unknown' | 'sent' | 'delivered' | 'read';
export type MessageDirection = 'inbound' | 'outbound';
export type WindowStatus = 'open' | 'closing_soon' | 'expired' | 'no_window';
export type Channel = 'whatsapp' | 'shopee';

export interface OrderSessionSnapshot {
  state: 'active' | 'closed' | 'none';
  session_id?: string | null;
  session_status?: string | null;
  opened_at?: string | null;
  closed_at?: string | null;
  closed_reason?: string | null;
  order_no?: string | null;
}

export type FilterType =
  | 'all'
  | 'perlu_balas'
  | 'unread'
  | 'urgent'
  | 'perlu_pos'
  | 'menunggu_customer'
  | 'gagal'
  | 'archived';

export type ConversationStatus =
  | 'Menunggu Balasan'
  | 'Design Belum Siap'
  | 'Menunggu Approval'
  | 'Approved'
  | 'Perlu Edit'
  | 'Dah Bayar'
  | 'Perlu Pos Hari Ini'
  | 'Selesai'
  | 'Gagal';

export interface Message {
  id: string;
  content: string;
  direction: MessageDirection;
  timestamp: Date;
  status?: MessageStatus;
  messageType?: string;
  mediaUrl?: string;
  providerMessageId?: string;
  replyToProviderMessageId?: string;
  reactions?: Record<string, string>;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  address?: string;
  postcode?: string;
  city?: string;
  state?: string;
  tags?: string[];
  notes?: string;
  shopeeUsername?: string;
}

export interface ShopeeOrder {
  orderId: string;
  product: string;
  variation: string;
  totalPayment: string;
  paidTime: string;
  shipByDate: string;
  trackingNumber?: string;
  orderStatus: string;
}

export interface SearchMessageHit {
  messageId: string;
  snippet: string;
  direction: MessageDirection;
}

export interface SearchResult {
  resultType: 'conversation' | 'order';
  resultId: string;
  conversationId: string | null;
  orderSummaryId: string | null;
  title: string;
  subtitle: string;
  matchedField: string;
  snippet: string;
  channel: string;
  lastActivityAt?: string | null;
  rank: number;
  matchCount: number;
  messageHits: SearchMessageHit[];
  metaHits: string[];
}

export interface Conversation {
  id: string;
  channel: Channel;
  customer: Customer;
  messages: Message[];
  isArchived: boolean;
  isUrgent: boolean;
  unreadCount: number;
  lastInboundAt?: Date;
  lastMessageAt?: Date;
  orderStatus: ConversationStatus;
  orderSession?: OrderSessionSnapshot;
  shopeeOrder?: ShopeeOrder;
  externalCustomerId?: string;
  needsReply?: boolean;
  lastMessageSender?: 'customer' | 'seller' | 'system' | null;
  orderId?: string;
  metadata?: Record<string, unknown>;
  aiPriorityScore?: number;
  aiRemark?: string;
  aiPaymentStatus?: 'paid' | 'waiting_payment' | 'unpaid' | 'unknown' | string;
  aiIntent?: string;
  aiUrgency?: 'normal' | 'medium' | 'high' | 'critical' | string;
  aiDueDate?: string;
  aiConfidence?: number;
  aiAnalysisStatus?: string;
  aiAnalysisVersion?: string;
}
