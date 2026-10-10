import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Conversation, FilterType, Channel, SearchResult } from '../types';
import { ConversationItem } from './ConversationItem';
import { Search, X, Cake, Loader2, Package } from 'lucide-react';
import { digitsOnly, phoneSearchVariants, useSearch } from '../lib/hooks';
import { ChannelBadge } from './ChannelBadge';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  selectedOrderId: string | null;
  onSelect: (id: string, firstMatchMessageId?: string) => void;
  onOrderSelect: (orderSummaryId: string, conversationId?: string | null) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'perlu_balas',       label: 'Perlu Balas' },
  { key: 'all',               label: 'Semua' },
  { key: 'unread',            label: 'Belum Baca' },
  { key: 'urgent',            label: 'Urgent' },
  { key: 'perlu_pos',         label: 'Perlu Pos' },
  { key: 'menunggu_customer', label: 'Menunggu Customer' },
  { key: 'gagal',             label: 'Gagal' },
  { key: 'archived',          label: 'Arkib' },
];

const CHANNEL_FILTERS: { key: Channel | 'all'; label: string }[] = [
  { key: 'all',      label: 'Semua Channel' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'shopee',   label: 'Shopee' },
];

function matchesNeedsReply(c: Conversation): boolean {
  if (typeof c.needsReply === 'boolean') return c.needsReply;
  if (c.messages.length === 0) return false;
  return c.messages[c.messages.length - 1].direction === 'inbound';
}

function matchesWaitingForCustomer(c: Conversation): boolean {
  if (c.lastMessageSender === 'seller') return true;
  if (c.lastMessageSender === 'customer') return false;
  if (c.messages.length === 0) return false;
  return c.messages[c.messages.length - 1].direction === 'outbound';
}

