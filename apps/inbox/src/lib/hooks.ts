import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from './supabase';
import { Conversation, Message, SearchResult } from '../types';
import {
  DbConversation, DbMessage,
  DbCustomerIdentity, DbCustomerAddress, DbOrderItem,
} from './dbTypes';
import { mapConversation, mapMessage, ConversationDetail } from './mappers';

const CONVERSATION_LIST_SELECT = `
  id, customer_id, order_id, channel, external_customer_id, priority,
  last_message_at, last_inbound_at, last_message_sender, unread_count,
  needs_reply, archived, metadata, ai_analysis_status, ai_analysis_version,
  ai_priority_score, ai_remark, ai_confidence, ai_payment_status, ai_intent,
  ai_urgency, ai_due_date,
  customers (id, display_name, email, notes),
  orders (
    id, external_order_id, internal_order_number, order_status, total_amount,
    ship_by_at, paid_at, metadata
  )
`;

const MESSAGE_SELECT = [
  'id', 'conversation_id', 'direction', 'message_type', 'text_content',
  'created_at', 'status', 'media_url', 'provider_message_id',
  'reply_to_provider_message_id', 'reactions',
].join(', ');

// ── Phone normalization ───────────────────────────────────────────────────────
// Strip all non-digit characters from a phone string.
export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}

// Returns all digit-normalized variants of a search query:
//   "012-376 1892"  →  ["0123761892", "60123761892"]
//   "+60123761892"  →  ["60123761892", "0123761892"]
//   "60123761892"   →  ["60123761892", "0123761892"]
export function phoneSearchVariants(raw: string): string[] {
  const digits = digitsOnly(raw);
  if (digits.length < 7) return [digits];
  const variants = new Set<string>([digits]);
  if (digits.startsWith('60')) {
    variants.add('0' + digits.slice(2));
  } else if (digits.startsWith('0')) {
    variants.add('60' + digits.slice(1));
  }
  return [...variants];
}

// ── useConversations ──────────────────────────────────────────────────────────

