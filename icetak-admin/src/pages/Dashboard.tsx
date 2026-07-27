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
  if (s === 'ready' || s === 'in_production' || s === 'shipped' || s === 'delivered') return 'ready';
  if (s === 'payment_received' || ps === 'paid') return 'cash';
  if (['waiting_payment', 'waiting payment'].includes(s) || ['unpaid', 'pending'].includes(ps)) return 'to_pay';
  if (s === 'confirmed' || s === 'new') return 'new';
  return 'to_pay';
}

function statusDisplay(o: Order): { label: string; cls: string } {
  const s = (o.status || '').toLowerCase();
  const ps = (o.payment_status || '').toLowerCase();
  if (s === 'cancelled' || s === 'canceled') return { label: 'Cancelled', cls: 'tag-cancelled' };
  if (s === 'delivered') return { label: 'Delivered', cls: 'tag-paid' };
  if (s === 'shipped') return { label: 'Shipped', cls: 'tag-shipped' };
  if (s === 'ready') return { label: 'Ready', cls: 'tag-ready' };
  if (s === 'in_production') return { label: 'In Production', cls: 'tag-cash' };
  if (s === 'payment_received' || ps === 'paid') return { label: 'Paid', cls: 'tag-paid' };
  if (['waiting_payment', 'waiting payment'].includes(s)) return { label: 'To Pay', cls: 'tag-pay' };
  if (s === 'confirmed' || s === 'new') return { label: 'New Order', cls: 'tag-new' };
  return { label: o.status || 'Draft', cls: 'tag-neutral' };
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Dashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('orders')
      .select('id, order_no, status, payment_status, total, date_need, delivery_method, created_at, customers(name, phone), order_items(title, qty, price, product_type)')
      .order('created_at', { ascending: false })
      .limit(80);
    setOrders((data as unknown as Order[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, new: 0, to_pay: 0, cash: 0, ready: 0, problem: 0 };
    for (const o of orders) { c.all++; c[bucket(o)]++; }
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (filter !== 'all' && bucket(o) !== filter) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (o.order_no || '').toLowerCase().includes(q)
        || (o.customers?.name || '').toLowerCase().includes(q)
        || (o.customers?.phone || '').includes(q);
    });
  }, [orders, filter, query]);

  const tabs: { k: FilterKey; l: string }[] = [
    { k: 'all', l: 'All' },
    { k: 'new', l: 'New' },
    { k: 'to_pay', l: 'To Pay' },
    { k: 'cash', l: 'Cash Approval' },
    { k: 'ready', l: 'Ready' },
    { k: 'problem', l: 'Problem' },
  ];

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <div className="page-label">Dashboard</div>
          <h1 className="page-title">Business Overview</h1>
        </div>
        <button className="btn btn-primary btn-lg">
          <IconPlus size={16} /> Create Customer Order
        </button>
      </div>

      <div className="stat-row">
        <div className="stat-card blue">
          <div className="stat-label">New</div>
          <div className="stat-value">{counts.new}</div>
          <div className="stat-hint">Awaiting action</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">To Pay</div>
          <div className="stat-value">{counts.to_pay}</div>
          <div className="stat-hint">Payment pending</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">Cash Check</div>
          <div className="stat-value">{counts.cash}</div>
          <div className="stat-hint">Verify payment</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Ready</div>
          <div className="stat-value">{counts.ready}</div>
          <div className="stat-hint">Ready for fulfillment</div>
        </div>
      </div>

      <div className="search-row">
        <input
          className="search-input"
          placeholder="Search name, WhatsApp or Order ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="search-btn"><IconSearch size={16} /> Search</button>
      </div>

      <div className="filter-tabs">
        {tabs.map((t) => (
          <button
            key={t.k}
            className={`filter-tab ${filter === t.k ? 'active' : ''}`}
            onClick={() => setFilter(t.k)}
          >
            {t.l} <span className="count">{counts[t.k]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" /> Loading orders...</div>
      ) : filtered.length === 0 ? (
        <div className="empty"><div className="empty-title">No orders found</div></div>
      ) : (
        <div className="order-grid">
          {filtered.map((o) => <OrderCard key={o.id} order={o} />)}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const st = statusDisplay(order);
  const total = Number(order.total || 0);
  const isPaid = (order.payment_status || '').toLowerCase() === 'paid';
  const name = order.customers?.name || 'Guest';
  const phone = order.customers?.phone || '—';
  const items = order.order_items || [];
  const delivery = (order.delivery_method || 'pickup').toLowerCase();

  return (
    <div className="order-card">
      <div className="order-card-header">
        <span className="order-no">{order.order_no || order.id.slice(0, 8)}</span>
        <span className={`tag ${st.cls}`}>{st.label}</span>
      </div>

      <div className="order-dates">
        <span>Created: {formatDate(order.created_at)}</span>
        {order.date_need && <span>Need: {formatDate(order.date_need)}</span>}
      </div>

      <div className="order-customer">
        <span className="order-customer-name">{name}</span>
        <span className="order-customer-phone">{phone}</span>
      </div>

      <div className="order-info-row">
        <span className="order-items-count">{items.length} item{items.length !== 1 ? 's' : ''}</span>
        <span className={`tag ${isPaid ? 'tag-paid' : 'tag-pay'}`}>{isPaid ? 'Paid' : 'Unpaid'}</span>
        <span className={`tag ${delivery === 'pickup' ? 'tag-pickup' : 'tag-delivery'}`}>
          {delivery === 'pickup' ? 'Pickup' : delivery.toUpperCase()}
        </span>
        <span className={`order-total ${isPaid ? 'paid' : ''}`}>RM {total.toFixed(2)}</span>
      </div>

      {items.length > 0 && (
        <div className="order-item-list">
          {items.map((it, i) => (
            <div key={i} className="order-item-row">
              <span className="item-name">{it.qty}x {it.title || it.product_type}</span>
              <span className="item-price">RM {Number(it.price || 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="order-card-actions">
        <button className="btn btn-outline btn-sm">View</button>
        <button className="btn btn-outline btn-sm">Edit</button>
        {!isPaid && <button className="btn btn-confirm btn-sm">Confirm Payment</button>}
        <button className="btn btn-danger btn-sm">Cancel</button>
      </div>
    </div>
  );
}
