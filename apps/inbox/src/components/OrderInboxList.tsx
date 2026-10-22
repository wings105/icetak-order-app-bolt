import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Clock3, CreditCard, Loader2, Package, RefreshCw,
  Search, ShoppingBag, StickyNote, Truck, X, XCircle,
} from 'lucide-react';
import { listExternalOrderPage, type ExternalOrderSummary } from '../lib/externalOrderSummaries';
import { useSearch } from '../lib/hooks';
import { supabase } from '../lib/supabase';
import { matchesOrderCategory, type OrderCategoryCounts, type OrderCategoryFilter as Category } from '../lib/orderCategories';
import { OrderCategoryFilter } from './OrderCategoryFilter';
import { OrderDesignFilter } from './OrderDesignFilter';
import { OrderDesignStatus } from './OrderDesignStatus';
import { matchesDesignFilter, type DesignFilter } from '../../../../supabase/functions/_shared/inbox-design-work.ts';

interface Props {
  selectedOrderId: string | null;
  onOrderSelect: (orderSummaryId: string, conversationId?: string | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

type OrderFilter = 'all' | 'unpaid' | 'to_ship' | 'shipping' | 'completed' | 'cancelled' | 'return';
type ChannelFilter = 'all' | 'shopee' | 'whatsapp';

const ORDER_FILTERS: Array<{ key: OrderFilter; label: string }> = [
  { key: 'all', label: 'Semua Aktif' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'to_ship', label: 'To Ship' },
  { key: 'shipping', label: 'Shipping' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancellation' },
  { key: 'return', label: 'Return/Refund' },
];

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function orderBucket(order: ExternalOrderSummary): OrderFilter {
  if (order.work_bucket) return order.work_bucket;
  const status = [order.order_status, order.shipment_status, order.fulfillment_status, order.payment_status]
    .filter(Boolean).join(' ').toUpperCase();
  if (/RETURN|REFUND/.test(status)) return 'return';
  if (/IN_CANCEL|CANCELLED|CANCELED|INVALID/.test(status)) return 'cancelled';
  if (/COMPLETED/.test(String(order.order_status ?? '').toUpperCase())) return 'completed';
  if (/DELIVERY_DONE|DELIVERED|TO_CONFIRM_RECEIVE/.test(status)) return 'completed';
  if (/SHIPPED|PICKUP_DONE|IN_TRANSIT|TO_RECEIVE|OUT_FOR_DELIVERY/.test(status)) return 'shipping';
  if (order.source_channel === 'whatsapp') {
    if (order.active_order) return 'to_ship';
    if (/CUSTOMER COLLECTED/.test(status) || /^(complete|completed|closed)$/i.test(String(order.metadata?.clickup_status ?? ''))
      || order.metadata?.clickup_open_task_count === 0) return 'completed';
  }
  if (/READY_TO_SHIP|PROCESSED|LOGISTICS_READY|REQUEST_CREATED/.test(status)) return 'to_ship';
  if (/UNPAID/.test(status)) return 'unpaid';
  return 'all';
}

function orderChannel(order: ExternalOrderSummary): 'shopee' | 'whatsapp' | 'other' {
  const value = order.source_channel.toLowerCase();
  if (value === 'whatsapp') return 'whatsapp';
  if (value === 'shopee') return 'shopee';
  return 'other';
}

function money(value?: number | null, currency = 'MYR'): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('ms-MY', { style: 'currency', currency }).format(Number(value));
}

function shortDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2020) return '—';
  return new Intl.DateTimeFormat('ms-MY', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(date);
}

function statusTone(order: ExternalOrderSummary): string {
  const bucket = orderBucket(order);
  if (bucket === 'completed') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  if (bucket === 'shipping') return 'bg-sky-500/15 text-sky-700 dark:text-sky-300';
  if (bucket === 'cancelled' || bucket === 'return') return 'bg-red-500/15 text-red-700 dark:text-red-300';
  if (bucket === 'to_ship') return 'bg-orange-500/15 text-orange-700 dark:text-orange-300';
  if (bucket === 'unpaid') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  return 'bg-[var(--surface-hover)] text-[var(--text-secondary)]';
}

function StatusIcon({ order }: { order: ExternalOrderSummary }) {
  const bucket = orderBucket(order);
  if (bucket === 'completed') return <CheckCircle2 size={16} className="text-emerald-700 dark:text-emerald-400" />;
  if (bucket === 'shipping') return <Truck size={16} className="text-sky-700 dark:text-sky-400" />;
  if (bucket === 'cancelled' || bucket === 'return') return <XCircle size={16} className="text-red-700 dark:text-red-400" />;
  if (bucket === 'to_ship') return <Package size={16} className="text-orange-700 dark:text-orange-400" />;
  if (bucket === 'unpaid') return <CreditCard size={16} className="text-amber-700 dark:text-amber-400" />;
  return <ShoppingBag size={16} className="text-[var(--text-secondary)]" />;
}

function OrderRow({ order, selected, onClick }: { order: ExternalOrderSummary; selected: boolean; onClick: () => void }) {
  const firstItem = order.items[0];
  const buyer = order.shopee_username || order.customer_name || order.customer_phone || 'Customer';
  const status = order.order_status || order.shipment_status || order.payment_status || 'Status belum ada';
  const channel = orderChannel(order);
  return (
    <button
      onClick={onClick}
      className={`w-full border-b border-[#222e35] px-3 py-3 text-left transition hover:bg-[var(--surface-muted)] ${selected ? 'bg-[var(--surface-hover)]' : 'bg-[var(--surface)]'}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--surface-muted)]">
          {firstItem?.image_url
            ? <img src={firstItem.image_url} alt="" className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center"><StatusIcon order={order} /></div>}
          <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-[#111b21] ${channel === 'whatsapp' ? 'bg-[#25d366]' : channel === 'shopee' ? 'bg-orange-500' : 'bg-[#8696a0]'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--text)]">{buyer}</p>
              <p className="mt-0.5 truncate text-[11px] font-medium text-orange-700 dark:text-orange-300">#{order.order_no}</p>
            </div>
            <span className="flex-shrink-0 text-[9px] text-[var(--text-secondary)]">{shortDate(order.order_updated_at || order.last_synced_at)}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
              {firstItem?.title || (order.detail_complete ? 'Detail item diterima' : 'Menunggu detail item')}
              {(order.item_count || order.items.length) > 1 ? ` +${(order.item_count || order.items.length) - 1}` : ''}
            </p>
            <span className="flex-shrink-0 text-xs font-semibold text-[var(--accent)]">{money(order.payment_total, order.currency || 'MYR')}</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${statusTone(order)}`}>{status}</span>
            {order.buyer_message && <span title="Ada nota checkout" className="inline-flex items-center gap-1 text-[9px] text-amber-700 dark:text-amber-300"><StickyNote size={10} />Nota</span>}
            {!order.detail_complete && <span className="text-[9px] text-[var(--text-secondary)]">Ringkasan</span>}
          </div>
          <OrderDesignStatus metadata={order.metadata} />
        </div>
      </div>
    </button>
  );
}

export function OrderInboxList({ selectedOrderId, onOrderSelect, searchQuery, onSearchChange }: Props) {
  const [orders, setOrders] = useState<ExternalOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilter>('to_ship');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [category, setCategory] = useState<Category>('all');
  const [categoryCounts, setCategoryCounts] = useState<OrderCategoryCounts>();
  const [design, setDesign] = useState<DesignFilter>('needs_design');
  const [designCounts, setDesignCounts] = useState<Partial<Record<DesignFilter, number>>>();
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState<Record<OrderFilter, number>>({all:0,to_ship:0,unpaid:0,shipping:0,completed:0,cancelled:0,return:0});
  const requestRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedSearch = useDebounce(searchQuery, 300);
  const isSearchMode = searchQuery.trim().length >= 2;
  const { results, loading: remoteLoading, error: searchError, retry } = useSearch(debouncedSearch);
  const queryMatches = searchQuery.trim() === debouncedSearch.trim();
  const [searchOrders, setSearchOrders] = useState<ExternalOrderSummary[]>([]);
  const [loadedSearchKey, setLoadedSearchKey] = useState('');
  const [detailError, setDetailError] = useState<string | null>(null);
  const currentResults = queryMatches ? results : [];
  const searchKey = JSON.stringify([debouncedSearch.trim(), currentResults.filter((row) => row.resultType === 'order').map((row) => row.orderSummaryId)]);
  const searchLoading = isSearchMode && (!queryMatches || remoteLoading || loadedSearchKey !== searchKey);

  useEffect(() => {
    const ids: string[] = JSON.parse(searchKey)[1];
    const controller = new AbortController();
    let cancelled = false;
    setSearchOrders([]);
    setDetailError(null);
    if (!ids.length) { setLoadedSearchKey(searchKey); return; }
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    void (async () => {
      try {
        const { data, error } = await supabase.from('external_order_summaries').select('*').in('id', ids).abortSignal(controller.signal);
        if (error) throw error;
        if (!cancelled) setSearchOrders((data ?? []) as ExternalOrderSummary[]);
      } catch (reason) {
        if (!cancelled) setDetailError(typeof reason === 'object' && reason !== null && 'message' in reason ? String(reason.message) : String(reason));
      } finally { window.clearTimeout(timeout); if (!cancelled) setLoadedSearchKey(searchKey); }
    })();
    return () => { cancelled = true; window.clearTimeout(timeout); controller.abort(); };
  }, [searchKey]);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const page = await listExternalOrderPage({
        mode: filter === 'all' || filter === 'to_ship' ? 'active' : 'all',
        channel: channelFilter, category, design, bucket: filter, offset, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (offset && offset >= page.total) { setOffset(0); return; }
      setOrders(page.orders);
      setTotal(page.total);
      setHasMore(page.has_more);
      setCounts(page.counts);
      setCategoryCounts(page.category_counts);
      setDesignCounts(page.design_counts);
    } catch (reason) {
      if (!controller.signal.aborted) setError(typeof (reason as { message?: unknown })?.message === 'string' ? String((reason as {message:string}).message) : String(reason));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [filter, channelFilter, category, design, offset]);

  useEffect(() => { void load(); return () => requestRef.current?.abort(); }, [load]);
  useEffect(() => {
    let timer: number | undefined;
    const channel = supabase.channel('order-inbox-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'external_order_summaries' }, () => {
        window.clearTimeout(timer); timer = window.setTimeout(() => { void load(); }, 300);
      })
      .subscribe();
    return () => { window.clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [load]);

  const orderById = useMemo(() => new Map([...orders, ...searchOrders].map((order) => [order.id, order])), [orders, searchOrders]);
  const remoteOrderIds = currentResults
    .filter((result) => result.resultType === 'order' && result.orderSummaryId)
    .map((result) => result.orderSummaryId as string);

  const visibleOrders = useMemo(() => {
    const source = isSearchMode
      ? remoteOrderIds.map((id) => orderById.get(id)).filter((order): order is ExternalOrderSummary => Boolean(order))
      : orders;
    return source.filter((order) => {
      if (channelFilter !== 'all' && orderChannel(order) !== channelFilter) return false;
      if (!matchesOrderCategory(order, category)) return false;
      if (!matchesDesignFilter(order, design)) return false;
      return filter === 'all' ? order.active_order : orderBucket(order) === filter;
    });
  }, [channelFilter, category, design, filter, isSearchMode, orderById, orders, remoteOrderIds]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] p-3">
        <div className="relative flex items-center">
          {(searchLoading || loading) && isSearchMode
            ? <Loader2 size={14} className="pointer-events-none absolute left-3 animate-spin text-orange-700 dark:text-orange-400" />
            : <Search size={14} className="pointer-events-none absolute left-3 text-[var(--text-secondary)]" />}
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Cari order ID, username, nota, item..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] py-2 pl-8 pr-8 text-sm text-[var(--text)] outline-none focus:border-orange-500"
          />
          {searchQuery && <button onClick={() => { onSearchChange(''); inputRef.current?.focus(); }} className="absolute right-3 text-[var(--text-secondary)] hover:text-[var(--text)]"><X size={14} /></button>}
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
          <span>{isSearchMode ? searchLoading ? 'Mencari…' : `${visibleOrders.length} hasil order` : loading ? 'Memuatkan order…' : `${total} order · sumber Order System`}</span>
          <button onClick={() => { void load(); }} className="inline-flex items-center gap-1 hover:text-[var(--text)]"><RefreshCw size={11} />Refresh</button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-2">
        {(['all', 'shopee', 'whatsapp'] as ChannelFilter[]).map((channel) => (
          <button key={channel} onClick={() => { setChannelFilter(channel); setOffset(0); }} className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${channelFilter === channel ? channel === 'whatsapp' ? 'bg-[#25d366] text-white' : channel === 'shopee' ? 'bg-orange-500 text-white' : 'bg-[#aebac1] text-[#111b21]' : 'bg-[var(--surface-muted)] text-[var(--text-secondary)]'}`}>
            {channel === 'all' ? 'Semua Channel' : channel === 'shopee' ? 'Shopee' : 'Decocake'}
          </button>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-2">
        {ORDER_FILTERS.map((item) => (
          <button key={item.key} onClick={() => { setFilter(item.key); setOffset(0); }} className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${filter === item.key ? 'bg-orange-500 text-white' : 'bg-[var(--surface-muted)] text-[var(--text-secondary)]'}`}>
            {item.label}{counts[item.key] > 0 && <span className="ml-1 opacity-80">{counts[item.key]}</span>}
          </button>
        ))}
      </div>

      <div className="border-b border-[var(--border)] px-3 py-2">
        <OrderCategoryFilter value={category} counts={isSearchMode ? undefined : categoryCounts} onChange={(value) => { setCategory(value); setOffset(0); }} />
        <div className="mt-2"><OrderDesignFilter value={design} counts={isSearchMode ? undefined : designCounts} onChange={(value) => { setDesign(value); setOffset(0); }} /></div>
        {!isSearchMode && design !== 'unknown' && (designCounts?.unknown ?? 0) > 0 && <button onClick={() => { setDesign('unknown'); setOffset(0); }} className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-300">{designCounts?.unknown} order perlu semakan status task</button>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isSearchMode && (searchError || detailError) ? (
          <div className="m-3 rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">Carian gagal. <button onClick={retry}>Cuba semula carian</button></div>
        ) : error ? (
          <div className="m-3 rounded-lg border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300"><AlertCircle size={14} className="mb-1" />{error}</div>
        ) : (isSearchMode ? searchLoading : loading && orders.length === 0) ? (
          <div className="flex h-40 items-center justify-center gap-2 text-xs text-[var(--text-secondary)]"><Loader2 size={16} className="animate-spin" />Memuatkan order…</div>
        ) : visibleOrders.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-[var(--text-secondary)]"><Clock3 size={24} /><p className="text-xs">Tiada order untuk paparan ini.</p></div>
        ) : visibleOrders.map((order) => (
          <OrderRow key={order.id} order={order} selected={selectedOrderId === order.id} onClick={() => onOrderSelect(order.id, null)} />
        ))}
        {!isSearchMode && total > 100 && <div className="flex items-center justify-between gap-2 p-3 text-xs text-[var(--text-secondary)]">
          <button disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 100))} className="rounded bg-[var(--surface-muted)] px-2 py-1 disabled:opacity-40">Sebelum</button>
          <span>{offset + 1}–{Math.min(offset + orders.length, total)} / {total}</span>
          <button disabled={loading || !hasMore} onClick={() => setOffset((value) => value + 100)} className="rounded bg-[var(--surface-muted)] px-2 py-1 disabled:opacity-40">Seterusnya</button>
        </div>}
      </div>
    </div>
  );
}
