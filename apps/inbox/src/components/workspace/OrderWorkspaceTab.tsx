import { useMemo, useState } from 'react';
import {
  CheckCircle2, Copy, CreditCard, ExternalLink, Link2, Loader2, MessageSquareText,
  CalendarClock, MapPin, Package, Plus, Search, Send, ShoppingBag, Star, StickyNote, Tag, Trash2, Truck,
} from 'lucide-react';
import type { Conversation } from '../../types';
import {
  applyWorkspaceVariables,
  buildWorkspaceOrderCard,
  linkWorkspaceOrder,
  recordWorkspaceAction,
  setPrimaryWorkspaceOrder,
  unlinkWorkspaceOrder,
  type WorkspaceOrderLink,
  type WorkspaceOrderSummary,
  type WorkspaceProduct,
  type WorkspaceSnippet,
  type WorkspaceSuggestedOrder,
} from '../../lib/conversationWorkspace';
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
}

function amount(value: number | null): string {
  return value == null ? '—' : `RM${Number(value).toFixed(2)}`;
}

function dateLabel(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value}T12:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusClass(status: string | null): string {
  const key = (status ?? '').toLowerCase();
  if (/paid|completed|delivered|approved/.test(key)) return 'bg-emerald-500/20 text-emerald-300';
  if (/cancel|fail|refund|exception/.test(key)) return 'bg-red-500/20 text-red-300';
  if (/ship|transit|delivery/.test(key)) return 'bg-sky-500/20 text-sky-300';
  if (/waiting|ready|pending|unpaid/.test(key)) return 'bg-orange-500/20 text-orange-300';
  return 'bg-[#2a3942] text-[#d1d7db]';
}

function orderItems(summary: WorkspaceOrderSummary | null): Array<{ name: string; detail: string; image: string; price: number | null }> {
  if (!summary || !Array.isArray(summary.items)) return [];
  return summary.items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const name = String(row.product_name ?? row.name ?? row.title ?? 'Item').trim();
    const variation = String(row.variation_name ?? row.variation ?? row.variant ?? '').trim();
    const wording = String(row.wording ?? row.custom_text ?? '').trim();
    const quantity = Number(row.quantity ?? row.qty ?? 1);
    const rawPrice = row.line_subtotal ?? row.unit_discounted_price ?? null;
    const price = rawPrice == null ? null : Number(rawPrice);
    return [{
      name,
      detail: [variation, wording, `Qty ${quantity}`].filter(Boolean).join(' · '),
      image: String(row.image_url ?? ''),
      price: Number.isFinite(price) ? price : null,
    }];
  });
}