function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function localConversationMatches(conversation: Conversation, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return false;

  const searchableText = [
    conversation.customer.name,
    conversation.customer.email,
    conversation.customer.phone,
    conversation.customer.company,
    conversation.customer.address,
    conversation.customer.postcode,
    conversation.customer.city,
    conversation.customer.state,
    conversation.customer.shopeeUsername,
    conversation.orderId,
    conversation.shopeeOrder?.orderId,
    conversation.shopeeOrder?.product,
    conversation.shopeeOrder?.variation,
    conversation.messages[conversation.messages.length - 1]?.content,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();

  if (searchableText.includes(query)) return true;

  const queryDigits = digitsOnly(rawQuery);
  if (queryDigits.length < 3) return false;

  const storedPhones = [conversation.customer.phone]
    .filter((value): value is string => Boolean(value))
    .map(digitsOnly)
    .filter(Boolean);
  const variants = phoneSearchVariants(rawQuery).filter((value) => value.length >= 3);

  return storedPhones.some((stored) => variants.some((variant) => stored.includes(variant)));
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return <>{text}</>;
  const regex = new RegExp(`(${trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === trimmedQuery.toLowerCase() ? (
          <mark key={`${part}-${index}`} className="bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded-[2px] px-[1px]">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

export function ConversationList({ conversations, selectedId, selectedOrderId, onSelect, onOrderSelect, searchQuery, onSearchChange }: ConversationListProps) {
  const [filter, setFilter] = useState<FilterType>('perlu_balas');
  const [channelFilter, setChannelFilter] = useState<Channel | 'all'>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const preserveSearchFocusRef = useRef(false);

  useLayoutEffect(() => {
    if (!preserveSearchFocusRef.current) return;
    preserveSearchFocusRef.current = false;
    inputRef.current?.focus({ preventScroll: true });
  }, [searchQuery]);

  const currentSearch = searchQuery.trim();
  const debouncedSearch = useDebounce(searchQuery, 320);
  const isSearchMode = currentSearch.length >= 2;
  const serverQueryMatchesCurrent = debouncedSearch.trim() === currentSearch;

  const { results: remoteSearchResults, loading: remoteSearchLoading } = useSearch(debouncedSearch);
  const searchResults = serverQueryMatchesCurrent ? remoteSearchResults : [];
  const searchLoading = serverQueryMatchesCurrent && remoteSearchLoading;
  const conversationSearchResults = useMemo(
    () => searchResults.filter((result) => result.resultType === 'conversation' && result.conversationId),
    [searchResults],
  );
  const orderSearchResults = useMemo(
    () => searchResults.filter((result) => result.resultType === 'order' && result.orderSummaryId),
    [searchResults],
  );
  const searchResultMap = useMemo(
    () => new Map(conversationSearchResults.map((result) => [result.conversationId as string, result])),
    [conversationSearchResults],
  );

  const localSearchIds = useMemo(() => {
    if (!isSearchMode) return new Set<string>();
    return new Set(
      conversations
        .filter((conversation) => localConversationMatches(conversation, currentSearch))
        .map((conversation) => conversation.id),
    );
  }, [conversations, currentSearch, isSearchMode]);

  const filteredConversations: Conversation[] = (() => {
    if (isSearchMode) {
      return conversations.filter((conversation) => {
        if (channelFilter !== 'all' && conversation.channel !== channelFilter) return false;
        return localSearchIds.has(conversation.id) || searchResultMap.has(conversation.id);
      });
    }

    return conversations.filter((conversation) => {
      if (channelFilter !== 'all' && conversation.channel !== channelFilter) return false;
      switch (filter) {
        case 'all':               return !conversation.isArchived;
        case 'perlu_balas':       return !conversation.isArchived && matchesNeedsReply(conversation);
        case 'unread':            return !conversation.isArchived && conversation.unreadCount > 0;
        case 'urgent':            return !conversation.isArchived && conversation.isUrgent;
        case 'perlu_pos':         return !conversation.isArchived && conversation.orderStatus === 'Perlu Pos Hari Ini';
        case 'menunggu_customer': return !conversation.isArchived && matchesWaitingForCustomer(conversation);
        case 'gagal':             return !conversation.isArchived && conversation.orderStatus === 'Gagal';
        case 'archived':          return conversation.isArchived;
        default:                  return true;
      }
    });
  })();

  function countFor(fn: (conversation: Conversation) => boolean) {
    return conversations.filter((conversation) => {
      if (channelFilter !== 'all' && conversation.channel !== channelFilter) return false;
      return fn(conversation);
    }).length;
  }

  const badgeCounts: Partial<Record<FilterType, number>> = {
    perlu_balas: countFor((conversation) => !conversation.isArchived && matchesNeedsReply(conversation)),
    unread:      countFor((conversation) => !conversation.isArchived && conversation.unreadCount > 0),
    urgent:      countFor((conversation) => !conversation.isArchived && conversation.isUrgent),
    perlu_pos:   countFor((conversation) => !conversation.isArchived && conversation.orderStatus === 'Perlu Pos Hari Ini'),
    gagal:       countFor((conversation) => !conversation.isArchived && conversation.orderStatus === 'Gagal'),
  };

  function handleClear() {
    onSearchChange('');
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[var(--surface)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#e9edef] dark:border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Cake size={18} className="text-[#00a884]" />
          <div>
            <span className="font-semibold text-[var(--text)] dark:text-[var(--text)] text-sm leading-tight block">ICETAK</span>
            <span className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] leading-tight">decocake.my</span>
          </div>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-[#e9edef] dark:border-[var(--border)]">
        <div className="relative flex items-center">
          {searchLoading && isSearchMode
            ? <Loader2 size={14} className="absolute left-3 text-[#00a884] pointer-events-none animate-spin" />
            : <Search size={14} className="absolute left-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)] pointer-events-none" />
          }
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            autoComplete="off"
            placeholder="Cari nama, telefon, order, produk, mesej..."
            value={searchQuery}
            onChange={(event) => {
              preserveSearchFocusRef.current = true;
              onSearchChange(event.target.value);
            }}
            onPaste={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
            className="w-full bg-[#f0f2f5] dark:bg-[var(--surface-hover)] text-[var(--text)] dark:text-[var(--text)] placeholder-[#667781] dark:placeholder-[var(--text-secondary)] text-sm rounded-lg pl-8 pr-8 py-2 outline-none focus:ring-1 focus:ring-[#00a884] transition-all"
          />
          {searchQuery && (
            <button onClick={handleClear} className="absolute right-3 text-[var(--text-secondary)] hover:text-[var(--text)] dark:hover:text-[var(--text)] transition-colors">
              <X size={14} />
            </button>
          )}
        </div>
        {isSearchMode && (
          <p className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-1.5 px-1">
            {filteredConversations.length === 0 && orderSearchResults.length === 0 && searchLoading
              ? 'Mencari…'
              : filteredConversations.length === 0 && orderSearchResults.length === 0
                ? 'Tiada keputusan ditemui'
                : `${filteredConversations.length} chat · ${orderSearchResults.length} order`}
          </p>
        )}
      </div>

      <div className="flex gap-1 px-3 pt-2 pb-1 overflow-x-auto overscroll-x-contain" style={{ scrollbarWidth: 'thin' }}>
        {CHANNEL_FILTERS.map((channel) => (
          <button
            key={channel.key}
            onClick={() => setChannelFilter(channel.key)}
            className={`flex-shrink-0 text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${
              channelFilter === channel.key
                ? channel.key === 'whatsapp'
                  ? 'bg-[#00a884] text-white'
                  : channel.key === 'shopee'
                    ? 'bg-orange-500 text-white'
                    : 'bg-[#3b4a54] dark:bg-[#aebac1] text-[var(--text)] dark:text-[var(--text)]'
                : 'bg-[#f0f2f5] dark:bg-[var(--surface-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[#e9edef] dark:hover:bg-[var(--surface-hover)]'
            }`}
          >
            {channel.label}
          </button>
        ))}
      </div>

      {!isSearchMode && (
        <div className="flex gap-1 px-3 pb-2 overflow-x-auto overscroll-x-contain border-b border-[#e9edef] dark:border-[var(--border)]" style={{ scrollbarWidth: 'thin' }}>
          {FILTERS.map((item) => {
            const count = badgeCounts[item.key];
            const isActive = filter === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setFilter(item.key)}
                className={`relative flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  isActive
                    ? 'bg-[#00a884] text-white'
                    : 'bg-[#f0f2f5] dark:bg-[var(--surface-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[#e9edef] dark:hover:bg-[var(--surface-hover)]'
                }`}
              >
                {item.label}
                {count != null && count > 0 && (
                  <span className={`ml-1.5 text-[10px] font-bold px-1 py-0.5 rounded-full ${
                    isActive ? 'bg-white/30 text-white' : 'bg-[#00a884]/20 text-[#00a884]'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {isSearchMode && <div className="border-b border-[#e9edef] dark:border-[var(--border)]" />}

      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 && orderSearchResults.length === 0 && !searchLoading ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            <Search size={24} strokeWidth={1.5} />
            <p className="text-sm">{isSearchMode ? 'Tiada order atau perbualan ditemui' : 'Tiada perbualan ditemui'}</p>
          </div>
        ) : (
          <div>
            {isSearchMode && orderSearchResults.map((result) => (
              <OrderSearchResultItem
                key={result.resultId}
                result={result}
                query={currentSearch}
                isSelected={selectedOrderId === result.orderSummaryId}
                onClick={() => onOrderSelect(result.orderSummaryId as string, result.conversationId)}
              />
            ))}
            {filteredConversations.map((conversation) => {
              const searchResult = searchResultMap.get(conversation.id);
              const firstHitMessageId = searchResult?.messageHits[0]?.messageId;
              return <div key={conversation.id}>
                {isSearchMode && searchResult ? (
                  <SearchResultItem
                    conversation={conversation}
                    searchResult={searchResult}
                    query={currentSearch}
                    isSelected={selectedId === conversation.id && !selectedOrderId}
                    onClick={() => onSelect(conversation.id, firstHitMessageId)}
                  />
                ) : (
                  <ConversationItem
                    conversation={conversation}
                    isSelected={selectedId === conversation.id && !selectedOrderId}
                    onClick={() => onSelect(conversation.id)}
                  />
                )}
              </div>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface OrderSearchResultItemProps {
  result: SearchResult;
  query: string;
  isSelected: boolean;
  onClick: () => void;
}

function OrderSearchResultItem({ result, query, isSelected, onClick }: OrderSearchResultItemProps) {
  return <button onClick={onClick} className={`w-full border-b border-[#e9edef] px-4 py-3 text-left hover:bg-[#f5f6f6] dark:border-[#222e35] dark:hover:bg-[var(--surface-muted)] ${isSelected ? 'bg-[#e9edef] dark:bg-[var(--surface-hover)]' : ''}`}>
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-orange-500/15"><Package size={17} className="text-orange-700 dark:text-orange-400" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold text-[var(--text)] dark:text-[var(--text)]"><HighlightedText text={result.title} query={query} /></p><span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[9px] font-semibold text-orange-700 dark:text-orange-400">ORDER</span></div>
        <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)]"><HighlightedText text={result.subtitle} query={query} /></p>
        <p className="mt-1.5 line-clamp-2 text-xs text-[#41525d] dark:text-[var(--text-secondary)]"><HighlightedText text={result.snippet} query={query} /></p>
        <p className="mt-1 text-[10px] text-[#00a884]">{result.matchedField}{result.conversationId ? ' · ada chat' : ' · belum ada chat'}</p>
      </div>
    </div>
  </button>;
}

interface SearchResultItemProps {
  conversation: Conversation;
  searchResult: SearchResult;
  query: string;
  isSelected: boolean;
  onClick: () => void;
}

function SearchResultItem({ conversation, searchResult, query, isSelected, onClick }: SearchResultItemProps) {
  const lastSnippet = searchResult.messageHits[0]?.snippet
    || conversation.messages[conversation.messages.length - 1]?.content
    || searchResult.metaHits.join(' · ')
    || 'Padanan conversation';
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-[#e9edef] dark:border-[#222e35] hover:bg-[#f5f6f6] dark:hover:bg-[var(--surface-muted)] ${
        isSelected ? 'bg-[#e9edef] dark:bg-[var(--surface-hover)]' : ''
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-[var(--text)] dark:text-[var(--text)]">{conversation.customer.name}</p>
            <ChannelBadge channel={conversation.channel} />
          </div>
          <p className="truncate text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-0.5">{conversation.customer.phone}</p>
          <p className="mt-1.5 text-xs text-[#41525d] dark:text-[var(--text-secondary)] line-clamp-2">
            <HighlightedText text={lastSnippet} query={query} />
          </p>
          <p className="mt-1 text-[11px] text-[#00a884]">
            {searchResult.messageHits.length > 0
              ? `${searchResult.messageHits.length} mesej match`
              : searchResult.metaHits.join(' · ') || 'Padanan metadata'}
          </p>
        </div>
      </div>
    </button>
  );
}

