import { useMemo, useState } from 'react';
import { ArrowDownUp, Tag, X } from 'lucide-react';
import type { Conversation } from '../types';
import { ConversationList } from './ConversationList';

interface Props {
  conversations: Conversation[];
  selectedId: string | null;
  selectedOrderId: string | null;
  onSelect: (id: string, firstMatchMessageId?: string) => void;
  onOrderSelect: (orderSummaryId: string, conversationId?: string | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

type SortMode = 'latest' | 'ai_priority';

const SORT_STORAGE_KEY = 'icetak-inbox-sort-mode';

function latestMessageTime(conversation: Conversation): number {
  if (conversation.lastMessageAt) return conversation.lastMessageAt.getTime();
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  return lastMessage?.timestamp.getTime() ?? 0;
}

function sortByLatestMessage(a: Conversation, b: Conversation): number {
  return latestMessageTime(b) - latestMessageTime(a);
}

function sortByWorkPriority(a: Conversation, b: Conversation): number {
  const urgentDiff = Number(b.isUrgent) - Number(a.isUrgent);
  if (urgentDiff !== 0) return urgentDiff;

  const scoreDiff = (b.aiPriorityScore ?? 0) - (a.aiPriorityScore ?? 0);
  if (scoreDiff !== 0) return scoreDiff;

  const replyDiff = Number(Boolean(b.needsReply)) - Number(Boolean(a.needsReply));
  if (replyDiff !== 0) return replyDiff;

  return sortByLatestMessage(a, b);
}

function initialSortMode(): SortMode {
  try {
    const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
    return saved === 'ai_priority' ? 'ai_priority' : 'latest';
  } catch {
    return 'latest';
  }
}

export function ConversationListWithTagFilter({ conversations, selectedId, selectedOrderId, onSelect, onOrderSelect, searchQuery, onSearchChange }: Props) {
  const [selectedTag, setSelectedTag] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>(initialSortMode);

  const availableTags = useMemo(() => {
    const names = new Set<string>();
    conversations.forEach((conversation) => (conversation.customer.tags ?? []).forEach((tag) => names.add(tag)));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const filtered = useMemo(() => {
    const matching = selectedTag
      ? conversations.filter((conversation) => (conversation.customer.tags ?? []).includes(selectedTag))
      : conversations;
    return [...matching].sort(sortMode === 'latest' ? sortByLatestMessage : sortByWorkPriority);
  }, [conversations, selectedTag, sortMode]);

  function changeSortMode(value: SortMode) {
    setSortMode(value);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, value);
    } catch {
      // The selected mode still works for the current session when storage is unavailable.
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-[#2a3942] bg-[#111b21] px-3 py-2">
        <div className="flex items-center gap-2">
          <ArrowDownUp size={14} className="flex-shrink-0 text-[#00a884]" />
          <select
            value={sortMode}
            onChange={(event) => changeSortMode(event.target.value as SortMode)}
            className="min-w-0 flex-1 rounded-lg border border-[#3b4a54] bg-[#202c33] px-2.5 py-1.5 text-xs text-[#e9edef] outline-none focus:border-[#00a884]"
            aria-label="Susunan conversation"
          >
            <option value="latest">Susun: Mesej terbaru</option>
            <option value="ai_priority">Susun: Prioriti AI</option>
          </select>
        </div>

        {availableTags.length > 0 && (
          <div className="flex items-center gap-2">
            <Tag size={14} className="flex-shrink-0 text-[#00a884]" />
            <select
              value={selectedTag}
              onChange={(event) => setSelectedTag(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[#3b4a54] bg-[#202c33] px-2.5 py-1.5 text-xs text-[#e9edef] outline-none focus:border-[#00a884]"
              aria-label="Filter tag"
            >
              <option value="">Semua tag</option>
              {availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
            {selectedTag && (
              <button onClick={() => setSelectedTag('')} className="rounded-full p-1 text-[#8696a0] hover:bg-[#2a3942] hover:text-white" aria-label="Buang filter tag"><X size={14} /></button>
            )}
            {selectedTag && <span className="text-[10px] text-[#8696a0]">{filtered.length}</span>}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <ConversationList conversations={filtered} selectedId={selectedId} selectedOrderId={selectedOrderId} onSelect={onSelect} onOrderSelect={onOrderSelect} searchQuery={searchQuery} onSearchChange={onSearchChange} />
      </div>
    </div>
  );
}