function copy(value: string): void {
  void navigator.clipboard.writeText(value);
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
}: Props) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualOrderNo, setManualOrderNo] = useState('');
  const [snippetQuery, setSnippetQuery] = useState('');
  const [copiedNoteOrder, setCopiedNoteOrder] = useState<string | null>(null);

  const primaryLink = linkedOrders.find((order) => order.is_primary) ?? linkedOrders[0] ?? null;
  const primarySummary = primaryLink?.summary ?? null;

  const filteredSnippets = useMemo(() => {
    const query = snippetQuery.trim().toLowerCase();
    if (!query) return snippets.slice(0, 18);
    return snippets.filter((snippet) => [snippet.title, snippet.shortcut, snippet.category ?? '', snippet.message]
      .some((value) => value.toLowerCase().includes(query))).slice(0, 18);
  }, [snippetQuery, snippets]);

  async function runAction(key: string, action: () => Promise<void>) {
    if (busyKey) return;
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
    <div className="h-full overflow-y-auto bg-[#111b21] pb-8">
      {error && <div className="m-3 rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</div>}

      <section className="border-b border-[#2a3942] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8696a0]">Order Dipautkan</h3>
          <span className="rounded-full bg-[#202c33] px-2 py-0.5 text-[10px] text-[#8696a0]">{linkedOrders.length}</span>
        </div>

        {loading && linkedOrders.length === 0 && <div className="flex items-center justify-center gap-2 py-6 text-xs text-[#8696a0]"><Loader2 size={14} className="animate-spin" />Memuatkan order…</div>}

        <div className="space-y-3">
          {linkedOrders.map((link) => {
            const summary = link.summary;
            const items = orderItems(summary);
            return (
              <div key={link.id} className={`rounded-xl border p-3 ${link.is_primary ? 'border-[#00a884]/60 bg-[#0f2622]' : 'border-[#2a3942] bg-[#202c33]'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-white">#{link.order_no}</p>
                      {link.is_primary && <span className="inline-flex items-center gap-1 rounded-full bg-[#00a884]/20 px-1.5 py-0.5 text-[9px] font-semibold text-[#71d7bd]"><Star size={9} fill="currentColor" />Utama</span>}
                      {summary?.active_order && <span className="rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[9px] text-blue-300">Aktif</span>}
                    </div>
                    <p className="mt-1 text-[10px] text-[#8696a0]">{link.source_project} · {link.match_method} {Math.round(Number(link.match_confidence) * 100)}%</p>
                  </div>
                  <button onClick={() => copy(link.order_no)} className="rounded p-1.5 text-[#8696a0] hover:bg-[#2a3942] hover:text-white" title="Salin order ID"><Copy size={13} /></button>
                </div>

                {summary ? (
                  <>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {summary.payment_status && <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusClass(summary.payment_status)}`}>{summary.payment_status}</span>}
                      {summary.order_status && <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusClass(summary.order_status)}`}>{summary.order_status}</span>}
                      {summary.shipment_status && <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusClass(summary.shipment_status)}`}>{summary.shipment_status}</span>}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <Stat icon={<CreditCard size={12} />} label="Jumlah" value={amount(summary.payment_total)} />
                      <Stat icon={<CheckCircle2 size={12} />} label="Paid" value={amount(summary.paid_amount)} />
                      <Stat icon={<Tag size={12} />} label="Baki" value={amount(summary.balance_amount)} />
                      <Stat icon={<Package size={12} />} label="Tarikh perlu" value={dateLabel(summary.date_need)} />
                    </div>

                    {items.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-[#2a3942] pt-3">
                        {items.slice(0, 8).map((item, index) => (
                          <div key={`${item.name}-${index}`} className="flex items-start gap-2 rounded-lg bg-[#111b21] p-2 text-xs">
                            {item.image ? <img src={item.image} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" /> : <ShoppingBag size={14} className="mt-1 flex-shrink-0 text-[#00a884]" />}
                            <div className="min-w-0 flex-1"><p className="line-clamp-2 text-[#e9edef]">{item.name}</p>{item.detail && <p className="mt-0.5 truncate text-[10px] text-[#8696a0]">{item.detail}</p>}{item.price != null && <p className="mt-1 text-[10px] font-semibold text-[#71d7bd]">{amount(item.price)}</p>}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {summary.buyer_message && <div className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-[11px] text-amber-100">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="flex items-center gap-1 font-semibold"><StickyNote size={12} />Nota checkout</p>
                        <button
                          onClick={() => {
                            copy(summary.buyer_message ?? '');
                            setCopiedNoteOrder(link.order_no);
                            window.setTimeout(() => setCopiedNoteOrder(null), 1800);
                          }}
                          className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-1 text-[9px] font-semibold hover:bg-amber-500/25"
                          title="Salin nota checkout"
                        >
                          {copiedNoteOrder === link.order_no ? <CheckCircle2 size={11} /> : <Copy size={11} />}
                          {copiedNoteOrder === link.order_no ? 'Disalin' : 'Salin'}
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap">{summary.buyer_message}</p>
                    </div>}
                    {summary.delivery_address && <div className="mt-3 rounded-lg bg-[#111b21] p-2.5 text-[11px] text-[#d1d7db]"><p className="mb-1 flex items-center gap-1 font-semibold text-[#aebac1]"><MapPin size={12} />Alamat</p><p className="whitespace-pre-wrap leading-relaxed">{summary.delivery_address}</p></div>}
                    {(summary.ship_by_at || summary.courier_name) && <div className="mt-3 grid grid-cols-2 gap-2"><Stat icon={<CalendarClock size={12} />} label="Ship by" value={summary.ship_by_at ? new Date(summary.ship_by_at).toLocaleString('ms-MY') : '—'} /><Stat icon={<Truck size={12} />} label="Courier" value={summary.courier_name || summary.delivery_method || '—'} /></div>}
                                        {summary.tracking_no && <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#111b21] px-2.5 py-2 text-[11px] text-[#d1d7db]"><Truck size={13} className="text-sky-300" /><span className="min-w-0 flex-1 truncate">{summary.tracking_no}</span><button onClick={() => copy(summary.tracking_no ?? '')}><Copy size={12} /></button></div>}
                  </>
                ) : (
                  <p className="mt-3 rounded-lg bg-[#111b21] px-3 py-2 text-xs text-[#8696a0]">Order telah dipautkan. Detail penuh akan muncul automatik apabila Order System sync order ini.</p>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <ActionButton icon={<Send size={12} />} label="Order Card" onClick={() => runAction(`card-${link.id}`, () => prepareOrderCard(link))} busy={busyKey === `card-${link.id}`} />
                  <ActionButton icon={<Truck size={12} />} label="Tracking" onClick={() => runAction(`tracking-${link.id}`, () => prepareTracking(link))} busy={busyKey === `tracking-${link.id}`} disabled={!summary?.tracking_no} />
                  {!link.is_primary && <ActionButton icon={<Star size={12} />} label="Jadi Utama" onClick={() => runAction(`primary-${link.id}`, () => setPrimaryWorkspaceOrder(link.id))} busy={busyKey === `primary-${link.id}`} />}
                  {(summary?.public_order_url || summary?.clickup_url) && <ActionButton icon={<ExternalLink size={12} />} label="Buka Order" onClick={() => window.open(summary.public_order_url || summary.clickup_url || '', '_blank', 'noopener,noreferrer')} />}
                  <ActionButton icon={<Trash2 size={12} />} label="Unlink" onClick={() => runAction(`unlink-${link.id}`, () => unlinkWorkspaceOrder(link.id))} busy={busyKey === `unlink-${link.id}`} danger />
                </div>
              </div>
            );
          })}
        </div>

        {linkedOrders.length === 0 && !loading && (
          <div className="rounded-xl border border-dashed border-[#3b4a54] p-4 text-center">
            <Link2 size={24} className="mx-auto text-[#667781]" />
            <p className="mt-2 text-xs font-medium text-[#d1d7db]">Belum ada order dipautkan</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[#8696a0]">Link manual sekarang atau pilih cadangan auto-match di bawah.</p>
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
            className="min-w-0 flex-1 rounded-lg border border-[#3b4a54] bg-[#202c33] px-3 py-2 text-xs text-white outline-none focus:border-[#00a884]"
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
        <section className="border-b border-[#2a3942] p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#8696a0]">Cadangan Auto-Match</h3>
          <div className="space-y-2">
            {suggestedOrders.map((order) => (
              <div key={`${order.source_project}-${order.order_no}`} className="flex items-center gap-3 rounded-lg bg-[#202c33] p-3">
                <Package size={15} className="flex-shrink-0 text-[#00a884]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-white">#{order.order_no}</p>
                  <p className="truncate text-[10px] text-[#8696a0]">{order.match_method} {Math.round(order.match_confidence * 100)}% · {order.payment_status || 'payment unknown'} · {dateLabel(order.date_need)}</p>
                </div>
                <button
                  onClick={() => runAction(`suggest-${order.id}`, () => linkWorkspaceOrder(conversation.id, order, linkedOrders.length === 0))}
                  disabled={Boolean(busyKey)}
                  className="rounded-lg bg-[#00a884]/20 px-2.5 py-1.5 text-[10px] font-semibold text-[#71d7bd] hover:bg-[#00a884]/30"
                >
                  {busyKey === `suggest-${order.id}` ? <Loader2 size={12} className="animate-spin" /> : 'Link'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="border-b border-[#2a3942] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8696a0]">Quick Reply</h3>
          <span className="text-[10px] text-[#667781]">Klik untuk isi composer</span>
        </div>
        <div className="relative mb-3">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#667781]" />
          <input value={snippetQuery} onChange={(event) => setSnippetQuery(event.target.value)} placeholder="Cari snippet…" className="w-full rounded-lg border border-[#3b4a54] bg-[#202c33] py-2 pl-8 pr-3 text-xs text-white outline-none focus:border-[#00a884]" />
        </div>
        <div className="space-y-1.5">
          {filteredSnippets.map((snippet) => (
            <button
              key={snippet.id}
              onClick={() => runAction(`snippet-${snippet.id}`, () => useSnippet(snippet))}
              disabled={Boolean(busyKey)}
              className="flex w-full items-start gap-2 rounded-lg bg-[#202c33] px-3 py-2.5 text-left hover:bg-[#2a3942]"
            >
              <MessageSquareText size={14} className="mt-0.5 flex-shrink-0 text-[#00a884]" />
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-xs font-medium text-white">{snippet.title}</p><span className="rounded bg-[#111b21] px-1.5 py-0.5 text-[9px] text-[#8696a0]">/{snippet.shortcut}</span></div><p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#8696a0]">{snippet.message}</p></div>
            </button>
          ))}
          {filteredSnippets.length === 0 && <p className="py-4 text-center text-xs text-[#8696a0]">Tiada snippet sepadan.</p>}
        </div>
      </section>

      <section className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8696a0]">Cadangan Produk</h3>
          <span className="text-[10px] text-[#667781]">Order System ready</span>
        </div>
        <div className="space-y-2">
          {products.map((product) => (
            <div key={product.id} className="flex items-center gap-3 rounded-lg bg-[#202c33] p-3">
              {product.image_url ? <img src={product.image_url} alt="" className="h-10 w-10 flex-shrink-0 rounded-lg object-cover" /> : <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#2a3942]"><ShoppingBag size={16} className="text-[#00a884]" /></div>}
              <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-white">{product.name}</p><p className="text-[10px] text-[#8696a0]">{product.price == null ? 'Harga belum sync' : `RM${Number(product.price).toFixed(2)}`}</p></div>
              <button onClick={() => runAction(`product-${product.id}`, () => useProduct(product))} disabled={Boolean(busyKey)} className="rounded-lg bg-[#00a884]/20 p-2 text-[#71d7bd] hover:bg-[#00a884]/30" title="Masuk composer"><Send size={13} /></button>
            </div>
          ))}
          {products.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#3b4a54] p-4 text-center">
              <ShoppingBag size={24} className="mx-auto text-[#667781]" />
              <p className="mt-2 text-xs text-[#d1d7db]">Product cache sudah tersedia</p>
              <p className="mt-1 text-[10px] leading-relaxed text-[#8696a0]">Produk akan muncul di sini selepas iCetak Order System sync katalog.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-lg bg-[#111b21] p-2"><div className="flex items-center gap-1 text-[#8696a0]">{icon}<span className="text-[9px] uppercase tracking-wide">{label}</span></div><p className="mt-1 truncate text-xs font-medium text-[#e9edef]">{value}</p></div>;
}

function ActionButton({ icon, label, onClick, busy = false, disabled = false, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; busy?: boolean; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-[10px] font-medium disabled:opacity-35 ${danger ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-[#2a3942] text-[#d1d7db] hover:text-white'}`}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : icon}{label}
    </button>
  );
}

