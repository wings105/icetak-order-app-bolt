import { useCallback, useEffect, useState } from 'react';
import type { Conversation } from '../types';
import { normalizePhone } from './googleContactCache';
import { supabase } from './supabase';

export interface WorkspaceIdentity {
  id: string;
  customer_id: string;
  channel: string;
  external_id: string;
  username: string | null;
  normalized_phone: string | null;
  is_verified: boolean;
  match_confidence: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
}

export interface WorkspaceAddress {
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
  updated_at: string;
}

export interface WorkspaceActivity {
  id: string;
  conversation_id: string;
  event_type: string;
  actor_type: 'user' | 'ai' | 'system' | 'external' | 'integration';
  actor_label: string;
  source: string | null;
  summary: string;
  old_value: Record<string, unknown>;
  new_value: Record<string, unknown>;
  metadata: Record<string, unknown>;
  importance: 'low' | 'normal' | 'high' | 'critical';
  created_at: string;
}

export interface WorkspaceOrderSummary {
  id: string;
  source_project: string;
  source_channel: string;
  external_order_id: string | null;
  order_system_order_id: string | null;
  order_no: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_phone_normalized: string | null;
  shopee_username: string | null;
  shopee_buyer_id: string | null;
  payment_status: string | null;
  order_status: string | null;
  admin_status: string | null;
  delivery_method: string | null;
  date_need: string | null;
  ship_by_at: string | null;
  shipped_at: string | null;
  active_order: boolean;
  priority_level: string;
  priority_reason: string | null;
  public_order_url: string | null;
  clickup_url: string | null;
  items: unknown[];
  payment_total: number | null;
  paid_amount: number | null;
  balance_amount: number | null;
  shipment_status: string | null;
  tracking_no: string | null;
  tracking_link: string | null;
  region: string | null;
  shop_id: string | null;
  buyer_shop_id: string | null;
  delivery_address: string | null;
  buyer_message: string | null;
  placed_at: string | null;
  courier_name: string | null;
  currency: string | null;
  detail_complete: boolean;
  item_count: number;
  shipping_fee: number | null;
  payment_method: string | null;
  fulfillment_status: string | null;
  package_number: string | null;
  metadata: Record<string, unknown>;
  last_synced_at: string;
}

export interface WorkspaceOrderLink {
  id: string;
  conversation_id: string;
  source_project: string;
  external_order_id: string | null;
  order_system_order_id: string | null;
  order_no: string;
  is_primary: boolean;
  match_method: string;
  match_confidence: number;
  linked_by_label: string | null;
  linked_at: string;
  metadata: Record<string, unknown>;
  summary: WorkspaceOrderSummary | null;
}

export interface WorkspaceSuggestedOrder extends WorkspaceOrderSummary {
  match_method: string;
  match_confidence: number;
}

export interface WorkspaceRelatedConversation {
  id: string;
  channel: 'whatsapp' | 'shopee';
  status: string;
  priority: string;
  archived: boolean;
  needs_reply: boolean;
  last_message_at: string | null;
}

export interface WorkspaceSnippet {
  id: string;
  shortcut: string;
  title: string;
  message: string;
  category: string | null;
  channel: string;
  usage_context: string | null;
  sort_order: number;
}

export interface WorkspaceProduct {
  id: string;
  source_project: string;
  source_channel: string;
  external_product_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number | null;
  currency: string;
  product_url: string | null;
  metadata: Record<string, unknown>;
}

export interface ConversationWorkspaceData {
  identities: WorkspaceIdentity[];
  addresses: WorkspaceAddress[];
  activities: WorkspaceActivity[];
  linkedOrders: WorkspaceOrderLink[];
  suggestedOrders: WorkspaceSuggestedOrder[];
  relatedConversations: WorkspaceRelatedConversation[];
  snippets: WorkspaceSnippet[];
  products: WorkspaceProduct[];
}

