import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import './OrdersEnterprise.css';
import OrderItemStructuralEditor from '../components/OrderItemStructuralEditor';

type SortKey = 'urgency' | 'date_need' | 'created_at' | 'paid_at' | 'total' | 'customer' | 'updated_at';
type SortDir = 'asc' | 'desc';
type QuickView = 'active' | 'today' | 'overdue' | 'tomorrow' | 'to_pay' | 'cash' | 'design' | 'production' | 'ready_pickup' | 'shipping' | 'problem' | 'completed' | 'all';
type ColumnKey = 'created' | 'need' | 'customer' | 'items' | 'payment' | 'delivery' | 'production' | 'whatsapp' | 'updated' | 'action';

type Filters = {
  view: QuickView;
  customerToken?: string;
  createdFrom?: string;
  createdTo?: string;
  needFrom?: string;
  needTo?: string;
  paidFrom?: string;
  paidTo?: string;
  payment?: string;
  delivery?: string;
  production?: string;
  clickup?: string;
  whatsapp?: string;
  amountMin?: string;
  amountMax?: string;
};

type OrderRow = {
  dbId: string;
  id: string;
  orderToken?: string;
  customerToken?: string;
  customerName?: string;
  customerPhone?: string;
  adminStatus?: string;
  status?: string;
  dateNeed?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  total?: number;
  deliveryFee?: number;
  payment?: string;
  paymentMethod?: string;
  paidAt?: string | null;
  paymentVerifiedBy?: string;
  delivery?: string;
  courier?: string;
  tracking?: string;
  trackingLink?: string;
  shipmentStatus?: string;
  shipmentStatusGroup?: string;
  fulfillmentStage?: string;
  productionApproved?: boolean;
  customerConfirmed?: boolean;
  awaitingCustomerConfirmation?: boolean;
  productionCompletedAt?: string | null;
  pickupReadyAt?: string | null;
  pickupCollectedAt?: string | null;
  deliveredAt?: string | null;
  whatsappEnabled?: boolean;
  adminRemark?: string;
  clickupOrderTaskId?: string;
  clickupOrderUrl?: string;
  componentsTotal?: number;
  componentsLinked?: number;
  reviewPending?: number;
  progressPercent?: number;
  clickupSyncStatus?: string;
  itemsCount?: number;
  itemSummary?: string;
  lastNotificationStatus?: string;
  lastNotificationEvent?: string;
  lastNotificationAt?: string | null;
  lastNotificationError?: string;
  isCancelled?: boolean;
  isCompleted?: boolean;
  isUnpaid?: boolean;
  isCash?: boolean;
  isNew?: boolean;
  isProblem?: boolean;
  urgencyRank?: number;
  thumbnailUrl?: string;
};

type Summary = {
  all?: number; active?: number; today?: number; overdue?: number; tomorrow?: number;
  toPay?: number; cash?: number; design?: number; production?: number; readyPickup?: number;
  shipping?: number; problem?: number; completed?: number;
};

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };
type ListResponse = { rows?: OrderRow[]; summary?: Summary; pagination?: Pagination; serverTime?: string };
type SavedView = { id: string; name: string; filters: Filters; sortKey: SortKey; sortDir: SortDir; visibleColumns: ColumnKey[]; isDefault?: boolean };
type PickupAutoSettings = { auto_send_enabled?: boolean; delay_minutes?: number; provider_name?: string; provider_ready?: boolean; template_name?: string; auto_send_activated_at?: string | null; pending?: number; sent?: number; failed?: number };
type CustomerProfile = { customer_id?: string | null; customer_master_id?: string | null; name?: string; phone?: string; locked?: boolean; admin_name_override?: string | null; admin_name_updated_at?: string | null; admin_name_updated_by?: string | null; master_display_name?: string | null; source?: string | null };

type OrderItem = {
  id: string; k?: string; title?: string; qty?: number; price?: number; size?: string; style?: string;
  customText?: string; workflow?: string; reviewRequired?: boolean; previewUrl?: string;
  components?: Array<{ id: string; label?: string; workflow?: string; customerLabel?: string; reviewStatus?: string; previewUrl?: string; progressPercent?: number; clickupTaskId?: string; clickupStatus?: string }>;
};
type PaymentRow = { id: string; provider?: string; transactionId?: string; amount?: number; paidAt?: string; senderName?: string };
type OrderDetail = {
  order: OrderRow & { deliveryName?: string; deliveryPhone?: string; deliveryAddress?: string; deliveryCity?: string; deliveryPostcode?: string; deliveryState?: string; recipientLocked?: boolean; customerConfirmedAt?: string | null };
  items: OrderItem[];
  payments: PaymentRow[];
  notifications: Array<{ id: string; eventType?: string; status?: string; attempts?: number; at?: string; error?: string; mode?: string }>;
  timeline: Array<{ type?: string; label?: string; at?: string; actor?: string; detail?: Record<string, unknown> }>;
};

type Props = { permissions?: string[]; initialOrder?: string };

type RecipientForm = {
  name: string;
  phone: string;
  address: string;
  postcode: string;
  city: string;
  state: string;
};

type AddressFetchResult = {
  ok?: boolean;
  found?: boolean;
  error?: string;
  customer?: { name?: string; phone?: string };
  address?: { address_line1?: string; postcode?: string; city?: string; state?: string };
};

const ALL_COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: 'created', label: 'Created' }, { key: 'need', label: 'Need By' }, { key: 'customer', label: 'Customer' },
  { key: 'items', label: 'Items' }, { key: 'payment', label: 'Payment' }, { key: 'delivery', label: 'Delivery' },
  { key: 'production', label: 'Production' }, { key: 'whatsapp', label: 'WhatsApp' }, { key: 'updated', label: 'Updated' }, { key: 'action', label: 'Action' },
];
const DEFAULT_COLUMNS: ColumnKey[] = ALL_COLUMNS.map((c) => c.key);
const QUICK_VIEWS: Array<{ key: QuickView; label: string; count: keyof Summary }> = [
  { key: 'active', label: 'Active', count: 'active' }, { key: 'today', label: 'Today', count: 'today' },
  { key: 'overdue', label: 'Overdue', count: 'overdue' }, { key: 'tomorrow', label: 'Tomorrow', count: 'tomorrow' },
  { key: 'to_pay', label: 'To Pay', count: 'toPay' }, { key: 'cash', label: 'Cash', count: 'cash' },
  { key: 'design', label: 'Design', count: 'design' }, { key: 'production', label: 'Production', count: 'production' },
  { key: 'ready_pickup', label: 'Ready Pickup', count: 'readyPickup' }, { key: 'shipping', label: 'Shipping', count: 'shipping' },
  { key: 'problem', label: 'Problem', count: 'problem' }, { key: 'completed', label: 'Completed', count: 'completed' },
  { key: 'all', label: 'All', count: 'all' },
];

const money = (v: unknown) => `RM ${Number(v || 0).toFixed(2)}`;
const digits = (v: unknown) => String(v || '').replace(/\D/g, '');
const norm = (v: unknown) => String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const canUndoSyntheticManualPayment = (payment: PaymentRow) => norm(payment.provider) === 'manual_qrpay' && String(payment.transactionId || '').startsWith('draft_manual:');
const localDateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const formatDate = (value?: string | null) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const formatDateTime = (value?: string | null) => value ? new Date(value).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const shortDateTime = (value?: string | null) => value ? new Date(value).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

function customerOrderLink(order: Pick<OrderRow, 'orderToken'>) {
  if (!order.orderToken) return '';
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('order', order.orderToken);
  return url.toString();
}

