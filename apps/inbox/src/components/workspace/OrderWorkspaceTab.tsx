import { confirmDesignNavigation } from '../../lib/designDraftGuard';
import { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink, Link2, Loader2, MessageSquareText,
  Package, Plus, Search, Send, ShoppingBag, Star, Trash2, Truck,
} from 'lucide-react';
import type { Conversation, Message } from '../../types';
import {
  applyWorkspaceVariables,
  buildWorkspaceOrderCard,
  linkWorkspaceOrder,
  recordWorkspaceAction,
  setPrimaryWorkspaceOrder,
  unlinkWorkspaceOrder,
  type WorkspaceOrderLink,
  type WorkspaceProduct,
  type WorkspaceSnippet,
  type WorkspaceSuggestedOrder,
} from '../../lib/conversationWorkspace';
import { ShopeeCardDialog } from './ShopeeCardDialog';
import { SidebarOrderCard, sidebarOrderStatus } from './SidebarOrderCard';
import type { CardSelection } from '../../lib/shopeeCardSend';
import { linkManualOrder } from '../../lib/workspaceOrderActions';

interface Props {
  conversation: Conversation;
  linkedOrders: WorkspaceOrderLink[];
  suggestedOrders: WorkspaceSuggestedOrder[];
  snippets: WorkspaceSnippet[];
  products: WorkspaceProduct[];
  loading: boolean;
  onFillComposer: (text: string) => void;
  onReload: () => Promise<void>;
  onCardSent?: (message: Message, warning?: string) => void;
}

