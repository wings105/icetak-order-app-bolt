import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconPlus, IconSearch } from '../components/Icons';

type DashboardView = 'active' | 'today' | 'to_pay' | 'cash' | 'production' | 'problem' | 'completed' | 'all';
type EnterpriseOrder = {
  dbId?: string;
  id?: string;
  orderToken?: string;
  customerName?: string;
  customerPhone?: string;
  adminStatus?: string;
  status?: string;
  payment?: string;
  paymentMethod?: string;
  total?: number | string;
  dateNeed?: string | null;
  createdAt?: string | null;
  delivery?: string;
  courier?: string;
  productionApproved?: boolean;
  isCancelled?: boolean;
  isCompleted?: boolean;
  isUnpaid?: boolean;
  isCash?: boolean;
  itemSummary?: string;
  itemsCount?: number;
};
type Summary = {
  all?: number;
  active?: number;
  today?: number;
  toPay?: number;
  cash?: number;
  production?: number;
  problem?: number;
  completed?: number;
};
type EnterpriseResponse = { rows?: EnterpriseOrder[]; summary?: Summary };

type Props = {
  adminOrders?: unknown[]; // legacy prop retained for App compatibility; Dashboard no longer reads AppDeploy orders.
  onQuickOrder?: () => void;
  onOpenOrder?: (orderNo: string) => void;
};

const money = (v: unknown) => `RM ${Number(v || 0).toFixed(2)}`;
const norm = (v: unknown) => String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const raw = String(value);
  const parsed = new Date(raw.length <= 10 ? `${raw.slice(0, 10)}T00:00:00` : raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
};

function statusDisplay(order: EnterpriseOrder) {
  const status = norm(order.adminStatus || order.status);
  if (order.isCancelled || status.includes('cancel')) return { label: 'Cancelled', cls: 'tag-cancelled' };
  if (order.isCompleted || ['completed', 'delivered', 'customer_collected'].includes(status)) return { label: 'Completed', cls: 'tag-paid' };
  if (norm(order.payment) === 'paid') {
    if (order.productionApproved || status.includes('production')) return { label: 'Production', cls: 'tag-ready' };
    return { label: 'Paid', cls: 'tag-paid' };
  }
  if (order.isCash) return { label: 'Cash Approval', cls: 'tag-pay' };
  if (order.isUnpaid) return { label: 'To Pay', cls: 'tag-pay' };
  return { label: order.adminStatus || order.status || 'Active', cls: 'tag-neutral' };
}

export default function Dashboard({ onQuickOrder, onOpenOrder }: Props) {
  const [rows, setRows] = useState<EnterpriseOrder[]>([]);
  const [summary, setSummary] = useState<Summary>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<DashboardView>('active');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_orders_enterprise', {
      p_query: submittedQuery,
      p_filters: { view },
      p_sort: 'urgency',
      p_direction: 'asc',
      p_page: 1,
      p_page_size: 50,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      setRows([]);
      return;
    }
    const result = (data || {}) as EnterpriseResponse;
    setRows(result.rows || []);
    setSummary(result.summary || {});
  }, [submittedQuery, view]);

  useEffect(() => { void load(); }, [load]);

  const search = () => setSubmittedQuery(query.trim());
  const tabs: Array<{ key: DashboardView; label: string; count: keyof Summary }> = [
    { key: 'active', label: 'Active', count: 'active' },
    { key: 'today', label: 'Today', count: 'today' },
    { key: 'to_pay', label: 'To Pay', count: 'toPay' },
    { key: 'cash', label: 'Cash Approval', count: 'cash' },
    { key: 'production', label: 'Production', count: 'production' },
    { key: 'problem', label: 'Problem', count: 'problem' },
    { key: 'completed', label: 'Completed', count: 'completed' },
    { key: 'all', label: 'All', count: 'all' },
  ];

  return <div className="fade-in">
    <div className="page-header">
      <div><div className="page-label">Dashboard</div><h1 className="page-title">Business Overview</h1><p className="page-subtitle">Live dari Supabase Order System · sumber yang sama dengan Orders Work Queue.</p></div>
      <button className="btn btn-primary btn-lg" onClick={onQuickOrder}><IconPlus size={16} /> Create Order</button>
    </div>

    <div className="stat-row">
      <Metric label="Active" value={summary.active} hint="Current work queue" />
      <Metric label="To Pay" value={summary.toPay} hint="Payment pending" />
      <Metric label="Cash Check" value={summary.cash} hint="Manual cash approval" />
      <Metric label="Production" value={summary.production} hint="Production active" />
    </div>

    <div className="search-row">
      <input className="search-input" placeholder="Search name, WhatsApp or Order ID" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} />
      <button className="search-btn" onClick={search}><IconSearch size={16} /> Search</button>
    </div>

    <div className="filter-tabs">{tabs.map((tab) => <button key={tab.key} className={`filter-tab ${view === tab.key ? 'active' : ''}`} onClick={() => setView(tab.key)}>{tab.label} <span className="count">{Number(summary[tab.count] || 0)}</span></button>)}</div>

    {error ? <div className="empty"><div className="empty-title">Dashboard gagal load</div><div>{error}</div></div>
      : loading ? <div className="loading"><span className="spinner" /> Loading orders...</div>
      : rows.length === 0 ? <div className="empty"><div className="empty-title">No orders found</div></div>
      : <div className="order-grid">{rows.map((order) => <OrderCard key={order.dbId || order.id} order={order} onOpen={() => order.id && onOpenOrder?.(order.id)} />)}</div>}
  </div>;
}

function Metric({ label, value, hint }: { label: string; value?: number; hint: string }) {
  return <div className="stat-card blue"><div className="stat-label">{label}</div><div className="stat-value">{Number(value || 0)}</div><div className="stat-hint">{hint}</div></div>;
}

function OrderCard({ order, onOpen }: { order: EnterpriseOrder; onOpen: () => void }) {
  const st = statusDisplay(order);
  const paid = norm(order.payment) === 'paid';
  const phone = String(order.customerPhone || '');
  const normalizedPhone = phone.replace(/\D/g, '');
  const delivery = String(order.courier || order.delivery || 'Pickup');
  return <div className="order-card">
    <div className="order-card-header"><button className="order-no" onClick={onOpen}>{order.id || 'Order'}</button><span className={`tag ${st.cls}`}>{st.label}</span></div>
    <div className="order-dates"><span>Created: {formatDate(order.createdAt)}</span>{order.dateNeed && <span>Need: {formatDate(order.dateNeed)}</span>}</div>
    <div className="order-customer"><span className="order-customer-name">{order.customerName || 'Customer'}</span>{normalizedPhone ? <a className="order-customer-phone" href={`tel:${normalizedPhone}`}>{phone}</a> : <span className="order-customer-phone">—</span>}</div>
    <div className="order-info-row"><span className="order-items-count">{Number(order.itemsCount || 0)} item{Number(order.itemsCount || 0) === 1 ? '' : 's'}</span><span className={`tag ${paid ? 'tag-paid' : 'tag-pay'}`}>{paid ? 'Paid' : order.isCash ? 'Cash' : 'Unpaid'}</span><span className={`tag ${norm(delivery).includes('pickup') ? 'tag-pickup' : 'tag-delivery'}`}>{delivery}</span><span className={`order-total ${paid ? 'paid' : ''}`}>{money(order.total)}</span></div>
    {order.itemSummary && <div className="order-item-list"><div className="order-item-row"><span className="item-name">{order.itemSummary}</span></div></div>}
    <div className="order-card-actions"><button className="btn btn-primary btn-sm" onClick={onOpen}>Open in Orders</button></div>
  </div>;
}