function urgency(dateNeed?: string | null, closed = false) {
  if (closed || !dateNeed) return null;
  const today = localDateKey();
  const tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localDateKey(tomorrowDate);
  if (dateNeed < today) return { label: 'OVERDUE', cls: 'danger' };
  if (dateNeed === today) return { label: 'TODAY', cls: 'danger' };
  if (dateNeed === tomorrow) return { label: 'TOMORROW', cls: 'warning' };
  const diff = Math.ceil((new Date(`${dateNeed}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  return diff <= 7 ? { label: `${diff} DAYS`, cls: 'info' } : null;
}

function readUrlState() {
  const p = new URLSearchParams(window.location.search);
  let extra: Partial<Filters> = {};
  try { extra = JSON.parse(p.get('filters') || '{}') as Partial<Filters>; } catch { extra = {}; }
  const view = (p.get('view') || extra.view || 'active') as QuickView;
  const sort = (p.get('sort') || 'urgency') as SortKey;
  const dir = (p.get('dir') === 'desc' ? 'desc' : 'asc') as SortDir;
  return { query: p.get('q') || '', filters: { ...extra, view } as Filters, sort, dir, explicit: p.has('view') || p.has('filters') || p.has('q') || p.has('sort') };
}

export default function Orders({ permissions = [], initialOrder = '' }: Props) {
  const initial = useMemo(() => readUrlState(), []);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [summary, setSummary] = useState<Summary>({});
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [query, setQuery] = useState(initial.query);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [sortKey, setSortKey] = useState<SortKey>(initial.sort);
  const [sortDir, setSortDir] = useState<SortDir>(initial.dir);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(Number(localStorage.getItem('icetak_orders_page_size') || 50));
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => {
    try { const x = JSON.parse(localStorage.getItem('icetak_orders_columns') || '[]') as ColumnKey[]; return x.length ? x : DEFAULT_COLUMNS; } catch { return DEFAULT_COLUMNS; }
  });
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savedViewId, setSavedViewId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailRef, setDetailRef] = useState(initialOrder || '');
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pickupAuto, setPickupAuto] = useState<PickupAutoSettings | null>(null);
  const [pickupAutoBusy, setPickupAutoBusy] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const can = (permission: string) => permissions.includes(permission);

  const loadSavedViews = useCallback(async () => {
    const { data } = await supabase.rpc('icetak_admin_order_saved_views');
    const list = Array.isArray(data) ? data as SavedView[] : [];
    setSavedViews(list);
    if (!initial.explicit) {
      const preferred = list.find((v) => v.isDefault);
      if (preferred) {
        setSavedViewId(preferred.id); setFilters(preferred.filters); setSortKey(preferred.sortKey); setSortDir(preferred.sortDir); setVisibleColumns(preferred.visibleColumns || DEFAULT_COLUMNS);
      }
    }
  }, [initial.explicit]);

  const loadPickupAuto = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_pickup_auto_settings');
    if (!rpcError) setPickupAuto((data || null) as PickupAutoSettings | null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_orders_enterprise', {
      p_query: query,
      p_filters: filters,
      p_sort: sortKey,
      p_direction: sortDir,
      p_page: page,
      p_page_size: pageSize,
    });
    if (rpcError) { setLoading(false); setError(rpcError.message); return; }
    const result = (data || {}) as ListResponse;
    let nextRows = result.rows || [];
    if (nextRows.length) {
      const { data: thumbnailRows, error: thumbnailError } = await supabase.rpc('icetak_admin_order_thumbnails', {
        p_order_ids: nextRows.map((row) => row.dbId),
      });
      if (!thumbnailError && Array.isArray(thumbnailRows)) {
        const thumbMap = new Map<string, string>(thumbnailRows.map((row: any) => [String(row.order_id || ''), String(row.thumbnail_url || '')]));
        nextRows = nextRows.map((row) => ({ ...row, thumbnailUrl: thumbMap.get(row.dbId) || '' }));
      }
    }
    setRows(nextRows);
    setSummary(result.summary || {});
    setPagination(result.pagination || { page, pageSize, total: 0, totalPages: 1 });
    setLoading(false);
  }, [query, filters, sortKey, sortDir, page, pageSize]);

  const loadDetail = useCallback(async (ref: string) => {
    if (!ref) { setDetail(null); return; }
    setDetailLoading(true);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_order_detail_v2', { p_order_ref: ref });
    setDetailLoading(false);
    if (rpcError) { setError(rpcError.message); setDetail(null); return; }
    setDetail((data || null) as OrderDetail | null);
  }, []);

  useEffect(() => { void loadSavedViews(); }, [loadSavedViews]);
  useEffect(() => { void loadPickupAuto(); }, [loadPickupAuto]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 220); return () => window.clearTimeout(t); }, [load]);
  useEffect(() => { if (detailRef) void loadDetail(detailRef); else setDetail(null); }, [detailRef, loadDetail]);
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(null), 3200); return () => window.clearTimeout(t); }, [notice]);
  useEffect(() => { setSelectedIds([]); }, [page, filters, query]);
  useEffect(() => { localStorage.setItem('icetak_orders_columns', JSON.stringify(visibleColumns)); }, [visibleColumns]);
  useEffect(() => { localStorage.setItem('icetak_orders_page_size', String(pageSize)); }, [pageSize]);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('admin', 'v2');
    url.searchParams.set('view', filters.view);
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    url.searchParams.set('sort', sortKey); url.searchParams.set('dir', sortDir);
    const extra = { ...filters } as Record<string, unknown>; delete extra.view;
    Object.keys(extra).forEach((k) => { if (!extra[k]) delete extra[k]; });
    if (Object.keys(extra).length) url.searchParams.set('filters', JSON.stringify(extra)); else url.searchParams.delete('filters');
    if (detailRef) url.searchParams.set('order', detailRef); else url.searchParams.delete('order');
    window.history.replaceState({}, '', url);
  }, [filters, query, sortKey, sortDir, detailRef]);

  const setView = (view: QuickView) => { setFilters((f) => ({ ...f, view })); setPage(1); setSavedViewId(''); };
  const updateFilter = (key: keyof Filters, value: string) => { setFilters((f) => ({ ...f, [key]: value || undefined })); setPage(1); setSavedViewId(''); };
  const clearAdvanced = () => { setFilters({ view: filters.view }); setQuery(''); setPage(1); setSavedViewId(''); };
  const changeSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'created_at' || key === 'updated_at' || key === 'paid_at' ? 'desc' : 'asc'); }
    setPage(1); setSavedViewId('');
  };

  const togglePickupAuto = async () => {
    if (!pickupAuto) return;
    const next = !pickupAuto.auto_send_enabled;
    const message = next
      ? `Hidupkan Pickup Auto Send? Hanya order pickup yang menjadi Ready selepas switch ON akan dihantar ${pickupAuto.delay_minutes || 10} minit kemudian.`
      : 'Matikan Pickup Auto Send? Semua pickup notification yang masih pending akan dibatalkan.';
    if (!window.confirm(message)) return;
    setPickupAutoBusy(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_set_pickup_auto_send', { p_enabled: next });
    setPickupAutoBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    setPickupAuto((data || null) as PickupAutoSettings | null);
    setNotice(`Pickup Auto Send ${next ? 'ON' : 'OFF'}.`);
  };

  const copy = async (value: string, message: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setNotice(message);
  };
  const openDetail = (order: OrderRow) => { setDetailRef(order.id || order.dbId); setMenuId(null); };
  const closeDetail = () => { setDetailRef(''); setDetail(null); };

  const action = async (order: OrderRow, name: string) => {
    const labels: Record<string, string> = {
      approve_production: 'Approve order untuk production?', cancel: 'Cancel order ini?', ready_pickup: 'Tandakan order siap untuk pickup?',
      pickup_collected: 'Sahkan customer sudah ambil order?', set_pay_at_pickup: 'Tukar kepada Bayar Semasa Pickup?', confirm_cash_paid: 'Sahkan bayaran cash sudah diterima?',
    };
    if (labels[name] && !window.confirm(labels[name])) return;
    setBusyId(order.dbId); setError(null);
    const { error: rpcError } = await supabase.rpc('icetak_admin_order_action', { p_payload: { order_db_id: order.dbId, order_id: order.id, action: name } });
    setBusyId(null);
    if (rpcError) { setError(rpcError.message); return; }
    setNotice(`${order.id}: ${name.replaceAll('_', ' ')} berjaya.`);
    await load();
    if (detailRef) await loadDetail(order.dbId || order.id);
  };

  const toggleWhatsapp = async (order: OrderRow) => {
    const next = !order.whatsappEnabled;
    if (!window.confirm(next ? `Aktifkan WhatsApp untuk ${order.id}?` : `Matikan WhatsApp untuk ${order.id}? Pending notification akan dibatalkan.`)) return;
    setBusyId(order.dbId);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_set_order_whatsapp', { p_order_no: order.id, p_enabled: next });
    setBusyId(null);
    if (rpcError) { setError(rpcError.message); return; }
    const result = (data || {}) as { cancelled_pending?: number };
    setNotice(`${order.id}: WhatsApp ${next ? 'ON' : 'OFF'}${result.cancelled_pending ? ` · ${result.cancelled_pending} pending cancelled` : ''}`);
    await load(); if (detailRef) await loadDetail(order.dbId || order.id);
  };

  const bulkWhatsapp = async (enabled: boolean) => {
    if (!selectedIds.length) return;
    if (!window.confirm(`${enabled ? 'Aktifkan' : 'Matikan'} WhatsApp untuk ${selectedIds.length} order terpilih?`)) return;
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_orders_bulk_whatsapp', { p_order_ids: selectedIds, p_enabled: enabled });
    if (rpcError) { setError(rpcError.message); return; }
    const result = (data || {}) as { changed?: number; cancelledPending?: number };
    setNotice(`${result.changed || selectedIds.length} order: WhatsApp ${enabled ? 'ON' : 'OFF'}${result.cancelledPending ? ` · ${result.cancelledPending} pending cancelled` : ''}`);
    setSelectedIds([]); await load();
  };

  const exportSelected = () => {
    const selected = rows.filter((r) => selectedIds.includes(r.dbId));
    if (!selected.length) return;
    const cells = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const csv = [
      ['Order ID','Created','Need By','Customer','Phone','Items','Payment','Paid At','Total','Delivery','Tracking','Production','ClickUp','WhatsApp','Updated'].map(cells).join(','),
      ...selected.map((r) => [r.id,r.createdAt,r.dateNeed,r.customerName,r.customerPhone,r.itemSummary,r.payment,r.paidAt,r.total,r.delivery,r.tracking,r.productionApproved ? 'Approved':'Waiting',r.clickupSyncStatus,r.whatsappEnabled ? 'ON':'OFF',r.updatedAt].map(cells).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `icetak-orders-${localDateKey()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const saveView = async () => {
    const existing = savedViews.find((v) => v.id === savedViewId);
    const name = window.prompt('Nama Saved View', existing?.name || ''); if (!name?.trim()) return;
    const makeDefault = window.confirm('Jadikan view ini default bila buka Orders?');
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_order_saved_view_save', { p_payload: { id: existing?.id, name: name.trim(), filters, sortKey, sortDir, visibleColumns, isDefault: makeDefault } });
    if (rpcError) { setError(rpcError.message); return; }
    setSavedViewId(String((data as SavedView)?.id || '')); setNotice(`Saved View “${name.trim()}” disimpan.`); await loadSavedViews();
  };
  const applySavedView = (id: string) => {
    setSavedViewId(id); const view = savedViews.find((v) => v.id === id); if (!view) return;
    setFilters(view.filters || { view: 'active' }); setSortKey(view.sortKey || 'urgency'); setSortDir(view.sortDir || 'asc'); setVisibleColumns(view.visibleColumns?.length ? view.visibleColumns : DEFAULT_COLUMNS); setPage(1);
  };
  const deleteSavedView = async () => {
    if (!savedViewId || !window.confirm('Delete Saved View ini?')) return;
    const { error: rpcError } = await supabase.rpc('icetak_admin_order_saved_view_delete', { p_id: savedViewId });
    if (rpcError) { setError(rpcError.message); return; }
    setSavedViewId(''); setNotice('Saved View dipadam.'); await loadSavedViews();
  };

  const allPageSelected = rows.length > 0 && rows.every((r) => selectedIds.includes(r.dbId));
  const toggleAll = () => setSelectedIds(allPageSelected ? [] : rows.map((r) => r.dbId));
  const toggleOne = (id: string) => setSelectedIds((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]);
  const visible = (key: ColumnKey) => visibleColumns.includes(key);

  return <div className="fade-in erp-orders">
    <div className="page-header erp-orders-header">
      <div><div className="page-label">Order Operations</div><h1 className="page-title">Orders Work Queue</h1><p className="page-subtitle">Prioritised by due date · server-side filters · audit-ready lifecycle</p></div>
      <div className="erp-header-actions">{pickupAuto && <div className={`erp-pickup-auto ${pickupAuto.auto_send_enabled ? 'on' : 'off'}`}><div><b>Pickup Auto {pickupAuto.auto_send_enabled ? 'ON' : 'OFF'}</b><span>{pickupAuto.delay_minutes || 10} min after ClickUp Complete · {pickupAuto.provider_ready ? 'Wasapflow Ready' : 'Provider Not Ready'}</span></div><button className={`btn btn-sm ${pickupAuto.auto_send_enabled ? 'btn-outline' : 'btn-primary'}`} disabled={pickupAutoBusy || (!pickupAuto.provider_ready && !pickupAuto.auto_send_enabled)} onClick={() => void togglePickupAuto()}>{pickupAutoBusy ? 'Saving…' : pickupAuto.auto_send_enabled ? 'Turn OFF' : 'Turn ON'}</button></div>}<button className="btn btn-outline" onClick={() => { void load(); void loadPickupAuto(); }}>Refresh</button></div>
    </div>

    <div className="erp-summarybar">
      <SummaryMetric label="Active" value={summary.active} tone="dark" /><SummaryMetric label="Today" value={summary.today} tone={(summary.today || 0) ? 'warning' : 'neutral'} />
      <SummaryMetric label="Overdue" value={summary.overdue} tone={(summary.overdue || 0) ? 'danger' : 'neutral'} /><SummaryMetric label="To Pay" value={summary.toPay} tone="neutral" />
      <SummaryMetric label="Problem" value={summary.problem} tone={(summary.problem || 0) ? 'danger' : 'neutral'} /><SummaryMetric label="All" value={summary.all} tone="neutral" />
    </div>

    {notice && <div className="erp-notice success">✓ {notice}</div>}
    {error && <div className="erp-notice error">{error}</div>}

    <div className="panel erp-orders-panel">
      <div className="erp-quickviews">
        {QUICK_VIEWS.map((v) => <button key={v.key} className={`erp-view-chip ${filters.view === v.key ? 'active' : ''} ${v.key === 'overdue' && Number(summary.overdue || 0) > 0 ? 'alert' : ''}`} onClick={() => setView(v.key)}>{v.label}<b>{Number(summary[v.count] || 0)}</b></button>)}
      </div>

      <div className="erp-toolbar">
        <div className="erp-search"><span>⌕</span><input placeholder="Search order, customer, phone, tracking, item..." value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></div>
        <button className={`btn btn-outline ${showAdvanced ? 'active-tool' : ''}`} onClick={() => setShowAdvanced((v) => !v)}>Filters</button>
        <div className="erp-sort"><select value={sortKey} onChange={(e) => { setSortKey(e.target.value as SortKey); setPage(1); }}><option value="urgency">Urgency</option><option value="date_need">Need By</option><option value="created_at">Created</option><option value="paid_at">Payment Date</option><option value="total">Amount</option><option value="customer">Customer</option><option value="updated_at">Last Updated</option></select><button className="btn btn-outline" title="Toggle sort direction" onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')}>{sortDir === 'asc' ? '↑' : '↓'}</button></div>
        <select className="erp-saved-select" value={savedViewId} onChange={(e) => applySavedView(e.target.value)}><option value="">Saved Views</option>{savedViews.map((v) => <option key={v.id} value={v.id}>{v.isDefault ? '★ ' : ''}{v.name}</option>)}</select>
        <button className="btn btn-outline" onClick={() => void saveView()}>Save View</button>
        {savedViewId && <button className="btn btn-ghost" onClick={() => void deleteSavedView()}>Delete View</button>}
        <button className={`btn btn-outline ${showColumns ? 'active-tool' : ''}`} onClick={() => setShowColumns((v) => !v)}>Columns</button>
      </div>

      {showAdvanced && <AdvancedFilters filters={filters} onChange={updateFilter} onClear={clearAdvanced} />}
      {showColumns && <div className="erp-column-panel"><b>Visible columns</b><div>{ALL_COLUMNS.map((c) => <label key={c.key}><input type="checkbox" checked={visible(c.key)} onChange={() => setVisibleColumns((old) => old.includes(c.key) ? old.filter((x) => x !== c.key) : [...old, c.key])} /> {c.label}</label>)}</div><button className="btn btn-ghost btn-sm" onClick={() => setVisibleColumns(DEFAULT_COLUMNS)}>Reset</button></div>}
      {filters.customerToken && <div className="erp-filter-token">Customer history filter active <button onClick={() => updateFilter('customerToken', '')}>× Clear</button></div>}

      {selectedIds.length > 0 && <div className="erp-bulkbar"><b>{selectedIds.length} selected</b><button className="btn btn-outline btn-sm" onClick={exportSelected}>Export CSV</button><button className="btn btn-outline btn-sm" onClick={() => void bulkWhatsapp(true)}>WhatsApp ON</button><button className="btn btn-outline btn-sm" onClick={() => void bulkWhatsapp(false)}>WhatsApp OFF</button><button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds([])}>Clear</button><span>Risky actions such as Cancel are intentionally not available in bulk.</span></div>}

      <div className="table-wrap erp-table-wrap">
        {loading ? <div className="loading"><span className="spinner" /> Loading work queue...</div> : rows.length === 0 ? <div className="empty"><div className="empty-title">No orders found</div><p>Try another view or clear filters.</p></div> : <table className="erp-order-table">
          <thead><tr>
            <th className="erp-check"><input type="checkbox" checked={allPageSelected} onChange={toggleAll} /></th><th>Order</th>
            {visible('created') && <SortableTh label="Created" active={sortKey === 'created_at'} dir={sortDir} onClick={() => changeSort('created_at')} />}
            {visible('need') && <SortableTh label="Need By" active={sortKey === 'date_need' || sortKey === 'urgency'} dir={sortDir} onClick={() => changeSort('date_need')} />}
            {visible('customer') && <SortableTh label="Customer" active={sortKey === 'customer'} dir={sortDir} onClick={() => changeSort('customer')} />}
            {visible('items') && <th>Items</th>}
            {visible('payment') && <SortableTh label="Payment" active={sortKey === 'paid_at' || sortKey === 'total'} dir={sortDir} onClick={() => changeSort('paid_at')} />}
            {visible('delivery') && <th>Delivery</th>}{visible('production') && <th>Production / ClickUp</th>}{visible('whatsapp') && <th>WhatsApp</th>}
            {visible('updated') && <SortableTh label="Updated" active={sortKey === 'updated_at'} dir={sortDir} onClick={() => changeSort('updated_at')} />}{visible('action') && <th>Next Action</th>}
          </tr></thead>
          <tbody>{rows.map((order) => <OrderTableRow key={order.dbId} order={order} selected={selectedIds.includes(order.dbId)} visible={visible} busy={busyId === order.dbId} can={can} menuOpen={menuId === order.dbId} onToggle={() => toggleOne(order.dbId)} onOpen={() => openDetail(order)} onCustomer={() => updateFilter('customerToken', order.customerToken || '')} onMenu={() => setMenuId(menuId === order.dbId ? null : order.dbId)} onAction={(name) => void action(order, name)} onWhatsapp={() => void toggleWhatsapp(order)} onCopy={copy} onPreview={(url) => setImagePreview(url)} />)}</tbody>
        </table>}
      </div>

      <div className="erp-pagination"><div>Showing {pagination.total ? (pagination.page - 1) * pagination.pageSize + 1 : 0}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of <b>{pagination.total}</b></div><div className="erp-page-controls"><select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}><option value={25}>25 / page</option><option value={50}>50 / page</option><option value={100}>100 / page</option></select><button className="btn btn-outline btn-sm" disabled={pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button><span>Page <b>{pagination.page}</b> / {pagination.totalPages}</span><button className="btn btn-outline btn-sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}>Next</button></div></div>
    </div>

    {(detailRef || detailLoading) && <OrderDrawer detail={detail} loading={detailLoading} permissions={permissions} busyId={busyId} onClose={closeDetail} onReload={async () => { await load(); if (detailRef) await loadDetail(detail?.order.dbId || detailRef); }} onAction={(o, name) => void action(o, name)} onWhatsapp={(o) => void toggleWhatsapp(o)} onCopy={copy} />}
    {imagePreview && <ImageLightbox url={imagePreview} onClose={() => setImagePreview('')} />}
  </div>;
}

function OrderTableRow({ order, selected, visible, busy, can, menuOpen, onToggle, onOpen, onCustomer, onMenu, onAction, onWhatsapp, onCopy, onPreview }: {
  order: OrderRow; selected: boolean; visible: (key: ColumnKey) => boolean; busy: boolean; can: (p: string) => boolean; menuOpen: boolean;
  onToggle: () => void; onOpen: () => void; onCustomer: () => void; onMenu: () => void; onAction: (name: string) => void; onWhatsapp: () => void; onCopy: (value: string, message: string) => Promise<void>; onPreview: (url: string) => void;
}) {
  const due = urgency(order.dateNeed, Boolean(order.isCompleted || order.isCancelled));
  const link = customerOrderLink(order);
  const next = nextAction(order, can);
  const phone = digits(order.customerPhone);
  return <tr className={`row-hover ${order.isProblem ? 'erp-row-problem' : ''} ${due?.cls === 'danger' ? 'erp-row-urgent' : ''}`}>
    <td className="erp-check"><input type="checkbox" checked={selected} onChange={onToggle} /></td>
    <td><div className="erp-order-idline"><button className="erp-order-id" onClick={onOpen}>{order.id}</button><button className="erp-mini-icon" title="Copy Order ID" onClick={() => void onCopy(order.id, 'Order ID copied')}>⧉</button><button className="erp-mini-icon" title={link ? 'Copy customer order link' : 'Customer link unavailable'} disabled={!link} onClick={() => void onCopy(link, 'Customer order link copied')}>↗</button></div><div className="erp-statusline"><span className={`erp-status-pill ${order.isCancelled ? 'danger' : order.isCompleted ? 'success' : order.isProblem ? 'danger' : 'neutral'}`}>{order.adminStatus || order.status || '—'}</span>{order.awaitingCustomerConfirmation && <span className="erp-status-pill warning">WAITING CUSTOMER</span>}</div></td>
    {visible('created') && <td><b>{formatDate(order.createdAt?.slice(0, 10))}</b><div className="cell-sub">{shortDateTime(order.createdAt)}</div></td>}
    {visible('need') && <td><b>{formatDate(order.dateNeed)}</b>{due && <div><span className={`erp-urgency ${due.cls}`}>{due.label}</span></div>}</td>}
    {visible('customer') && <td><button className="erp-customer-name" onClick={onCustomer}>{order.customerName || 'Guest'}</button><div>{phone ? <a className="erp-phone" href={`tel:${phone}`}>{order.customerPhone}</a> : <span className="cell-sub">No phone</span>}</div></td>}
    {visible('items') && <td><div className="erp-items-cell">{order.thumbnailUrl && <button type="button" className="erp-order-thumb" title="Preview design" onClick={() => onPreview(order.thumbnailUrl || '')}><img src={order.thumbnailUrl} alt="Order preview" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></button>}<div className="erp-items-summary"><b>{order.itemsCount || 0} item{Number(order.itemsCount || 0) === 1 ? '' : 's'}</b><span>{order.itemSummary || '—'}</span></div></div></td>}
    {visible('payment') && <td><div className="erp-payment"><span className={`erp-status-pill ${order.isUnpaid ? 'warning' : 'success'}`}>{order.isUnpaid ? (order.isCash ? 'CASH DUE' : 'UNPAID') : 'PAID'}</span><b>{money(order.total)}</b></div><div className="cell-sub">{order.paidAt ? `Paid ${shortDateTime(order.paidAt)}` : order.paymentMethod || order.payment || '—'}</div></td>}
    {visible('delivery') && <td><b>{order.delivery || '—'}</b>{order.courier && <div className="cell-sub">{order.courier}</div>}{order.tracking && <a className="erp-inline-link" href={order.trackingLink || '#'} target="_blank" rel="noreferrer">{order.tracking}</a>}</td>}
    {visible('production') && <td><div className="erp-production"><div><b>{productionLabel(order)}</b>{Number(order.reviewPending || 0) > 0 && <span className="erp-status-pill warning">{order.reviewPending} REVIEW</span>}</div><div className="erp-progress"><i style={{ width: `${Math.max(0, Math.min(100, Number(order.progressPercent || 0)))}%` }} /></div><div className="cell-sub">ClickUp {order.componentsLinked || 0}/{order.componentsTotal || 0} · {order.clickupSyncStatus || '—'}{order.clickupOrderUrl && <> · <a className="erp-inline-link" href={order.clickupOrderUrl} target="_blank" rel="noreferrer">Open</a></>}</div></div></td>}
    {visible('whatsapp') && <td><button className={`erp-wa-toggle ${order.whatsappEnabled ? 'on' : 'off'}`} disabled={busy} onClick={onWhatsapp}>{order.whatsappEnabled ? 'ON' : 'OFF'}</button><div className={`cell-sub ${norm(order.lastNotificationStatus) === 'failed' ? 'erp-text-danger' : ''}`}>{order.lastNotificationEvent || 'No notification'}{order.lastNotificationAt ? ` · ${shortDateTime(order.lastNotificationAt)}` : ''}</div></td>}
    {visible('updated') && <td><b>{shortDateTime(order.updatedAt)}</b><div className="cell-sub">Last activity</div></td>}
    {visible('action') && <td><div className="erp-action-cell"><button className={`btn btn-sm ${next.tone === 'primary' ? 'btn-primary' : 'btn-outline'}`} disabled={busy || next.disabled} onClick={() => next.action ? onAction(next.action) : onOpen()}>{busy ? 'Working…' : next.label}</button><div className="erp-more-wrap"><button className="erp-more" onClick={onMenu}>⋯</button>{menuOpen && <div className="erp-more-menu"><button onClick={onOpen}>View Details</button><button onClick={() => void onCopy(order.id, 'Order ID copied')}>Copy Order ID</button>{link && <><button onClick={() => void onCopy(link, 'Customer order link copied')}>Copy Customer Link</button><a href={link} target="_blank" rel="noreferrer">Open Customer Order</a></>}{order.clickupOrderUrl && <a href={order.clickupOrderUrl} target="_blank" rel="noreferrer">Open ClickUp</a>}<button onClick={onWhatsapp}>WhatsApp {order.whatsappEnabled ? 'OFF' : 'ON'}</button>{can('cancel_order') && !order.isCancelled && !order.isCompleted && <button className="danger" onClick={() => onAction('cancel')}>Cancel Order</button>}</div>}</div></div></td>}
  </tr>;
}

function shippingUnderway(order: OrderRow) {
  return ['picked_up','shipped','in_transit','out_for_delivery','delivered'].includes(norm(order.shipmentStatusGroup)) || norm(order.fulfillmentStage) === 'in_transit';
}
function requiresProductionApproval(order: OrderRow) {
  return !order.productionApproved && norm(order.adminStatus).includes('ai_pending_confirmation');
}
function productionLabel(order: OrderRow) {
  if (order.productionCompletedAt || shippingUnderway(order) || Number(order.progressPercent || 0) >= 100) return 'Production complete';
  if (requiresProductionApproval(order)) return 'AI review pending';
  if (Number(order.componentsLinked || 0) > 0 || ['linked','queued','processing'].includes(norm(order.clickupSyncStatus))) return 'Production active';
  if (order.productionApproved) return 'Production approved';
  return 'Ready to process';
}
function nextAction(order: OrderRow, can: (p: string) => boolean): { label: string; action?: string; tone: 'primary' | 'outline'; disabled?: boolean } {
  const pickup = norm(order.delivery).includes('pickup');
  if (order.isCancelled || order.isCompleted) return { label: 'View Details', tone: 'outline' };
  if (order.awaitingCustomerConfirmation) return { label: 'Waiting Customer', tone: 'outline' };
  if (order.isProblem) return { label: 'Review Problem', tone: 'outline' };
  if (order.isUnpaid) {
    if (pickup && order.isCash && can('verify_payments')) return { label: 'Confirm Cash Paid', action: 'confirm_cash_paid', tone: 'primary' };
    return { label: 'View Payment', tone: 'outline' };
  }
  if (requiresProductionApproval(order) && can('approve_production')) return { label: 'Approve AI Order', action: 'approve_production', tone: 'primary' };
  if (pickup && order.pickupReadyAt && !order.pickupCollectedAt && can('approve_production')) return { label: 'Customer Collected', action: 'pickup_collected', tone: 'primary' };
  if (pickup && !order.pickupReadyAt) {
    if (Number(order.componentsTotal || 0) > 0) return { label: 'View Production', tone: 'outline' };
    if (order.productionApproved && can('approve_production')) return { label: 'Ready Pickup', action: 'ready_pickup', tone: 'primary' };
  }
  if (!pickup && (shippingUnderway(order) || order.trackingLink)) return { label: 'View Tracking', tone: 'outline' };
  return { label: 'View Details', tone: 'outline' };
}

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [onClose]);
  return <div className="erp-image-lightbox" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section><header><b>Design Preview</b><button type="button" onClick={onClose}>×</button></header><div><img src={url} alt="Design preview" /></div></section></div>;
}

function AdvancedFilters({ filters, onChange, onClear }: { filters: Filters; onChange: (key: keyof Filters, value: string) => void; onClear: () => void }) {
  return <div className="erp-advanced-filters">
    <FilterField label="Created From"><input type="date" value={filters.createdFrom || ''} onChange={(e) => onChange('createdFrom', e.target.value)} /></FilterField>
    <FilterField label="Created To"><input type="date" value={filters.createdTo || ''} onChange={(e) => onChange('createdTo', e.target.value)} /></FilterField>
    <FilterField label="Need From"><input type="date" value={filters.needFrom || ''} onChange={(e) => onChange('needFrom', e.target.value)} /></FilterField>
    <FilterField label="Need To"><input type="date" value={filters.needTo || ''} onChange={(e) => onChange('needTo', e.target.value)} /></FilterField>
    <FilterField label="Payment From"><input type="date" value={filters.paidFrom || ''} onChange={(e) => onChange('paidFrom', e.target.value)} /></FilterField>
    <FilterField label="Payment To"><input type="date" value={filters.paidTo || ''} onChange={(e) => onChange('paidTo', e.target.value)} /></FilterField>
    <FilterField label="Payment"><select value={filters.payment || ''} onChange={(e) => onChange('payment', e.target.value)}><option value="">All</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="cash">Cash Due</option></select></FilterField>
    <FilterField label="Delivery"><select value={filters.delivery || ''} onChange={(e) => onChange('delivery', e.target.value)}><option value="">All</option><option value="pickup">Pickup</option><option value="spx">SPX</option><option value="j&t">J&T</option><option value="jnt">JNT</option><option value="ninja">NinjaVan</option></select></FilterField>
    <FilterField label="Production"><select value={filters.production || ''} onChange={(e) => onChange('production', e.target.value)}><option value="">All</option><option value="approved">Approved</option><option value="waiting">Waiting Approval</option></select></FilterField>
    <FilterField label="ClickUp"><select value={filters.clickup || ''} onChange={(e) => onChange('clickup', e.target.value)}><option value="">All</option><option value="linked">Fully Linked</option><option value="not_linked">Not Fully Linked</option><option value="queued">Queued</option><option value="error">Error</option></select></FilterField>
    <FilterField label="WhatsApp"><select value={filters.whatsapp || ''} onChange={(e) => onChange('whatsapp', e.target.value)}><option value="">All</option><option value="on">ON</option><option value="off">OFF</option><option value="failed">Last Send Failed</option></select></FilterField>
    <FilterField label="Amount Min"><input type="number" min="0" step="0.01" value={filters.amountMin || ''} onChange={(e) => onChange('amountMin', e.target.value)} /></FilterField>
    <FilterField label="Amount Max"><input type="number" min="0" step="0.01" value={filters.amountMax || ''} onChange={(e) => onChange('amountMax', e.target.value)} /></FilterField>
    <div className="erp-filter-actions"><button className="btn btn-outline btn-sm" onClick={onClear}>Clear All Filters</button></div>
  </div>;
}

function OrderDrawer({ detail, loading, permissions, busyId, onClose, onReload, onAction, onWhatsapp, onCopy }: {
  detail: OrderDetail | null; loading: boolean; permissions: string[]; busyId: string | null; onClose: () => void; onReload: () => Promise<void>;
  onAction: (order: OrderRow, name: string) => void; onWhatsapp: (order: OrderRow) => void; onCopy: (value: string, message: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<'overview' | 'items' | 'payment' | 'production' | 'whatsapp' | 'timeline'>('overview');
  const order = detail?.order;
  const [dateNeed, setDateNeed] = useState(''); const [remark, setRemark] = useState(''); const [items, setItems] = useState<OrderItem[]>([]); const [saving, setSaving] = useState(false); const [localError, setLocalError] = useState<string | null>(null); const [localNotice, setLocalNotice] = useState<string | null>(null); const [undoPaymentId, setUndoPaymentId] = useState<string | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'spx' | 'jnt' | 'ninja'>('spx');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
  const [customerProfileLoading, setCustomerProfileLoading] = useState(false);
  const [customerProfileEditing, setCustomerProfileEditing] = useState(false);
  const [customerProfileName, setCustomerProfileName] = useState('');
  const [customerProfileSaving, setCustomerProfileSaving] = useState(false);
  const [recipientEditing, setRecipientEditing] = useState(false);
  const [recipientSaving, setRecipientSaving] = useState(false);
  const [recipientFetching, setRecipientFetching] = useState(false);
  const [recipientFetchStatus, setRecipientFetchStatus] = useState<{ message: string; error: boolean } | null>(null);
  const [recipient, setRecipient] = useState<RecipientForm>({ name: '', phone: '', address: '', postcode: '', city: '', state: '' });
  useEffect(() => {
    if (!order) return;
    const rawDelivery = norm(order.delivery || order.courier);
    const method: 'pickup' | 'spx' | 'jnt' | 'ninja' = rawDelivery.includes('pickup') ? 'pickup' : rawDelivery.includes('ninja') ? 'ninja' : (rawDelivery.includes('jnt') || rawDelivery.includes('j&t')) ? 'jnt' : 'spx';
    setDateNeed(String(order.dateNeed || '').slice(0, 10));
    setRemark(order.adminRemark || '');
    setDeliveryMethod(method);
    setDeliveryFee(method === 'pickup' ? 0 : Math.max(0, Number(order.deliveryFee || 0)));
    setItems((detail?.items || []).map((i) => ({ ...i, qty: Number(i.qty || 1), price: Number(i.price || 0), customText: i.customText || '', previewUrl: i.previewUrl || '' })));
    setRecipient({
      name: String(order.deliveryName || order.customerName || ''),
      phone: String(order.deliveryPhone || order.customerPhone || ''),
      address: String(order.deliveryAddress || ''),
      postcode: String(order.deliveryPostcode || ''),
      city: String(order.deliveryCity || ''),
      state: String(order.deliveryState || ''),
    });
    setRecipientEditing(false);
    setRecipientFetching(false);
    setRecipientFetchStatus(null);
  }, [detail, order]);
  const canEdit = permissions.includes('edit_order'); const canVerify = permissions.includes('verify_payments'); const canApprove = permissions.includes('approve_production');
  const loadCustomerProfile = useCallback(async () => {
    if (!order?.dbId) { setCustomerProfile(null); return; }
    setCustomerProfileLoading(true);
    const { data, error } = await supabase.rpc('icetak_admin_customer_profile', { p_order_db_id: order.dbId });
    setCustomerProfileLoading(false);
    if (error) { setLocalError(error.message); return; }
    const profile = (data || null) as CustomerProfile | null;
    setCustomerProfile(profile);
    setCustomerProfileName(String(profile?.name || order.customerName || ''));
  }, [order?.dbId, order?.customerName]);
  useEffect(() => { void loadCustomerProfile(); setCustomerProfileEditing(false); }, [loadCustomerProfile]);
  const saveCustomerProfile = async () => {
    if (!order || !customerProfileName.trim()) return;
    setCustomerProfileSaving(true); setLocalError(null);
    const { data, error } = await supabase.rpc('icetak_admin_customer_profile_update', { p_order_db_id: order.dbId, p_display_name: customerProfileName.trim(), p_clear_override: false });
    setCustomerProfileSaving(false);
    if (error) { setLocalError(error.message); return; }
    setCustomerProfile((data || null) as CustomerProfile | null); setCustomerProfileEditing(false); await onReload();
  };
  const clearCustomerProfileLock = async () => {
    if (!order || !window.confirm('Buang Admin Preferred Name? Order akan datang boleh guna nama WhatsApp semula.')) return;
    setCustomerProfileSaving(true); setLocalError(null);
    const { data, error } = await supabase.rpc('icetak_admin_customer_profile_update', { p_order_db_id: order.dbId, p_display_name: '', p_clear_override: true });
    setCustomerProfileSaving(false);
    if (error) { setLocalError(error.message); return; }
    setCustomerProfile((data || null) as CustomerProfile | null); setCustomerProfileEditing(false); await onReload();
  };
  const recipientLocked = Boolean(order?.recipientLocked);
  const recipientComplete = Boolean(
    recipient.name.trim() && recipient.phone.trim() && (
      deliveryMethod === 'pickup' || (
        recipient.address.trim() && recipient.postcode.trim() && recipient.city.trim() && recipient.state.trim()
      )
    )
  );
  const resetRecipient = () => {
    if (!order) return;
    setRecipient({
      name: String(order.deliveryName || order.customerName || ''),
      phone: String(order.deliveryPhone || order.customerPhone || ''),
      address: String(order.deliveryAddress || ''),
      postcode: String(order.deliveryPostcode || ''),
      city: String(order.deliveryCity || ''),
      state: String(order.deliveryState || ''),
    });
    setRecipientFetchStatus(null);
  };
  const fetchRecipientAddress = async () => {
    if (!order || recipientLocked || recipientSaving || recipientFetching) return;
    if (!recipient.phone.trim()) {
      setRecipientFetchStatus({ message: 'Isi nombor telefon penerima dahulu.', error: true });
      return;
    }
    setRecipientFetching(true); setRecipientFetchStatus({ message: 'Sedang mencari alamat dalam ClickUp…', error: false }); setLocalError(null);
    const { data, error } = await supabase.functions.invoke('draft-address-fetch', {
      body: { mode: 'order', order_db_id: order.dbId, phone: recipient.phone.trim() },
    });
    setRecipientFetching(false);
    const result = (data || {}) as AddressFetchResult;
    if (error || result.ok === false) {
      setRecipientFetchStatus({ message: result.error || error?.message || 'Gagal ambil alamat ClickUp.', error: true });
      return;
    }
    if (result.found !== true) {
      setRecipientFetchStatus({ message: 'Alamat tidak dijumpai dalam ClickUp.', error: true });
      return;
    }
    const customer = result.customer || {};
    const address = result.address || {};
    setRecipient((old) => ({
      name: String(customer.name || old.name),
      phone: String(customer.phone || old.phone),
      address: String(address.address_line1 || ''),
      postcode: String(address.postcode || ''),
      city: String(address.city || ''),
      state: String(address.state || ''),
    }));
    setRecipientFetchStatus({ message: 'Alamat ClickUp dimasukkan. Tekan Save Customer & Address untuk simpan ke order ini.', error: false });
  };
  const saveRecipient = async () => {
    if (!order || !recipientComplete || recipientLocked || recipientFetching) return;
    setRecipientSaving(true); setLocalError(null); setLocalNotice(null);
    const { error } = await supabase.rpc('icetak_admin_order_recipient_update', {
      p_payload: {
        order_db_id: order.dbId,
        delivery_name: recipient.name.trim(),
        delivery_phone: recipient.phone.trim(),
        delivery_address: recipient.address.trim(),
        delivery_postcode: recipient.postcode.trim(),
        delivery_city: recipient.city.trim(),
        delivery_state: recipient.state.trim(),
      },
    });
    setRecipientSaving(false);
    if (error) { setLocalError(error.message); return; }
    setRecipientEditing(false);
    setLocalNotice('Nama dan alamat order disimpan. AWB akan menggunakan maklumat ini.');
    await onReload();
  };
  const deliveryLocked = Boolean(order?.tracking || ['picked_up','shipped','in_transit','out_for_delivery','delivered'].includes(norm(order?.shipmentStatusGroup)) || ['picked_up','shipped','in_transit','out_for_delivery','delivered'].includes(norm(order?.fulfillmentStage)));
  const itemSubtotal = items.reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)) * Math.max(0, Number(item.price || 0)), 0);
  const effectiveDeliveryFee = deliveryMethod === 'pickup' ? 0 : Math.max(0, Number(deliveryFee || 0));
  const previewTotal = itemSubtotal + effectiveDeliveryFee;
  const save = async () => {
    if (!order) return; setSaving(true); setLocalError(null);
    const payload: Record<string, unknown> = { order_db_id: order.dbId, date_need: dateNeed, admin_remark: remark, delivery_fee: effectiveDeliveryFee, items: items.map((i) => ({ id: i.id, qty: i.qty, price: i.price, custom_text: i.customText, design_preview_url: i.previewUrl })) };
    if (!deliveryLocked) payload.delivery_method = deliveryMethod;
    const { error } = await supabase.rpc('icetak_admin_order_update', { p_payload: payload });
    setSaving(false); if (error) { setLocalError(error.message); return; } await onReload();
  };
  const undoManualPayment = async (payment: PaymentRow) => {
    if (!order || !canUndoSyntheticManualPayment(payment)) return;
    const confirmed = window.confirm(
      `Undo manual payment ${money(payment.amount)} untuk ${order.id}?\n\n` +
      'Order akan dikira semula berdasarkan payment yang masih sah. QRPay sebenar, production dan ClickUp tidak dipadam.'
    );
    if (!confirmed) return;
    setUndoPaymentId(payment.id); setLocalError(null); setLocalNotice(null);
    const { error } = await supabase.rpc('icetak_admin_undo_manual_payment', {
      p_payment_id: payment.id,
      p_reason: 'Manual payment linked by mistake',
    });
    setUndoPaymentId(null);
    if (error) { setLocalError(error.message); return; }
    setLocalNotice(`${money(payment.amount)} manual payment berjaya di-undo. QRPay sebenar masih selamat untuk dimatch.`);
    await onReload();
  };
  const link = order ? customerOrderLink(order) : '';
  return <div className="erp-drawer-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><aside className="erp-order-drawer">
    {loading || !order ? <div className="loading"><span className="spinner" /> Loading order detail...</div> : <>
      <header className="erp-drawer-header"><div><div className="page-label">Order Detail</div><div className="erp-drawer-title"><h2>{order.id}</h2><button className="erp-mini-icon" title="Copy Order ID" onClick={() => void onCopy(order.id, 'Order ID copied')}>⧉</button>{link && <button className="erp-mini-icon" title="Copy customer link" onClick={() => void onCopy(link, 'Customer order link copied')}>↗</button>}</div><div className="erp-statusline"><span className="erp-status-pill neutral">{order.adminStatus || order.status}</span>{order.isProblem && <span className="erp-status-pill danger">PROBLEM</span>}</div></div><button className="erp-drawer-close" onClick={onClose}>×</button></header>
      <nav className="erp-drawer-tabs">{([['overview','Overview'],['items','Items'],['payment','Payment'],['production','Production'],['whatsapp','WhatsApp'],['timeline','Timeline']] as const).map(([k,l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <div className="erp-drawer-body">
        {localError && <div className="erp-notice error">{localError}</div>}
        {localNotice && <div className="erp-notice success">{localNotice}</div>}
        {tab === 'overview' && <div className="erp-drawer-grid"><DrawerCard title="Customer"><KV k="Name" v={order.deliveryName || order.customerName || '—'} /><KV k="Phone" v={(order.deliveryPhone || order.customerPhone) ? <a className="erp-inline-link" href={`tel:${digits(order.deliveryPhone || order.customerPhone)}`}>{order.deliveryPhone || order.customerPhone}</a> : '—'} />{customerProfile?.locked && <div style={{ margin: '8px 0' }}><span className="erp-status-pill success">ADMIN NAME LOCKED</span></div>}{customerProfileLoading ? <p className="cell-sub">Loading customer profile…</p> : customerProfileEditing ? <div style={{ marginTop: 10 }}><FilterField label="Preferred Customer Name"><input autoFocus maxLength={200} disabled={customerProfileSaving} value={customerProfileName} onChange={(e) => setCustomerProfileName(e.target.value)} /></FilterField><p className="cell-sub">Nama ini jadi nama utama customer. WhatsApp display name tak boleh overwrite selepas disimpan.</p><div className="erp-card-actions"><button className="btn btn-primary btn-sm" disabled={customerProfileSaving || !customerProfileName.trim()} onClick={() => void saveCustomerProfile()}>{customerProfileSaving ? 'Saving…' : 'Save Preferred Name'}</button><button className="btn btn-outline btn-sm" disabled={customerProfileSaving} onClick={() => { setCustomerProfileEditing(false); setCustomerProfileName(String(customerProfile?.name || order.customerName || '')); }}>Cancel</button></div></div> : <div className="erp-card-actions" style={{ marginTop: 8 }}>{canEdit && <button className="btn btn-outline btn-sm" onClick={() => { setCustomerProfileName(String(customerProfile?.name || order.customerName || '')); setCustomerProfileEditing(true); }}>Edit Profile</button>}{canEdit && customerProfile?.locked && <button className="btn btn-ghost btn-sm" disabled={customerProfileSaving} onClick={() => void clearCustomerProfileLock()}>Use WhatsApp Name Again</button>}</div>}{customerProfile?.locked && <p className="cell-sub">Preferred name disimpan oleh {customerProfile.admin_name_updated_by || 'admin'}{customerProfile.admin_name_updated_at ? ` · ${formatDateTime(customerProfile.admin_name_updated_at)}` : ''}. Future AI orders akan guna nama ini.</p>}<KV k="Created" v={formatDateTime(order.createdAt)} /><KV k="Updated" v={formatDateTime(order.updatedAt)} /></DrawerCard><DrawerCard title="Fulfillment"><KV k="Delivery" v={order.delivery || '—'} /><KV k="Courier" v={order.courier || '—'} /><KV k="Tracking" v={order.tracking ? <a className="erp-inline-link" href={order.trackingLink || '#'} target="_blank" rel="noreferrer">{order.tracking}</a> : '—'} /><KV k="Stage" v={order.fulfillmentStage || '—'} /></DrawerCard><DrawerCard title="Customer & Address for this order">{recipientEditing ? <><div className="erp-card-actions" style={{ marginBottom: 10 }}><button type="button" className="btn btn-outline btn-sm" disabled={recipientSaving || recipientFetching} onClick={() => void fetchRecipientAddress()}>{recipientFetching ? 'Mencari alamat…' : 'Ambil Alamat ClickUp'}</button></div>{recipientFetchStatus && <p className={`cell-sub ${recipientFetchStatus.error ? 'erp-text-danger' : ''}`}>{recipientFetchStatus.message}</p>}<div className="erp-item-fields"><FilterField label="Recipient Name"><input autoFocus maxLength={200} disabled={recipientSaving || recipientFetching} value={recipient.name} onChange={(e) => setRecipient((old) => ({ ...old, name: e.target.value }))} /></FilterField><FilterField label="Recipient Phone"><input inputMode="tel" maxLength={20} disabled={recipientSaving || recipientFetching} value={recipient.phone} onChange={(e) => setRecipient((old) => ({ ...old, phone: e.target.value }))} /></FilterField><div style={{ gridColumn: '1 / -1' }}><FilterField label="Address"><textarea rows={3} maxLength={500} disabled={recipientSaving || recipientFetching} value={recipient.address} onChange={(e) => setRecipient((old) => ({ ...old, address: e.target.value }))} /></FilterField></div><FilterField label="Postcode"><input inputMode="numeric" maxLength={5} disabled={recipientSaving || recipientFetching} value={recipient.postcode} onChange={(e) => setRecipient((old) => ({ ...old, postcode: e.target.value.replace(/\D/g, '').slice(0, 5) }))} /></FilterField><FilterField label="City"><input maxLength={100} disabled={recipientSaving || recipientFetching} value={recipient.city} onChange={(e) => setRecipient((old) => ({ ...old, city: e.target.value }))} /></FilterField><div style={{ gridColumn: '1 / -1' }}><FilterField label="State"><input maxLength={100} disabled={recipientSaving || recipientFetching} value={recipient.state} onChange={(e) => setRecipient((old) => ({ ...old, state: e.target.value }))} /></FilterField></div></div><p className="cell-sub">Maklumat ini ialah snapshot order dan akan digunakan semasa create shipment/AWB. Customer profile tidak diubah.</p><div className="erp-card-actions"><button className="btn btn-primary btn-sm" disabled={recipientSaving || recipientFetching || !recipientComplete} onClick={() => void saveRecipient()}>{recipientSaving ? 'Saving…' : 'Save Customer & Address'}</button><button className="btn btn-outline btn-sm" disabled={recipientSaving || recipientFetching} onClick={() => { resetRecipient(); setRecipientEditing(false); }}>Cancel</button></div></> : <><KV k="Name" v={order.deliveryName || order.customerName || '—'} /><KV k="Phone" v={order.deliveryPhone || order.customerPhone || '—'} /><p>{[order.deliveryAddress, order.deliveryPostcode, order.deliveryCity, order.deliveryState].filter(Boolean).join(', ') || 'Pickup / no delivery address'}</p><div className="erp-card-actions">{canEdit && !recipientLocked && <button className="btn btn-outline btn-sm" onClick={() => { resetRecipient(); setRecipientEditing(true); }}>Edit Customer & Address</button>}</div>{recipientLocked ? <p className="cell-sub erp-text-danger">Nama dan alamat dikunci sebab shipment atau tracking sudah dibuat.</p> : <p className="cell-sub">AWB akan mengambil nama dan alamat daripada snapshot order ini.</p>}</>}</DrawerCard><DrawerCard title="Admin Edit"><FilterField label="Date Need"><input type="date" disabled={!canEdit} value={dateNeed} onChange={(e) => setDateNeed(e.target.value)} /></FilterField><FilterField label="Delivery / Courier"><select disabled={!canEdit || deliveryLocked} value={deliveryMethod} onChange={(e) => { const value = e.target.value as 'pickup' | 'spx' | 'jnt' | 'ninja'; setDeliveryMethod(value); if (value === 'pickup') setDeliveryFee(0); }}><option value="pickup">Pickup</option><option value="spx">SPX</option><option value="jnt">J&amp;T</option><option value="ninja">NinjaVan</option></select></FilterField><FilterField label="Shipping Fee (RM)"><input type="number" min="0" step="0.01" disabled={!canEdit || deliveryMethod === 'pickup'} value={effectiveDeliveryFee} onChange={(e) => setDeliveryFee(Math.max(0, Number(e.target.value || 0)))} /></FilterField><div className="erp-kv"><span>Order Total</span><b>{money(previewTotal)}</b></div><p className="cell-sub">Item {money(itemSubtotal)} + Shipping {money(effectiveDeliveryFee)}. Payment transaction asal tidak diubah.</p>{deliveryLocked && <p className="cell-sub erp-text-danger">Courier dikunci sebab tracking sudah dibuat. Shipping Fee masih boleh dibetulkan.</p>}<FilterField label="Admin Remark"><textarea rows={4} disabled={!canEdit} value={remark} onChange={(e) => setRemark(e.target.value)} /></FilterField>{canEdit && <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Changes'}</button>}</DrawerCard></div>}
        {tab === 'items' && <OrderItemStructuralEditor
          orderDbId={order.dbId}
          items={detail.items}
          canEdit={canEdit}
          structuralLocked={Boolean(order.isCancelled || order.isCompleted || order.pickupReadyAt || order.pickupCollectedAt || order.deliveredAt || ['picked_up','shipped','in_transit','out_for_delivery','delivered'].includes(norm(order.shipmentStatusGroup)))}
          structuralLockReason="Courier sudah scan / order sudah Ready Pickup, Collected, Delivered atau Cancelled."
          onSaved={onReload}
        />}
        {tab === 'payment' && <div className="erp-drawer-grid">
          <DrawerCard title="Payment Summary">
            <KV k="Status" v={order.payment || '—'} /><KV k="Method" v={order.paymentMethod || '—'} /><KV k="Shipping Fee" v={money(order.deliveryFee)} /><KV k="Total" v={money(order.total)} /><KV k="Paid At" v={formatDateTime(order.paidAt)} /><KV k="Verified By" v={order.paymentVerifiedBy || '—'} />
            <div className="erp-card-actions">{norm(order.delivery).includes('pickup') && order.isUnpaid && canEdit && !order.isCash && <button className="btn btn-outline btn-sm" onClick={() => onAction(order, 'set_pay_at_pickup')}>Set Pay at Pickup</button>}{norm(order.delivery).includes('pickup') && order.isUnpaid && order.isCash && canVerify && <button className="btn btn-primary btn-sm" onClick={() => onAction(order, 'confirm_cash_paid')}>Confirm Cash Paid</button>}</div>
          </DrawerCard>
          <DrawerCard title="Transactions">
            {detail.payments.length ? detail.payments.map((p) => <div className="erp-history-row" key={p.id}>
              <div><b>{money(p.amount)}</b><span>{p.provider || 'payment'} · {p.senderName || '—'}</span>{p.transactionId && <span>{p.transactionId}</span>}{canVerify && canUndoSyntheticManualPayment(p) && <button className="btn btn-danger btn-sm" disabled={undoPaymentId !== null} onClick={() => void undoManualPayment(p)}>{undoPaymentId === p.id ? 'Undoing…' : 'Undo Manual Payment'}</button>}</div>
              <div>{formatDateTime(p.paidAt)}</div>
            </div>) : <p className="cell-sub">No payment transaction recorded.</p>}
            {detail.payments.some(canUndoSyntheticManualPayment) && <p className="cell-sub">Undo hanya membatalkan rekod manual sintetik. QRPay sebenar, production dan ClickUp dikekalkan.</p>}
          </DrawerCard>
        </div>}
        {tab === 'production' && <div className="erp-drawer-grid"><DrawerCard title="Production"><KV k="State" v={productionLabel(order)} /><KV k="Stage" v={order.fulfillmentStage || '—'} /><KV k="Completed" v={formatDateTime(order.productionCompletedAt)} /><KV k="Ready Pickup" v={formatDateTime(order.pickupReadyAt)} /><KV k="Collected" v={formatDateTime(order.pickupCollectedAt)} /><div className="erp-card-actions">{!order.isUnpaid && requiresProductionApproval(order) && canApprove && <button className="btn btn-primary btn-sm" onClick={() => onAction(order, 'approve_production')}>Approve AI Order</button>}{norm(order.delivery).includes('pickup') && order.productionApproved && !order.pickupReadyAt && Number(order.componentsTotal || 0) === 0 && canApprove && <button className="btn btn-primary btn-sm" onClick={() => onAction(order, 'ready_pickup')}>Ready Pickup</button>}{norm(order.delivery).includes('pickup') && order.pickupReadyAt && !order.pickupCollectedAt && canApprove && <button className="btn btn-primary btn-sm" onClick={() => onAction(order, 'pickup_collected')}>Customer Collected</button>}</div></DrawerCard><DrawerCard title="ClickUp Components">{items.flatMap((i) => i.components || []).length ? items.flatMap((i) => i.components || []).map((c) => <div className="erp-history-row" key={c.id}><div><b>{c.label || 'Component'}</b><span>{c.customerLabel || c.workflow || '—'} · {c.progressPercent || 0}%</span></div><div>{c.clickupTaskId ? <a className="erp-inline-link" href={`https://app.clickup.com/t/3747262/${c.clickupTaskId}`} target="_blank" rel="noreferrer">Open Task</a> : 'Not linked'}</div></div>) : <p className="cell-sub">No production components.</p>}</DrawerCard></div>}
        {tab === 'whatsapp' && <div className="erp-drawer-grid"><DrawerCard title="WhatsApp Control"><KV k="Order Notifications" v={order.whatsappEnabled ? 'ON' : 'OFF'} /><button className={`btn btn-sm ${order.whatsappEnabled ? 'btn-outline':'btn-primary'}`} disabled={busyId === order.dbId} onClick={() => onWhatsapp(order)}>Turn {order.whatsappEnabled ? 'OFF' : 'ON'}</button><p className="cell-sub" style={{ marginTop: 8 }}>Turning OFF cancels pending order notifications for this order.</p></DrawerCard><DrawerCard title="Notification History">{detail.notifications.length ? detail.notifications.map((n) => <div className="erp-history-row" key={n.id}><div><b>{n.eventType || 'notification'}</b><span className={norm(n.status) === 'failed' ? 'erp-text-danger' : ''}>{n.status || '—'} · {n.mode || '—'}{n.error ? ` · ${n.error}` : ''}</span></div><div>{formatDateTime(n.at)}</div></div>) : <p className="cell-sub">No notification history.</p>}</DrawerCard></div>}
        {tab === 'timeline' && <div className="erp-timeline">{detail.timeline.length ? detail.timeline.map((t, i) => <div className="erp-timeline-item" key={`${t.type}-${t.at}-${i}`}><i /><div><div className="erp-timeline-head"><b>{t.label || t.type}</b><span>{formatDateTime(t.at)}</span></div><div className="cell-sub">Actor: {t.actor || 'system'}</div>{t.detail && Object.keys(t.detail).length > 0 && <details><summary>Audit detail</summary><pre>{JSON.stringify(t.detail, null, 2)}</pre></details>}</div></div>) : <p className="cell-sub">No audit events recorded.</p>}</div>}
      </div>
      <footer className="erp-drawer-footer"><div>{link && <a className="btn btn-outline btn-sm" href={link} target="_blank" rel="noreferrer">Open Customer Order</a>}{order.clickupOrderUrl && <a className="btn btn-outline btn-sm" href={order.clickupOrderUrl} target="_blank" rel="noreferrer">Open ClickUp</a>}</div><div>{permissions.includes('cancel_order') && !order.isCancelled && !order.isCompleted && <button className="btn btn-danger btn-sm" onClick={() => onAction(order, 'cancel')}>Cancel Order</button>}<button className="btn btn-outline btn-sm" onClick={onClose}>Close</button></div></footer>
    </>}
  </aside></div>;
}

function SummaryMetric({ label, value, tone }: { label: string; value?: number; tone: 'dark' | 'neutral' | 'warning' | 'danger' }) { return <div className={`erp-summarymetric ${tone}`}><span>{label}</span><b>{Number(value || 0)}</b></div>; }
function SortableTh({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) { return <th><button className={`erp-sort-th ${active ? 'active' : ''}`} onClick={onClick}>{label} {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</button></th>; }
function FilterField({ label, children }: { label: string; children: React.ReactNode }) { return <label className="erp-filter-field"><span>{label}</span>{children}</label>; }
function DrawerCard({ title, children }: { title: string; children: React.ReactNode }) { return <section className="erp-drawer-card"><h3>{title}</h3>{children}</section>; }
function KV({ k, v }: { k: string; v: React.ReactNode }) { return <div className="erp-kv"><span>{k}</span><b>{v}</b></div>; }
