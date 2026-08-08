import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { IconPlus, IconSearch } from '../components/Icons';

type OrderItem = { title: string; qty: number; price: number; product_type: string };
type Order = {
  id: string;
  order_no: string | null;
  status: string | null;
  payment_status: string | null;
  total: number | string | null;
  date_need: string | null;
  delivery_method: string | null;
  created_at: string;
  customers: { name: string | null; phone: string | null } | null;
  order_items: OrderItem[];
};
type FilterKey = 'all' | 'new' | 'to_pay' | 'cash' | 'ready' | 'problem';

function bucket(o: Order): FilterKey {
  const s = (o.status || '').toLowerCase();
  const ps = (o.payment_status || '').toLowerCase();
  if (s === 'cancelled' || s === 'canceled') return 'problem';
  if (s === 'ready' || s === 'in_production' || s === 'shipped' || s === 'delivered' || s.includes('pickup')) return 'ready';
  if (s === 'payment_received' || ps === 'paid') return 'cash';
  if (['waiting_payment', 'waiting payment'].includes(s) || ['unpaid', 'pending'].includes(ps)) return 'to_pay';
  if (s === 'confirmed' || s === 'new' || s === 'new order') return 'new';
  return 'to_pay';
}

function statusDisplay(o: Order): { label: string; cls: string } {
  const s = (o.status || '').toLowerCase();
  const ps = (o.payment_status || '').toLowerCase();
  if (s === 'cancelled' || s === 'canceled') return { label: 'Cancelled', cls: 'tag-cancelled' };
  if (s === 'delivered' || s === 'completed') return { label: 'Completed', cls: 'tag-paid' };
  if (s === 'shipped') return { label: 'Shipped', cls: 'tag-shipped' };
  if (s.includes('ready') || s.includes('production')) return { label: o.status || 'Ready', cls: 'tag-ready' };
  if (s === 'payment_received' || ps === 'paid') return { label: 'Paid', cls: 'tag-paid' };
  if (['waiting_payment', 'waiting payment'].includes(s)) return { label: 'To Pay', cls: 'tag-pay' };
  if (s === 'confirmed' || s === 'new') return { label: 'New Order', cls: 'tag-new' };
  return { label: o.status || 'Draft', cls: 'tag-neutral' };
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

type AdminDashboardOrder = {
  dbId?: string;
  id?: string;
  status?: string;
  adminStatus?: string;
  payment?: string;
  total?: number | string;
  dateNeedRaw?: string;
  dateNeed?: string;
  delivery?: string;
  created?: string;
  customerName?: string;
  customerPhone?: string;
  items?: Array<{ title?: string; qty?: number; price?: number | string; k?: string }>;
};

function fromAdminDashboard(order: AdminDashboardOrder): Order {
  return {
    id: order.dbId || order.id || crypto.randomUUID(),
    order_no: order.id || null,
    status: order.status || order.adminStatus || null,
    payment_status: order.payment || null,
    total: order.total ?? 0,
    date_need: order.dateNeedRaw || order.dateNeed || null,
    delivery_method: order.delivery || null,
    created_at: order.created || new Date().toISOString(),
    customers: { name: order.customerName || null, phone: order.customerPhone || null },
    order_items: (order.items || []).map((item) => ({
      title: item.title || item.k || 'Item', qty: Number(item.qty || 1), price: Number(item.price || 0), product_type: item.k || '',
    })),
  };
}

type Props = {
  adminOrders?: AdminDashboardOrder[];
  onQuickOrder?: () => void;
  onOpenOrder?: (orderNo: string) => void;
};

export default function Dashboard({ adminOrders, onQuickOrder, onOpenOrder }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    if (adminOrders) {
      setOrders(adminOrders.map(fromAdminDashboard));
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('orders')
      .select('id, order_no, status, payment_status, total, date_need, delivery_method, created_at, customers(name, phone), order_items(title, qty, price, product_type)')
      .order('created_at', { ascending: false })
      .limit(80);
    setOrders((data as unknown as Order[]) || []);
    setLoading(false);
  }, [adminOrders]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, new: 0, to_pay: 0, cash: 0, ready: 0, problem: 0 };
    for (const o of orders) { c.all += 1; c[bucket(o)] += 1; }
    return c;
  }, [orders]);

  const filtered = useMemo(() => orders.filter((o) => {
    if (filter !== 'all' && bucket(o) !== filter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (o.order_no || '').toLowerCase().includes(q)
      || (o.customers?.name || '').toLowerCase().includes(q)
      || (o.customers?.phone || '').includes(q);
  }), [orders, filter, query]);

  const tabs: { k: FilterKey; l: string }[] = [
    { k: 'all', l: 'All' }, { k: 'new', l: 'New' }, { k: 'to_pay', l: 'To Pay' },
    { k: 'cash', l: 'Cash Approval' }, { k: 'ready', l: 'Ready' }, { k: 'problem', l: 'Problem' },
  ];

  return <div className="fade-in">
    <div className="page-header">
      <div><div className="page-label">Dashboard</div><h1 className="page-title">Business Overview</h1><p className="page-subtitle">Overview sahaja. Semua order action dibuat dalam Orders.</p></div>
      <button className="btn btn-primary btn-lg" onClick={onQuickOrder}><IconPlus size={16} /> Quick Order</button>
    </div>
    <div className="stat-row">
      <Metric label="New" value={counts.new} hint="Awaiting action" />
      <Metric label="To Pay" value={counts.to_pay} hint="Payment pending" />
      <Metric label="Cash Check" value={counts.cash} hint="Verify payment" />
      <Metric label="Ready" value={counts.ready} hint="Ready / fulfillment" />
    </div>
    <div className="search-row"><input className="search-input" placeholder="Search name, WhatsApp or Order ID" value={query} onChange={(e) => setQuery(e.target.value)} /><button className="search-btn"><IconSearch size={16} /> Search</button></div>
    <div className="filter-tabs">{tabs.map((t) => <button key={t.k} className={`filter-tab ${filter === t.k ? 'active' : ''}`} onClick={() => setFilter(t.k)}>{t.l} <span className="count">{counts[t.k]}</span></button>)}</div>
    {loading ? <div className="loading"><span className="spinner" /> Loading orders...</div>
      : filtered.length === 0 ? <div className="empty"><div className="empty-title">No orders found</div></div>
      : <div className="order-grid">{filtered.map((o) => <OrderCard key={o.id} order={o} onOpen={() => o.order_no && onOpenOrder?.(o.order_no)} />)}</div>}
  </div>;
}

