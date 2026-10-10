import { MessageCircle, ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Conversation } from '../types';
import { ConversationListWithTagFilter } from './ConversationListWithTagFilter';
import { OrderInboxList } from './OrderInboxList';

interface Props {
  conversations: Conversation[];
  selectedId: string | null;
  selectedOrderId: string | null;
  onSelect: (id: string, firstMatchMessageId?: string) => void;
  onOrderSelect: (orderSummaryId: string, conversationId?: string | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

type Mode = 'chat' | 'orders';

function initialMode(): Mode {
  try { return window.localStorage.getItem('icetak-inbox-list-mode') === 'orders' ? 'orders' : 'chat'; }
  catch { return 'chat'; }
}

export function UnifiedInboxList(props: Props) {
  const [mode, setMode] = useState<Mode>(props.selectedOrderId ? 'orders' : initialMode);

  useEffect(() => {
    if (props.selectedOrderId) setMode('orders');
  }, [props.selectedOrderId]);

  function selectMode(next: Mode) {
    setMode(next);
    try { window.localStorage.setItem('icetak-inbox-list-mode', next); } catch { /* session state still works */ }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface)]">
      <div className="grid grid-cols-2 border-b border-[var(--border)] bg-[var(--surface-muted)] px-2 pt-2">
        <button onClick={() => selectMode('chat')} className={`flex items-center justify-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition ${mode === 'chat' ? 'border-[#00a884] text-[var(--accent)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text)]'}`}><MessageCircle size={14} />Chat</button>
        <button onClick={() => selectMode('orders')} className={`flex items-center justify-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition ${mode === 'orders' ? 'border-orange-500 text-orange-700 dark:text-orange-300' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text)]'}`}><ShoppingBag size={14} />Order</button>
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'chat'
          ? <ConversationListWithTagFilter {...props} />
          : <OrderInboxList selectedOrderId={props.selectedOrderId} onOrderSelect={props.onOrderSelect} searchQuery={props.searchQuery} onSearchChange={props.onSearchChange} />}
      </div>
    </div>
  );
}

