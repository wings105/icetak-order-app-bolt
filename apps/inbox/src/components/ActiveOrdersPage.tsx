import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, MessageCircle, PackageCheck, RefreshCw, Search, ShoppingBag } from 'lucide-react';
import type { Conversation } from '../types';
import { useConversations } from '../lib/hooks';
import { normalizePhone } from '../lib/googleContactCache';
import { ExternalOrderSummary, listExternalOrderSummaries } from '../lib/externalOrderSummaries';

type Mode = 'active' | 'urgent' | 'no_phone' | 'all';

interface Props {
  onOpenConversation?: (conversationId: string) => void;
}

function conversationByPhone(conversations: Conversation[]) {
  const map: Record<string, Conversation> = {};
  for (const conversation of conversations) {
    const phone = normalizePhone(conversation.customer.phone);
    if (phone && !map[phone]) map[phone] = conversation;
  }
  return map;
}

function priorityLabel(value: string) {
  if (value === 'P0') return 'Overdue';
  if (value === 'P1') return 'Due Today';
  if (value === 'P2') return 'Due Tomorrow';
  if (value === 'P3') return 'Paid Baru';
  if (value === 'P4') return 'Active';
  return value;
}

function waLink(phone?: string | null) {
  const normalized = normalizePhone(phone);
  return normalized ? `https://wa.me/${normalized}` : '';
}

export function ActiveOrdersPage({ onOpenConversation }: Props) {
  const [mode, setMode] = useState<Mode>('active');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ExternalOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { conversations } = useConversations();
  const conversationsByPhone = useMemo(() => conversationByPhone(conversations), [conversations]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await listExternalOrderSummaries(query, mode));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Gagal memuatkan active orders.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 250);
    return () => window.clearTimeout(timer);
  }, [query, mode]);

  const activeCount = rows.filter((row) => row.active_order).length;
  const urgentCount = rows.filter((row) => ['P0', 'P1', 'P2'].includes(row.priority_level)).length;

  return <div className="h-full overflow-y-auto bg-[var(--canvas)] p-4 text-[var(--text)] sm:p-6">
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Active Orders</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Fokus customer/order yang dah paid dan belum selesai. Data ringkas dari icetak-order-system.</p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><RefreshCw size={15} /> Refresh</button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><p className="text-xs text-[var(--text-secondary)]">Current list</p><p className="mt-1 text-2xl font-semibold">{rows.length}</p></div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><p className="text-xs text-[var(--text-secondary)]">Active</p><p className="mt-1 text-2xl font-semibold text-[#00a884]">{activeCount}</p></div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><p className="text-xs text-[var(--text-secondary)]">Urgent</p><p className="mt-1 text-2xl font-semibold text-amber-700 dark:text-amber-400">{urgentCount}</p></div>
      </div>

      <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari order id, nama, phone, shopee username..." className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#00a884]" />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
            {[
              ['active', 'All Active'],
              ['urgent', 'Urgent'],
              ['no_phone', 'No Phone'],
              ['all', 'All History'],
            ].map(([key, label]) => <button key={key} onClick={() => setMode(key as Mode)} className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${mode === key ? 'bg-[#00a884] text-white' : 'bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'}`}>{label}</button>)}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        {loading ? <div className="flex items-center justify-center gap-2 p-10 text-sm text-[var(--text-secondary)]"><Loader2 className="animate-spin" size={17} /> Memuatkan active orders...</div> : error ? <div className="p-8 text-center text-sm text-red-700 dark:text-red-400">{error}</div> : rows.length === 0 ? <div className="p-10 text-center text-sm text-[var(--text-secondary)]"><PackageCheck className="mx-auto mb-3" size={28} />Tiada active order untuk filter ini.</div> : rows.map((row) => {
          const matchedConversation = row.customer_phone_normalized ? conversationsByPhone[row.customer_phone_normalized] : undefined;
          const whatsappUrl = waLink(row.customer_phone_normalized || row.customer_phone);
          return <div key={row.id} className="border-b border-[#202c33] p-4 last:border-b-0">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${row.active_order ? 'bg-[#00a884]/15 text-[#00a884]' : 'bg-[var(--surface-hover)] text-[var(--text-secondary)]'}`}>{row.active_order ? 'Active' : 'Inactive'}</span>
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{priorityLabel(row.priority_level)}</span>
                  <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">{row.source_channel}</span>
                </div>
                <h2 className="truncate text-base font-semibold text-[var(--text)]">{row.order_no}</h2>
                <p className="mt-0.5 text-sm text-[var(--text)]">{row.customer_name || row.shopee_username || 'Unknown customer'}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
                  {row.customer_phone_normalized && <span>Phone: {row.customer_phone_normalized}</span>}
                  {row.shopee_username && <span>Shopee: {row.shopee_username}</span>}
                  {row.payment_status && <span>Payment: {row.payment_status}</span>}
                  {row.order_status && <span>Status: {row.order_status}</span>}
                  {row.admin_status && <span>Admin: {row.admin_status}</span>}
                  {row.delivery_method && <span>Delivery: {row.delivery_method}</span>}
                  {row.date_need && <span>Need: {row.date_need}</span>}
                </div>
                {row.priority_reason && <p className="mt-2 text-xs text-[var(--text-secondary)]">{row.priority_reason}</p>}
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {matchedConversation && onOpenConversation && <button onClick={() => onOpenConversation(matchedConversation.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#00a884] px-3 py-2 text-xs font-semibold text-white"><MessageCircle size={14} /> Open Inbox</button>}
                {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)]"><MessageCircle size={14} /> WhatsApp</a>}
                <button disabled className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] opacity-70"><ShoppingBag size={14} /> Shopee Chat</button>
                {row.public_order_url && <a href={row.public_order_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)]"><ExternalLink size={14} /> Order</a>}
                {row.clickup_url && <a href={row.clickup_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)]"><ExternalLink size={14} /> ClickUp</a>}
              </div>
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