const EMPTY_WORKSPACE: ConversationWorkspaceData = {
  identities: [],
  addresses: [],
  activities: [],
  linkedOrders: [],
  suggestedOrders: [],
  relatedConversations: [],
  snippets: [],
  products: [],
};

interface UseConversationWorkspaceResult {
  data: ConversationWorkspaceData;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

function orderKey(order: Pick<WorkspaceOrderSummary, 'source_project' | 'order_no'>): string {
  return `${order.source_project}::${order.order_no}`;
}

function uniqueOrders(rows: WorkspaceSuggestedOrder[]): WorkspaceSuggestedOrder[] {
  const byKey = new Map<string, WorkspaceSuggestedOrder>();
  for (const row of rows) {
    const key = orderKey(row);
    const current = byKey.get(key);
    if (!current || row.match_confidence > current.match_confidence) byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.active_order !== b.active_order) return Number(b.active_order) - Number(a.active_order);
    const aDate = a.date_need ? Date.parse(a.date_need) : Number.MAX_SAFE_INTEGER;
    const bDate = b.date_need ? Date.parse(b.date_need) : Number.MAX_SAFE_INTEGER;
    return aDate - bDate;
  });
}

export function useConversationWorkspace(conversation: Conversation | null): UseConversationWorkspaceResult {
  const [data, setData] = useState<ConversationWorkspaceData>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conversationId = conversation?.id ?? null;
  const customerId = conversation?.customer.id ?? null;
  const channel = conversation?.channel ?? null;
  const phone = normalizePhone(conversation?.customer.phone ?? '');
  const shopeeUsername = conversation?.customer.shopeeUsername ?? null;

  const load = useCallback(async () => {
    if (!conversationId || !customerId || !channel) {
      setData(EMPTY_WORKSPACE);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await supabase.rpc('ensure_workspace_member');

      const [activityRes, linkRes, identityRes, addressRes, relatedRes, snippetRes, productRes] = await Promise.all([
        supabase
          .from('conversation_activity_logs')
          .select('*')
          .eq('conversation_id', conversationId)
          .eq('hidden', false)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('conversation_order_links')
          .select('*')
          .eq('conversation_id', conversationId)
          .is('unlinked_at', null)
          .order('is_primary', { ascending: false })
          .order('linked_at', { ascending: false }),
        supabase
          .from('customer_identities')
          .select('*')
          .eq('customer_id', customerId)
          .order('is_verified', { ascending: false })
          .order('updated_at', { ascending: false }),
        supabase
          .from('customer_addresses')
          .select('*')
          .eq('customer_id', customerId)
          .order('is_default', { ascending: false })
          .order('updated_at', { ascending: false }),
        supabase
          .from('conversations')
          .select('id,channel,status,priority,archived,needs_reply,last_message_at')
          .eq('customer_id', customerId)
          .neq('id', conversationId)
          .order('archived', { ascending: true })
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(20),
        supabase
          .from('quick_snippets')
          .select('id,shortcut,title,message,category,channel,usage_context,sort_order')
          .eq('active', true)
          .in('channel', ['all', channel])
          .order('sort_order')
          .order('title'),
        supabase
          .from('product_catalog_cache')
          .select('*')
          .eq('active', true)
          .in('source_channel', ['all', channel])
          .order('name')
          .limit(30),
      ]);

      const initialErrors = [activityRes.error, linkRes.error, identityRes.error, addressRes.error, relatedRes.error, snippetRes.error, productRes.error]
        .filter((value): value is NonNullable<typeof value> => Boolean(value));
      if (initialErrors.length > 0) throw initialErrors[0];

      const links = (linkRes.data ?? []) as Omit<WorkspaceOrderLink, 'summary'>[];
      const identities = (identityRes.data ?? []) as WorkspaceIdentity[];
      const linkedOrderNumbers = [...new Set(links.map((link) => link.order_no).filter(Boolean))];

      const buyerId = identities.find((identity) => identity.channel === 'shopee')?.external_id ?? null;
      const username = identities.find((identity) => identity.channel === 'shopee' && identity.username)?.username ?? shopeeUsername;

      const [linkedSummaryRes, phoneOrderRes, usernameOrderRes, buyerOrderRes] = await Promise.all([
        linkedOrderNumbers.length > 0
          ? supabase.from('external_order_summaries').select('*').in('order_no', linkedOrderNumbers)
          : Promise.resolve({ data: [], error: null }),
        phone
          ? supabase.from('external_order_summaries').select('*').eq('customer_phone_normalized', phone).order('last_synced_at', { ascending: false }).limit(20)
          : Promise.resolve({ data: [], error: null }),
        username
          ? supabase.from('external_order_summaries').select('*').eq('shopee_username', username).order('last_synced_at', { ascending: false }).limit(20)
          : Promise.resolve({ data: [], error: null }),
        buyerId
          ? supabase.from('external_order_summaries').select('*').eq('shopee_buyer_id', buyerId).order('last_synced_at', { ascending: false }).limit(20)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const orderErrors = [linkedSummaryRes.error, phoneOrderRes.error, usernameOrderRes.error, buyerOrderRes.error]
        .filter((value): value is NonNullable<typeof value> => Boolean(value));
      if (orderErrors.length > 0) throw orderErrors[0];

      const linkedSummaries = (linkedSummaryRes.data ?? []) as WorkspaceOrderSummary[];
      const linkedSummaryMap = new Map(linkedSummaries.map((row) => [orderKey(row), row]));
      const linkedOrders: WorkspaceOrderLink[] = links.map((link) => ({
        ...link,
        match_confidence: Number(link.match_confidence),
        summary: linkedSummaryMap.get(`${link.source_project}::${link.order_no}`) ?? null,
      }));
      const linkedKeys = new Set(linkedOrders.map((link) => `${link.source_project}::${link.order_no}`));

      const suggestedRows: WorkspaceSuggestedOrder[] = [
        ...((phoneOrderRes.data ?? []) as WorkspaceOrderSummary[]).map((row) => ({ ...row, match_method: 'phone', match_confidence: 0.9 })),
        ...((usernameOrderRes.data ?? []) as WorkspaceOrderSummary[]).map((row) => ({ ...row, match_method: 'username', match_confidence: 0.85 })),
        ...((buyerOrderRes.data ?? []) as WorkspaceOrderSummary[]).map((row) => ({ ...row, match_method: 'buyer_id', match_confidence: 0.98 })),
      ].filter((row) => !linkedKeys.has(orderKey(row)));

      setData({
        identities,
        addresses: (addressRes.data ?? []) as WorkspaceAddress[],
        activities: (activityRes.data ?? []) as WorkspaceActivity[],
        linkedOrders,
        suggestedOrders: uniqueOrders(suggestedRows),
        relatedConversations: (relatedRes.data ?? []) as WorkspaceRelatedConversation[],
        snippets: (snippetRes.data ?? []) as WorkspaceSnippet[],
        products: (productRes.data ?? []) as WorkspaceProduct[],
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [channel, conversationId, customerId, phone, shopeeUsername]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!conversationId || !customerId) return;
    const realtime = supabase
      .channel(`conversation-workspace-${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_activity_logs', filter: `conversation_id=eq.${conversationId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_order_links', filter: `conversation_id=eq.${conversationId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers', filter: `id=eq.${customerId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_addresses', filter: `customer_id=eq.${customerId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'external_order_summaries' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(realtime); };
  }, [conversationId, customerId, load]);

  return { data, loading, error, reload: load };
}

export async function linkWorkspaceOrder(conversationId: string, order: WorkspaceSuggestedOrder, isPrimary = true): Promise<void> {
  const { error } = await supabase.rpc('link_conversation_order', {
    p_conversation_id: conversationId,
    p_source_project: order.source_project,
    p_order_no: order.order_no,
    p_external_order_id: order.external_order_id,
    p_order_system_order_id: order.order_system_order_id,
    p_is_primary: isPrimary,
    p_match_method: order.match_method,
    p_match_confidence: order.match_confidence,
    p_metadata: {},
  });
  if (error) throw new Error(error.message);
}

export async function unlinkWorkspaceOrder(linkId: string): Promise<void> {
  const { error } = await supabase.rpc('unlink_conversation_order', { p_link_id: linkId });
  if (error) throw new Error(error.message);
}

export async function setPrimaryWorkspaceOrder(linkId: string): Promise<void> {
  const { error } = await supabase.rpc('set_primary_conversation_order', { p_link_id: linkId });
  if (error) throw new Error(error.message);
}

export async function updateWorkspaceCustomer(conversationId: string, displayName: string, email: string, notes: string): Promise<void> {
  const { error } = await supabase.rpc('update_customer_from_conversation', {
    p_conversation_id: conversationId,
    p_display_name: displayName,
    p_email: email,
    p_notes: notes,
  });
  if (error) throw new Error(error.message);
}

export async function updateWorkspaceAddress(conversationId: string, address: Omit<WorkspaceAddress, 'id' | 'customer_id' | 'normalized_phone' | 'is_default' | 'updated_at'>): Promise<void> {
  const { error } = await supabase.rpc('upsert_conversation_customer_address', {
    p_conversation_id: conversationId,
    p_recipient_name: address.recipient_name,
    p_address_line_1: address.address_line_1,
    p_address_line_2: address.address_line_2,
    p_postcode: address.postcode,
    p_city: address.city,
    p_state: address.state,
    p_country: address.country,
  });
  if (error) throw new Error(error.message);
}

export async function recordWorkspaceAction(conversationId: string, eventType: string, summary: string, metadata: Record<string, unknown> = {}): Promise<void> {
  const { error } = await supabase.rpc('record_conversation_user_activity', {
    p_conversation_id: conversationId,
    p_event_type: eventType,
    p_summary: summary,
    p_source: 'sidebar',
    p_metadata: metadata,
  });
  if (error) throw new Error(error.message);
}

export function applyWorkspaceVariables(template: string, conversation: Conversation, order?: WorkspaceOrderSummary | null): string {
  const replacements: Record<string, string> = {
    customer_name: conversation.customer.name ?? '',
    phone: conversation.customer.phone ?? '',
    order_no: order?.order_no ?? conversation.orderId ?? '',
    order_id: order?.external_order_id ?? order?.order_no ?? conversation.orderId ?? '',
    date_need: order?.date_need ?? conversation.aiDueDate ?? '',
    tracking_no: order?.tracking_no ?? '',
    balance: order?.balance_amount == null ? '' : `RM${Number(order.balance_amount).toFixed(2)}`,
    total: order?.payment_total == null ? '' : `RM${Number(order.payment_total).toFixed(2)}`,
  };
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => replacements[key] ?? '');
}

export function buildWorkspaceOrderCard(order: WorkspaceOrderSummary): string {
  const lines = [`Order #${order.order_no}`];
  const itemNames = Array.isArray(order.items)
    ? order.items
        .map((item) => {
          if (!item || typeof item !== 'object') return '';
          const record = item as Record<string, unknown>;
          return String(record.product_name ?? record.name ?? record.title ?? '').trim();
        })
        .filter(Boolean)
        .slice(0, 4)
    : [];
  if (itemNames.length > 0) lines.push(itemNames.join(', '));
  if (order.payment_total != null) lines.push(`Jumlah: RM${Number(order.payment_total).toFixed(2)}`);
  if (order.payment_status) lines.push(`Bayaran: ${order.payment_status}`);
  if (order.order_status) lines.push(`Status: ${order.order_status}`);
  if (order.date_need) lines.push(`Tarikh perlu: ${order.date_need}`);
  if (order.tracking_no) lines.push(`Tracking: ${order.tracking_no}`);
  if (order.public_order_url) lines.push(order.public_order_url);
  return lines.join('\n');
}

