import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  IconPlus, IconSearch, IconEye, IconEdit, IconCheck, IconX,
  IconCalendar, IconPhone, IconMessage,
} from '../components/Icons';

type Order = {
  id: string;
  order_no: string | null;
  status: string | null;
  payment_status: string | null;
  total: number | string | null;
  created_at: string;
  customer_id: string | null;
  customers?: { name: string | null; phone: string | null } | null;
};

type FilterKey = 'all' | 'new' | 'to_pay' | 'cash' | 'ready' | 'problem';

function bucketOf(o: Order): FilterKey[] {
  const s = (o.status || '').toLowerCase();
  const ps = (o.payment_status || '').toLowerCase();
  const buckets: FilterKey[] = ['all'];
  if (['confirmed', 'new'].includes(s) && ps !== 'paid') buckets.push('new');
  if (['waiting_payment', 'waiting payment'].includes(s) || ['unpaid', 'pending'].includes(ps)) buckets.push('to_pay');
  if (s === 'cash_check' || ps === 'cash_check' || s === 'payment_received') buckets.push('cash');
  if (s === 'ready' || s === 'in_production') buckets.push('ready');
  if (['problem', 'failed', 'cancelled', 'canceled'].includes(s)) buckets.push('problem');
  return buckets;
}

function displayStatus(o: Order): { label: string; cls: string } {
  const s = (o.status || '').toLowerCase();
  const ps = (o.payment_status || '').toLowerCase();
  if (s === 'delivered') return { label: 'Delivered', cls: 'tag-paid' };
  if (s === 'shipped') return { label: 'Shipped', cls: 'tag-shipped' };
  if (s === 'ready') return { label: 'Ready', cls: 'tag-ready' };
  if (s === 'in_production') return { label: 'In Production', cls: 'tag-cash' };
  if (s === 'payment_received' || ps === 'paid') return { label: 'Paid', cls: 'tag-paid' };
  if (['waiting_payment', 'waiting payment'].includes(s)) return { label: 'To Pay', cls: 'tag-pay' };
  if (s === 'confirmed') return { label: 'New', cls: 'tag-new' };
  return { label: o.status || 'Draft', cls: 'tag-neutral' };
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function Dashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_no, status, payment_status, total, created_at, customer_id, customers(name, phone)')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) setErr(error.message);
    else setOrders((data as unknown as Order[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c = { all: 0, new: 0, to_pay: 0, cash: 0, ready: 0, problem: 0 } as Record<FilterKey, number>;
    for (const o of orders) for (const b of bucketOf(o)) c[b]++;
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const inBucket = bucketOf(o).includes(filter);
      if (!inBucket) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        (o.order_no || '').toLowerCase().includes(q) ||
        (o.customers?.name || '').toLowerCase().includes(q) ||
        (o.customers?.phone || '').toLowerCase().includes(q)
      );
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
          <h1 className="page-title">Business Overview</h1>
          <p className="page-subtitle">Real-time snapshot of orders across every channel</p>
        </div>
        <button className="btn btn-primary btn-primary-lg">
          <IconPlus size={16} /> Create Customer Order
        </button>
      </div>

      <div className="stats-grid">
        <StatCard label="New" value={counts.new} hint="Awaiting confirmation" cls="new" />
        <StatCard label="To Pay" value={counts.to_pay} hint="Payment pending" cls="pay" />
        <StatCard label="Cash Check" value={counts.cash} hint="Approval needed" cls="cash" />
        <StatCard label="Ready" value={counts.ready} hint="Ready for pickup" cls="ready" />
      </div>

      <div className="search-bar">
        <div className="search-input-wrap">
          <IconSearch size={18} />
          <input
            placeholder="Search order no, customer, or WhatsApp..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="filter-tabs" style={{ marginBottom: 14 }}>
        {tabs.map((t) => (
          <button
            key={t.k}
            className={`filter-tab ${filter === t.k ? 'active' : ''}`}
            onClick={() => setFilter(t.k)}
          >
            {t.l}
            <span className="count">{counts[t.k]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="panel"><div className="loading"><span className="spinner" /> <span style={{ marginLeft: 8 }}>Loading orders…</span></div></div>
      ) : err ? (
        <div className="panel"><div className="empty"><div className="empty-icon">!</div><div className="empty-title">Failed to load orders</div><div>{err}</div></div></div>
      ) : filtered.length === 0 ? (
        <div className="panel"><div className="empty"><div className="empty-icon">—</div><div className="empty-title">No orders</div><div>Nothing matches the current filter.</div></div></div>
      ) : (
        <div className="order-list">
          {filtered.map((o) => <OrderCard key={o.id} order={o} />)}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, hint, cls }: { label: string; value: number; hint: string; cls: string }) {
  return (
    <div className={`stat-card ${cls}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-hint">{hint}</div>
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const st = displayStatus(order);
  const total = Number(order.total || 0);
  const name = order.customers?.name || 'Guest customer';
  const phone = order.customers?.phone || '—';
  const bucket = bucketOf(order);

  return (
    <div className="order-card">
      <div className="order-card-left">
        <div className="order-meta">
          <span className="order-no">{order.order_no || order.id.slice(0, 8)}</span>
          <span className={`tag ${st.cls}`}>{st.label}</span>
          {bucket.includes('to_pay') && <span className="tag tag-whatsapp"><IconMessage size={10} /> WhatsApp</span>}
        </div>
        <div className="order-customer">{name}</div>
        <div className="order-desc">
          <span><IconPhone size={12} /> {phone}</span>
          <span><IconCalendar size={12} /> {timeAgo(order.created_at)}</span>
        </div>
      </div>

      <div className="order-card-right">
        <div className="order-total">
          <div className="label">Total</div>
          <div className="amount">RM {total.toFixed(2)}</div>
        </div>
        <div className="order-actions">
          <button className="btn btn-outline btn-sm"><IconEye size={14} /> View</button>
          <button className="btn btn-outline btn-sm"><IconEdit size={14} /> Edit</button>
          {bucket.includes('to_pay') && (
            <button className="btn btn-primary btn-sm"><IconCheck size={14} /> Confirm Payment</button>
          )}
          <button className="btn btn-danger btn-sm"><IconX size={14} /> Cancel</button>
        </div>
      </div>
    </div>
  );
}