function dateLabel(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value}T12:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function OrderWorkspaceTab({
  conversation,
  linkedOrders,
  suggestedOrders,
  snippets,
  products,
  loading,
  onFillComposer,
  onReload,
  onCardSent,
}: Props) {
  const [selectedCard, setSelectedCard] = useState<CardSelection | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualOrderNo, setManualOrderNo] = useState('');
  const [snippetQuery, setSnippetQuery] = useState('');
  const [orderFilter, setOrderFilter] = useState('all');
  useEffect(() => { setOrderFilter('all'); }, [conversation.id]);
  const visibleOrders = linkedOrders.filter((link) => orderFilter === 'all' || sidebarOrderStatus(link.summary || {}).key === orderFilter);

  const primaryLink = linkedOrders.find((order) => order.is_primary) ?? linkedOrders[0] ?? null;
  const primarySummary = primaryLink?.summary ?? null;

  const filteredSnippets = useMemo(() => {
    const query = snippetQuery.trim().toLowerCase();
    if (!query) return snippets.slice(0, 18);
    return snippets.filter((snippet) => [snippet.title, snippet.shortcut, snippet.category ?? '', snippet.message]
      .some((value) => value.toLowerCase().includes(query))).slice(0, 18);
  }, [snippetQuery, snippets]);

  async function runAction(key: string, action: () => Promise<void>) {
    if (busyKey || /^(unlink|primary|manual-link|suggest)/.test(key) && !confirmDesignNavigation()) return;
    setBusyKey(key);
    setError(null);
    try {
      await action();
      await onReload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Tindakan gagal.');
    } finally {
      setBusyKey(null);
    }
  }

  async function prepareOrderCard(link: WorkspaceOrderLink) {
    if (conversation.channel === 'shopee') {
      if (!link.summary || link.summary.source_channel !== 'shopee') throw new Error('Detail order Shopee belum tersedia.');
      setSelectedCard({type: 'order', id: link.summary.id, orderNo: link.order_no, title: `Order #${link.order_no}`, image: String((link.summary.items[0] as Record<string, unknown> | undefined)?.image_url || '')});
      return;
    }
    const text = link.summary
      ? buildWorkspaceOrderCard(link.summary)
      : `Order #${link.order_no}`;
    onFillComposer(text);
    await recordWorkspaceAction(conversation.id, 'order_card_prepared', `Order card ${link.order_no} dimasukkan ke composer`, { order_no: link.order_no, link_id: link.id });
  }

  async function prepareTracking(link: WorkspaceOrderLink) {
    const tracking = link.summary?.tracking_no;
    if (!tracking) throw new Error('Tracking number belum tersedia.');
    const text = [`Tracking order #${link.order_no}`, tracking, link.summary?.tracking_link ?? ''].filter(Boolean).join('\n');
    onFillComposer(text);
    await recordWorkspaceAction(conversation.id, 'tracking_prepared', `Tracking ${link.order_no} dimasukkan ke composer`, { order_no: link.order_no, tracking_no: tracking });
  }

  async function useSnippet(snippet: WorkspaceSnippet) {
    const message = applyWorkspaceVariables(snippet.message, conversation, primarySummary);
    onFillComposer(message);
    await recordWorkspaceAction(conversation.id, 'quick_reply_used', `Quick reply ${snippet.title} digunakan`, { snippet_id: snippet.id, shortcut: snippet.shortcut });
  }

  async function useProduct(product: WorkspaceProduct) {
    const price = product.price == null ? '' : `RM${Number(product.price).toFixed(2)}`;
    const message = [product.name, price, product.description ?? '', product.product_url ?? ''].filter(Boolean).join('\n');
    onFillComposer(message);
    await recordWorkspaceAction(conversation.id, 'product_suggestion_prepared', `Produk ${product.name} dimasukkan ke composer`, { product_id: product.id, external_product_id: product.external_product_id });
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface)] pb-8">
      {error && <div className="m-3 rounded-lg border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</div>}

      <section className="border-b border-[var(--border)] p-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Order Dipautkan</h3>
          <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">{linkedOrders.length}</span>
        </div>

        <div className="mb-3 flex gap-0.5 overflow-x-auto border-b border-[var(--border)] pb-2 scrollbar-none" role="group" aria-label="Tapis status order">
          {[['all', 'All'], ['unpaid', 'Unpaid'], ['to_ship', 'To Ship'], ['shipping', 'Shipping'], ['completed', 'Completed'], ['cancelled', 'Cancelled']].map(([key, label]) => <button
            key={key} type="button" aria-pressed={orderFilter === key} onClick={() => setOrderFilter(key)}
            className={`shrink-0 rounded px-2 py-1 text-[10px] transition-colors ${orderFilter === key ? 'bg-orange-500/10 font-semibold text-[#ee4d2d] dark:text-orange-300' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'}`}
          >{label}</button>)}
        </div>

        {loading && linkedOrders.length === 0 && <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--text-secondary)]"><Loader2 size={14} className="animate-spin" />Memuatkan order…</div>}

        <div className="space-y-3">
          {visibleOrders.map((link) => <SidebarOrderCard
            key={link.id}
            order={link.summary || { order_no: link.order_no, items: [], source_channel: conversation.channel }}
            primary={link.is_primary}
            extraRows={[
              { label: 'Status bayaran', value: link.summary?.payment_status },
              { label: 'Data order', value: !link.summary || link.summary.metadata?.provisional === true ? 'Menunggu sync penuh' : link.summary?.source_channel === 'shopee' ? 'Shopee → iCetak' : 'iCetak' },
              { label: 'Detail pelanggan', value: link.summary?.metadata?.customer_detail_status === 'confirmed' ? 'Confirmation direkod' : 'Perlu semakan chat / artwork' },
              { label: 'Padanan', value: `${link.match_method.replace(/_/g, ' ')} · ${Math.round(Number(link.match_confidence) * 100)}%` },
            ]}
            actions={<>
              <ActionButton icon={<Send size={12} />} label={conversation.channel === 'shopee' ? 'Hantar order' : 'Order Card'} primary disabled={conversation.channel === 'shopee' && link.summary?.source_channel !== 'shopee'} onClick={() => runAction(`card-${link.id}`, () => prepareOrderCard(link))} busy={busyKey === `card-${link.id}`} />
              <ActionButton icon={<Truck size={12} />} label="Tracking" onClick={() => runAction(`tracking-${link.id}`, () => prepareTracking(link))} busy={busyKey === `tracking-${link.id}`} disabled={!link.summary?.tracking_no} />
              {!link.is_primary && <ActionButton icon={<Star size={12} />} label="Jadi Utama" onClick={() => runAction(`primary-${link.id}`, () => setPrimaryWorkspaceOrder(link.id))} busy={busyKey === `primary-${link.id}`} />}
              {(link.summary?.public_order_url || link.summary?.clickup_url) && <ActionButton icon={<ExternalLink size={12} />} label="Buka Order" onClick={() => window.open(link.summary?.public_order_url || link.summary?.clickup_url || '', '_blank', 'noopener,noreferrer')} />}
              <ActionButton icon={<Trash2 size={12} />} label="Unlink" onClick={() => runAction(`unlink-${link.id}`, () => unlinkWorkspaceOrder(link.id))} busy={busyKey === `unlink-${link.id}`} danger />
            </>}
          />)}
          {linkedOrders.length > 0 && visibleOrders.length === 0 && <p className="py-6 text-center text-xs text-[var(--text-secondary)]">Tiada order untuk status ini.</p>}
        </div>

        {linkedOrders.length === 0 && !loading && (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-center">
            <Link2 size={24} className="mx-auto text-[var(--text-secondary)]" />
            <p className="mt-2 text-xs font-medium text-[var(--text)]">Belum ada order dipautkan</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-secondary)]">Link manual sekarang atau pilih cadangan auto-match di bawah.</p>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <input
            value={manualOrderNo}
            onChange={(event) => setManualOrderNo(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && manualOrderNo.trim()) void runAction('manual-link', async () => {
                await linkManualOrder(conversation.id, manualOrderNo, linkedOrders.length === 0);
                setManualOrderNo('');
              });
            }}
            placeholder="Masukkan order ID"
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[#00a884]"
          />
          <button
            onClick={() => runAction('manual-link', async () => {
              await linkManualOrder(conversation.id, manualOrderNo, linkedOrders.length === 0);
              setManualOrderNo('');
            })}
            disabled={!manualOrderNo.trim() || Boolean(busyKey)}
            className="inline-flex items-center gap-1 rounded-lg bg-[#00a884] px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            {busyKey === 'manual-link' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}Link
          </button>
        </div>
      </section>

      {suggestedOrders.length > 0 && (
        <section className="border-b border-[var(--border)] p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Cadangan Auto-Match</h3>
          <div className="space-y-2">
            {suggestedOrders.map((order) => (
              <div key={`${order.source_project}-${order.order_no}`} className="flex items-center gap-3 rounded-lg bg-[var(--surface-muted)] p-3">
                <Package size={15} className="flex-shrink-0 text-[#00a884]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[var(--text)]">#{order.order_no}</p>
                  <p className="truncate text-[10px] text-[var(--text-secondary)]">{order.match_method} {Math.round(order.match_confidence * 100)}% · {order.payment_status || 'payment unknown'} · {dateLabel(order.date_need)}</p>
                </div>
                <button
                  onClick={() => runAction(`suggest-${order.id}`, () => linkWorkspaceOrder(conversation.id, order, linkedOrders.length === 0))}
                  disabled={Boolean(busyKey)}
                  className="rounded-lg bg-[#00a884]/20 px-2.5 py-1.5 text-[10px] font-semibold text-[var(--accent)] hover:bg-[#00a884]/30"
                >
                  {busyKey === `suggest-${order.id}` ? <Loader2 size={12} className="animate-spin" /> : 'Link'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="border-b border-[var(--border)] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Quick Reply</h3>
          <span className="text-[10px] text-[var(--text-secondary)]">Klik untuk isi composer</span>
        </div>
        <div className="relative mb-3">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input value={snippetQuery} onChange={(event) => setSnippetQuery(event.target.value)} placeholder="Cari snippet…" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] py-2 pl-8 pr-3 text-xs text-[var(--text)] outline-none focus:border-[#00a884]" />
        </div>
        <div className="space-y-1.5">
          {filteredSnippets.map((snippet) => (
            <button
              key={snippet.id}
              onClick={() => runAction(`snippet-${snippet.id}`, () => useSnippet(snippet))}
              disabled={Boolean(busyKey)}
              className="flex w-full items-start gap-2 rounded-lg bg-[var(--surface-muted)] px-3 py-2.5 text-left hover:bg-[var(--surface-hover)]"
            >
              <MessageSquareText size={14} className="mt-0.5 flex-shrink-0 text-[#00a884]" />
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-xs font-medium text-[var(--text)]">{snippet.title}</p><span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[9px] text-[var(--text-secondary)]">/{snippet.shortcut}</span></div><p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[var(--text-secondary)]">{snippet.message}</p></div>
            </button>
          ))}
          {filteredSnippets.length === 0 && <p className="py-4 text-center text-xs text-[var(--text-secondary)]">Tiada snippet sepadan.</p>}
        </div>
      </section>

      {conversation.channel !== 'shopee' && <section className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Cadangan Produk</h3>
          <span className="text-[10px] text-[var(--text-secondary)]">Order System ready</span>
        </div>
        <div className="space-y-2">
          {products.map((product) => (
            <div key={product.id} className="flex items-center gap-3 rounded-lg bg-[var(--surface-muted)] p-3">
              {product.image_url ? <img src={product.image_url} alt="" className="h-10 w-10 flex-shrink-0 rounded-lg object-cover" /> : <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--surface-hover)]"><ShoppingBag size={16} className="text-[#00a884]" /></div>}
              <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-[var(--text)]">{product.name}</p><p className="text-[10px] text-[var(--text-secondary)]">{product.price == null ? 'Harga belum sync' : `RM${Number(product.price).toFixed(2)}`}</p></div>
              <button onClick={() => runAction(`product-${product.id}`, () => useProduct(product))} disabled={Boolean(busyKey)} className="rounded-lg bg-[#00a884]/20 p-2 text-[var(--accent)] hover:bg-[#00a884]/30" title="Masuk composer"><Send size={13} /></button>
            </div>
          ))}
          {products.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-center">
              <ShoppingBag size={24} className="mx-auto text-[var(--text-secondary)]" />
              <p className="mt-2 text-xs text-[var(--text)]">Product cache sudah tersedia</p>
              <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-secondary)]">Produk akan muncul di sini selepas iCetak Order System sync katalog.</p>
            </div>
          )}
        </div>
      </section>}
      {selectedCard && <ShopeeCardDialog conversation={conversation} selection={selectedCard} onClose={() => setSelectedCard(null)} onSent={(message, warning) => {onCardSent?.(message, warning);}}/>}
    </div>
  );
}

function ActionButton({ icon, label, onClick, busy = false, disabled = false, danger = false, primary = false }: { icon: React.ReactNode; label: string; onClick: () => void; busy?: boolean; disabled?: boolean; danger?: boolean; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-[10px] font-medium disabled:opacity-35 ${primary ? 'bg-[#ee4d2d] text-white hover:bg-[#d94326]' : danger ? 'bg-red-500/15 text-red-700 dark:text-red-300 hover:bg-red-500/25' : 'bg-[var(--surface-hover)] text-[var(--text)] hover:text-[var(--text)]'}`}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : icon}{label}
    </button>
  );
}