export interface UseConversationsResult {
  conversations: Conversation[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useConversations(): UseConversationsResult {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedOnceRef = useRef(false);

  const load = useCallback(async () => {
    if (!loadedOnceRef.current) setLoading(true);
    setError(null);

    try {
      const { data: convRows, error: convErr } = await supabase
        .from('conversations')
        .select(CONVERSATION_LIST_SELECT)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (convErr) throw convErr;
      if (!convRows || convRows.length === 0) { setConversations([]); return; }

      // The projected columns were verified against the mapper's runtime needs.
      const dbConversations = convRows as unknown as DbConversation[];

      const customerIds = [...new Set(
        dbConversations.map((c) => c.customer_id).filter(Boolean) as string[],
      )];
      const orderIds = [...new Set(
        dbConversations.map((c) => c.order_id).filter(Boolean) as string[],
      )];

      const convIds = dbConversations.map((c) => c.id);

      const [identitiesRes, addressesRes, itemsRes, latestMsgsRes] = await Promise.all([
        customerIds.length > 0
          ? supabase.from('customer_identities').select('customer_id, channel, username, normalized_phone').in('customer_id', customerIds)
          : Promise.resolve({ data: [], error: null }),
        customerIds.length > 0
          ? supabase.from('customer_addresses').select('customer_id, address_line_1, postcode, city, state, is_default').in('customer_id', customerIds)
          : Promise.resolve({ data: [], error: null }),
        orderIds.length > 0
          ? supabase.from('order_items').select('order_id, product_name, variation').in('order_id', orderIds)
          : Promise.resolve({ data: [], error: null }),
        // One indexed row per conversation. Avoid downloading the full message table
        // every time Realtime refreshes the inbox list.
        supabase
          .from('latest_conversation_message_previews')
          .select('id, conversation_id, direction, message_type, text_content, created_at, status, media_url, provider_message_id, reply_to_provider_message_id, reactions')
          .in('conversation_id', convIds),
      ]);

      // These enrichments are optional. The inbox can still load conversations
      // when a secondary request is unavailable.
      const identities = (identitiesRes.data ?? []) as DbCustomerIdentity[];
      const addresses  = (addressesRes.data ?? []) as DbCustomerAddress[];
      const items      = (itemsRes.data ?? []) as DbOrderItem[];

      // Deduplicate: keep only the first (most recent) message per conversation_id
      const latestMsgByConvId = new Map<string, DbMessage>();
      for (const row of (latestMsgsRes.data ?? []) as DbMessage[]) {
        if (!latestMsgByConvId.has(row.conversation_id)) {
          latestMsgByConvId.set(row.conversation_id, row);
        }
      }

      const mapped = dbConversations.map((dbConv) => {
        const detail: ConversationDetail = {
          dbConv,
          identities: identities.filter((i) => i.customer_id === dbConv.customer_id),
          addresses:  addresses.filter((a) => a.customer_id === dbConv.customer_id),
          items:      items.filter((it) => it.order_id === dbConv.order_id),
          clickup:    [],
        };
        const latestMsg = latestMsgByConvId.get(dbConv.id);
        return mapConversation(detail, latestMsg ? [latestMsg] : []);
      });

      setConversations(mapped);
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setError(message);
    } finally {
      loadedOnceRef.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { conversations, loading, error, reload: load };
}

// ── useMessages ───────────────────────────────────────────────────────────────

export interface UseMessagesResult {
  messages: Message[];
  loading: boolean;
  error: string | null;
}

export function useMessages(conversationId: string | null, reloadKey = 0): UseMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedConversationRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!conversationId) { setMessages([]); loadedConversationRef.current = null; return; }
    setLoading(loadedConversationRef.current !== conversationId);
    setError(null);
    const { data, error: err } = await supabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    setMessages(err ? [] : ((data ?? []) as unknown as DbMessage[]).map(mapMessage));
    if (err) setError(err.message);
    if (!err) loadedConversationRef.current = conversationId;
    setLoading(false);
  }, [conversationId]);

  useEffect(() => { load(); }, [load, reloadKey]);

  return { messages, loading, error };
}

// ── useSearch ─────────────────────────────────────────────────────────────────
// Full Supabase search across conversations metadata + message text.
// Returns SearchResult[] (conversation IDs + message hit details).

export interface UseSearchResult {
  results: SearchResult[];
  loading: boolean;
  error: string | null;
}

export function useSearch(rawQuery: string): UseSearchResult {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = rawQuery.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function run() {
      try {
        const { data, error: rpcError } = await supabase.rpc('search_unified_inbox', { p_query: q, p_limit: 60 });
        if (rpcError) throw rpcError;
        if (cancelled) return;
        const mapped = ((data ?? []) as Array<Record<string, unknown>>).map((row): SearchResult => {
          const messageId = row.message_id ? String(row.message_id) : null;
          return {
            resultType: row.result_type === 'order' ? 'order' : 'conversation',
            resultId: String(row.result_id),
            conversationId: row.conversation_id ? String(row.conversation_id) : null,
            orderSummaryId: row.order_summary_id ? String(row.order_summary_id) : null,
            title: String(row.title ?? ''),
            subtitle: String(row.subtitle ?? ''),
            matchedField: String(row.matched_field ?? ''),
            snippet: String(row.snippet ?? ''),
            channel: String(row.channel ?? ''),
            lastActivityAt: row.last_activity_at ? String(row.last_activity_at) : null,
            rank: Number(row.rank ?? 0),
            matchCount: messageId ? 1 : 0,
            messageHits: messageId ? [{
              messageId,
              snippet: String(row.snippet ?? ''),
              direction: 'inbound',
            }] : [],
            metaHits: row.matched_field ? [String(row.matched_field)] : [],
          };
        });
        setResults(mapped);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => { cancelled = true; };
  }, [rawQuery]);

  return { results, loading, error };
}

// ── useMessagesSearch ─────────────────────────────────────────────────────────
// Given a loaded message list and a query, returns the IDs of matching messages
// in order. Used by ChatArea for prev/next navigation.

export function getMatchingMessageIds(messages: Message[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return messages
    .filter((m) => m.content.toLowerCase().includes(q))
    .map((m) => m.id);
}

