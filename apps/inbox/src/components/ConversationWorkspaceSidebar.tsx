import { useEffect, useState } from 'react';
import { Activity, Loader2, Package, RefreshCw, UserRound, X } from 'lucide-react';
import type { Conversation } from '../types';
import type { CustomTag } from '../lib/conversationTags';
import { useConversationWorkspace } from '../lib/conversationWorkspace';
import { ActivityWorkspaceTab } from './workspace/ActivityWorkspaceTab';
import { CustomerWorkspaceTab } from './workspace/CustomerWorkspaceTab';
import { OrderWorkspaceTab } from './workspace/OrderWorkspaceTab';
import { WorkspaceMemberProfile } from './workspace/WorkspaceMemberProfile';

type WorkspaceTab = 'customer' | 'order' | 'activity';

interface Props {
  conversation: Conversation;
  allTags: CustomTag[];
  assignedTags: CustomTag[];
  onTagsChanged: () => void;
  onContactChanged?: () => void;
  onClose: () => void;
  onFillComposer: (text: string) => void;
  onOpenConversation: (conversationId: string) => void;
}

const TABS: Array<{ id: WorkspaceTab; label: string; icon: typeof UserRound }> = [
  { id: 'customer', label: 'Customer', icon: UserRound },
  { id: 'order', label: 'Order', icon: Package },
  { id: 'activity', label: 'Aktiviti', icon: Activity },
];

export function ConversationWorkspaceSidebar({
  conversation,
  allTags,
  assignedTags,
  onTagsChanged,
  onContactChanged,
  onClose,
  onFillComposer,
  onOpenConversation,
}: Props) {
  const [tab, setTab] = useState<WorkspaceTab>(conversation.channel === 'shopee' ? 'order' : 'customer');
  const { data, loading, error, reload } = useConversationWorkspace(conversation);

  useEffect(() => {
    setTab(conversation.channel === 'shopee' ? 'order' : 'customer');
  }, [conversation.id, conversation.channel]);

  useEffect(() => {
    if (tab !== 'activity') return;
    void reload();
    const timer = window.setInterval(() => { void reload(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [tab, conversation.id, reload]);

  function fillComposer(text: string) {
    onFillComposer(text);
    if (window.innerWidth < 1024) onClose();
  }

  function openRelated(conversationId: string) {
    onOpenConversation(conversationId);
    onClose();
  }

  return (
    <div className="flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:shadow-none">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--text)]">Customer Workspace</p>
          <p className="truncate text-[10px] text-[var(--text-secondary)]">{conversation.customer.name} · {conversation.channel}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <WorkspaceMemberProfile />
          <button
            onClick={() => void reload()}
            disabled={loading}
            className="rounded-full p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-50"
            title="Refresh sidebar"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
          <button onClick={onClose} className="rounded-full p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]" title="Tutup sidebar">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 border-b border-[var(--border)] bg-[var(--surface)]">
        {TABS.map((item) => {
          const Icon = item.icon;
          const count = item.id === 'order'
            ? data.linkedOrders.length
            : item.id === 'activity'
              ? data.activities.length
              : assignedTags.length;
          return (
            <button
              key={item.id}
              onClick={() => {
                setTab(item.id);
                if (item.id === 'activity') void reload();
              }}
              className={`relative flex items-center justify-center gap-1.5 px-2 py-3 text-xs font-medium transition-colors ${
                tab === item.id ? 'text-[#00a884]' : 'text-[var(--text-secondary)] hover:text-[var(--text)]'
              }`}
            >
              <Icon size={14} />{item.label}
              {count > 0 && <span className="rounded-full bg-[var(--surface-hover)] px-1.5 py-0.5 text-[9px] text-[var(--text-secondary)]">{count > 99 ? '99+' : count}</span>}
              {tab === item.id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#00a884]" />}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 border-b border-red-800/40 bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <span className="line-clamp-2">{error}</span>
          <button onClick={() => void reload()} className="rounded bg-red-500/15 px-2 py-1 text-[10px]">Cuba lagi</button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {tab === 'customer' && (
          <CustomerWorkspaceTab
            conversation={conversation}
            identities={data.identities}
            addresses={data.addresses}
            relatedConversations={data.relatedConversations}
            allTags={allTags}
            assignedTags={assignedTags}
            onTagsChanged={() => { onTagsChanged(); void reload(); }}
            onContactChanged={onContactChanged}
            onOpenConversation={openRelated}
            onReload={reload}
          />
        )}
        {tab === 'order' && (
          <OrderWorkspaceTab
            conversation={conversation}
            linkedOrders={data.linkedOrders}
            suggestedOrders={data.suggestedOrders}
            snippets={data.snippets}
            products={data.products}
            loading={loading}
            onFillComposer={fillComposer}
            onReload={reload}
          />
        )}
        {tab === 'activity' && <ActivityWorkspaceTab activities={data.activities} loading={loading} />}
      </div>
    </div>
  );
}