function Metric({ label, value, hint }: { label: string; value: number; hint: string }) {
  return <div className="stat-card blue"><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-hint">{hint}</div></div>;
}

function OrderCard({ order, onOpen }: { order: Order; onOpen: () => void }) {
  const st = statusDisplay(order);
  const total = Number(order.total || 0);
  const isPaid = (order.payment_status || '').toLowerCase() === 'paid';
  const name = order.customers?.name || 'Guest';
  const phone = order.customers?.phone || '—';
  const items = order.order_items || [];
  const delivery = (order.delivery_method || 'pickup').toLowerCase();
  const normalizedPhone = phone.replace(/\D/g, '');
  return <div className="order-card">
    <div className="order-card-header"><button className="order-no" onClick={onOpen}>{order.order_no || order.id.slice(0, 8)}</button><span className={`tag ${st.cls}`}>{st.label}</span></div>
    <div className="order-dates"><span>Created: {formatDate(order.created_at)}</span>{order.date_need && <span>Need: {formatDate(order.date_need)}</span>}</div>
    <div className="order-customer"><span className="order-customer-name">{name}</span>{normalizedPhone ? <a className="order-customer-phone" href={`https://wa.me/${normalizedPhone}`} target="_blank" rel="noreferrer">{phone}</a> : <span className="order-customer-phone">{phone}</span>}</div>
    <div className="order-info-row"><span className="order-items-count">{items.length} item{items.length !== 1 ? 's' : ''}</span><span className={`tag ${isPaid ? 'tag-paid' : 'tag-pay'}`}>{isPaid ? 'Paid' : 'Unpaid'}</span><span className={`tag ${delivery === 'pickup' ? 'tag-pickup' : 'tag-delivery'}`}>{delivery === 'pickup' ? 'Pickup' : delivery.toUpperCase()}</span><span className={`order-total ${isPaid ? 'paid' : ''}`}>RM {total.toFixed(2)}</span></div>
    {items.length > 0 && <div className="order-item-list">{items.slice(0, 3).map((it, i) => <div key={i} className="order-item-row"><span className="item-name">{it.qty}x {it.title || it.product_type}</span><span className="item-price">RM {Number(it.price || 0).toFixed(2)}</span></div>)}</div>}
    <div className="order-card-actions"><button className="btn btn-primary btn-sm" onClick={onOpen}>Open in Orders</button></div>
  </div>;
}
