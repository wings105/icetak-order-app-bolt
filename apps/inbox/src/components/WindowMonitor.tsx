import { useMemo, useState } from 'react';
import { Search, Clock3, AlertTriangle, CheckCircle2, XCircle, FlaskConical, Flag, MessageSquareText, Tag } from 'lucide-react';
import type { Conversation } from '../types';
import { CreateTestChatModal } from './CreateTestChatModal';

interface WindowMonitorProps {
  conversations: Conversation[];
  onReload?: () => void;
  onOpenConversation?: (conversationId: string) => void;
}

type Filter = 'all' | 'open' | 'closing' | 'critical' | 'expired' | 'no_window' | 'needs_reply' | 'urgent';

function getWindowInfo(lastInboundAt?: Date) {
  if (!lastInboundAt) return { status: 'no_window' as const, label: 'Tiada window', remainingMs: 0 };
  const remainingMs = lastInboundAt.getTime() + 24 * 60 * 60 * 1000 - Date.now();
  if (remainingMs <= 0) return { status: 'expired' as const, label: 'Tamat', remainingMs };
  if (remainingMs <= 30 * 60 * 1000) return { status: 'critical' as const, label: 'Bawah 30 minit', remainingMs };
  if (remainingMs <= 2 * 60 * 60 * 1000) return { status: 'closing' as const, label: 'Bawah 2 jam', remainingMs };
  return { status: 'open' as const, label: 'Terbuka', remainingMs };
}

function formatRemaining(ms: number) {
  if (ms <= 0) return 'Tamat';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}j ${minutes}m`;
}

export function WindowMonitor({ conversations, onReload, onOpenConversation }: WindowMonitorProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [showTestChat, setShowTestChat] = useState(false);

  const availableTags = useMemo(() => {
    const names = new Set<string>();
    conversations
      .filter((conversation) => conversation.channel === 'whatsapp')
      .forEach((conversation) => (conversation.customer.tags ?? []).forEach((tag) => names.add(tag)));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      .filter((conversation) => conversation.channel === 'whatsapp')
      .map((conversation) => ({ conversation, window: getWindowInfo(conversation.lastInboundAt) }))
      .filter(({ conversation, window }) => {
        if (selectedTag && !(conversation.customer.tags ?? []).includes(selectedTag)) return false;
        if (filter === 'needs_reply' && !conversation.needsReply) return false;
        if (filter === 'urgent' && !conversation.isUrgent) return false;
        if (!['all', 'needs_reply', 'urgent'].includes(filter) && window.status !== filter) return false;
        if (!q) return true;
        return [conversation.customer.name, conversation.customer.phone, conversation.orderId, ...(conversation.customer.tags ?? [])]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (a.conversation.isUrgent !== b.conversation.isUrgent) return a.conversation.isUrgent ? -1 : 1;
        return a.window.remainingMs - b.window.remainingMs;
      });
  }, [conversations, filter, query, selectedTag]);

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: 'Semua' },
    { id: 'urgent', label: 'Urgent' },
    { id: 'open', label: 'Terbuka' },
    { id: 'closing', label: 'Bawah 2 jam' },
    { id: 'critical', label: 'Bawah 30 minit' },
    { id: 'expired', label: 'Tamat' },
    { id: 'no_window', label: 'Tiada Window' },
    { id: 'needs_reply', label: 'Perlu Balas' },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[var(--canvas)] p-4 text-[var(--text)] sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div><h1 className="text-xl font-semibold">24H Monitor</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Hanya WhatsApp. Outbound tidak memanjangkan window.</p></div>
          <button onClick={() => setShowTestChat(true)} className="flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-[var(--text)] hover:bg-amber-500"><FlaskConical size={16} /> Cipta Test Chat</button>
        </div>

        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama, telefon, order atau tag..." className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#00a884]" /></div>
          {availableTags.length > 0 && (
            <div className="flex items-center gap-2">
              <Tag size={14} className="text-[#00a884]" />
              <select value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[#00a884]">
                <option value="">Semua custom tag</option>
                {availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </select>
              {selectedTag && <span className="text-xs text-[var(--text-secondary)]">{rows.length} chat</span>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">{filters.map((item) => <button key={item.id} onClick={() => setFilter(item.id)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === item.id ? 'bg-[#00a884] text-white' : 'bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'}`}>{item.label}</button>)}</div>
        </div>

        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="hidden grid-cols-[1.25fr_0.8fr_0.7fr_1fr_0.8fr_1fr_0.7fr_0.7fr] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] md:grid"><span>Customer</span><span>Tags</span><span>Urgent</span><span>Last inbound</span><span>Baki</span><span>Status</span><span>Perlu balas</span><span>Chat</span></div>
          {rows.length === 0 ? <div className="px-4 py-12 text-center text-sm text-[var(--text-secondary)]">Tiada rekod sepadan.</div> : rows.map(({ conversation, window }) => {
            const statusClass = window.status === 'open' ? 'text-emerald-700 dark:text-emerald-400' : window.status === 'closing' || window.status === 'critical' ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400';
            const Icon = window.status === 'open' ? CheckCircle2 : window.status === 'expired' ? XCircle : AlertTriangle;
            const tags = conversation.customer.tags ?? [];
            return <div key={conversation.id} className="grid gap-2 border-b border-[#202c33] px-4 py-4 last:border-b-0 md:grid-cols-[1.25fr_0.8fr_0.7fr_1fr_0.8fr_1fr_0.7fr_0.7fr] md:items-center md:gap-3">
              <div><p className="font-medium">{conversation.customer.name}</p><p className="text-xs text-[var(--text-secondary)]">{conversation.customer.phone ?? 'Tiada nombor'}</p></div>
              <div className="flex flex-wrap gap-1">{tags.length ? tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-full bg-[var(--surface-hover)] px-2 py-1 text-[10px] text-[var(--text)]">{tag}</span>) : <span className="text-[var(--text-secondary)]">—</span>}</div>
              <div className="text-sm">{conversation.isUrgent ? <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-1 font-medium text-red-700 dark:text-red-400"><Flag size={13} fill="currentColor" /> Urgent</span> : <span className="text-[var(--text-secondary)]">—</span>}</div>
              <div className="text-sm text-[var(--text-secondary)]">{conversation.lastInboundAt ? conversation.lastInboundAt.toLocaleString('ms-MY') : '—'}</div>
              <div className="flex items-center gap-1.5 text-sm"><Clock3 size={14} />{formatRemaining(window.remainingMs)}</div>
              <div className={`flex items-center gap-1.5 text-sm font-medium ${statusClass}`}><Icon size={15} />{window.label}</div>
              <div className="text-sm">{conversation.needsReply ? <span className="text-amber-700 dark:text-amber-400">Ya</span> : <span className="text-[var(--text-secondary)]">Tidak</span>}</div>
              <div><button type="button" onClick={() => onOpenConversation?.(conversation.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#00a884] px-3 py-2 text-xs font-semibold text-white hover:bg-[#06cf9c]"><MessageSquareText size={14} /> Buka</button></div>
            </div>;
          })}
        </div>
      </div>
      {showTestChat && <CreateTestChatModal onClose={() => setShowTestChat(false)} onCreated={() => onReload?.()} />}
    </div>
  );
}
