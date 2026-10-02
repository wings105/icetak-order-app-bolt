// Raw Supabase row shapes — snake_case from the database
export interface DbCustomer {
  id: string;
  display_name: string;
  email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbCustomerIdentity {
  id: string;
  customer_id: string;
  channel: 'whatsapp' | 'shopee' | 'direct' | 'other';
  external_id: string;
  username: string | null;
  normalized_phone: string | null;
  is_verified: boolean;
  match_confidence: string | null;
  metadata: Record<string, unknown>;
}

export interface DbCustomerAddress {
  id: string;
  customer_id: string;
  recipient_name: string;
  normalized_phone: string | null;
  address_line_1: string;
  address_line_2: string | null;
  postcode: string;
  city: string;
  state: string;
  country: string;
  is_default: boolean;
  is_verified: boolean;
  verified_at: string | null;
}

export interface DbOrder {
  id: string;
  customer_id: string | null;
  source_channel: string;
  external_order_id: string | null;
  internal_order_number: string | null;
  order_status: string;
  work_status: string | null;
  payment_status: string;
  currency: string;
  subtotal: number;
  shipping_amount: number;
  total_amount: number;
  delivery_address_id: string | null;
  date_needed: string | null;
  ship_by_at: string | null;
  paid_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbOrderItem {
  id: string;
  order_id: string;
  product_type: string | null;
  product_name: string;
  sku: string | null;
  variation: string | null;
  quantity: number;
  unit_price: number;
  wording: string | null;
  design_details: Record<string, unknown>;
  required_details: Record<string, unknown>;
  missing_details: Record<string, unknown>;
}

export interface DbConversation {
  id: string;
  customer_id: string | null;
  order_id: string | null;
  channel: 'whatsapp' | 'shopee';
  external_conversation_id: string;
  external_customer_id: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_message_sender: string | null;
  unread_count: number;
  needs_reply: boolean;
  archived: boolean;
  ai_analysis_required: boolean;
  last_ai_analysis_at: string | null;
  ai_analysis_status: string;
  ai_analysis_version: string | null;
  ai_priority_score: number;
  ai_remark: string | null;
  ai_confidence: number | null;
  ai_payment_status: string | null;
  ai_intent: string | null;
  ai_urgency: string | null;
  ai_due_date: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  customers: DbCustomer | null;
  orders: DbOrder | null;
}

export interface DbMessage {
  id: string;
  conversation_id: string;
  order_id: string | null;
  channel: string;
  provider_message_id: string | null;
  reply_to_provider_message_id: string | null;
  direction: 'inbound' | 'outbound';
  sender_type: 'customer' | 'seller' | 'system';
  message_type: string;
  text_content: string | null;
  media_url: string | null;
  reactions?: Record<string, string> | null;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  created_at: string;
}

export interface DbClickupTaskLink {
  id: string;
  order_id: string;
  clickup_task_id: string;
  clickup_list_id: string | null;
  clickup_space_id: string | null;
  clickup_folder_id: string | null;
  clickup_status: string | null;
  clickup_url: string | null;
  synced_at: string | null;
  metadata: Record<string, unknown>;
}

