import { useEffect, useState, useCallback } from 'react';
import { Search, Plus, ArrowRight } from 'lucide-react';
import { fetchOrders } from '../lib/queries';
import type { Order, OrderStatus } from '../lib/types';
import { statusClass, statusLabel, paymentClass, paymentLabel, fmtCurrency, fmtDate } from './utils';
import NewOrderModal from './NewOrderModal';

type Props = { onOrderClick: (id: string) => void };

const TABS: Array<{ value: OrderStatus | 'all'; label: string }> = [
  { value: 'all',           label: 'All'           },
  { value: 'pending',       label: 'Pending'        },
  { value: 'confirmed',     label: 'Confirmed'      },
  { value: 'in_production', label: 'In Production'  },
  { value: 'ready',         label: 'Ready'          },
  { value: 'shipped',       label: 'Shipped'        },
  { value: 'delivered',     label: 'Delivered'      },
  { value: 'cancelled',     label: 'Cancelled'      },
];

export default function OrdersList({ onOrderClick }: Props) {
  const [tab,     setTab]     = useState<OrderStatus | 'all'>('all');
  const [search,  setSearch]  = useState('');
  const [orders,  setOrders]  = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setOrders(await fetchOrders(tab, search));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Orders</h1>
          <p className="page-subtitle">{orders.length} order{orders.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(true)}>
          <Plus size={16} /> New order
        </button>
      </div>

      <div className="panel">
        <div className="list-controls">
          <div className="tab-strip">
            {TABS.map((t) => (
              <button
                key={t.value}
                className={`tab-btn${tab === t.value ? ' active' : ''}`}
                onClick={() => setTab(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="search-wrap">
            <Search size={16} className="search-icon" />
            <input
              className="search-input"
              placeholder="Search order no or customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading && <div className="table-loading">Loading…</div>}
        {error   && <div className="table-error">{error}</div>}

        {!loading && !error && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Order No</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Delivery</th>
                <th>Total</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => onOrderClick(o.id)}>
                  <td><strong>{o.order_no}</strong></td>
                  <td>{o.customers?.name ?? '—'}</td>
                  <td><span className={`pill ${statusClass(o.status)}`}>{statusLabel(o.status)}</span></td>
                  <td><span className={`pill ${paymentClass(o.payment_status)}`}>{paymentLabel(o.payment_status)}</span></td>
                  <td className="muted">{o.delivery_method?.replace('_', ' ') ?? '—'}</td>
                  <td>{fmtCurrency(o.total)}</td>
                  <td className="muted">{fmtDate(o.created_at)}</td>
                  <td><ArrowRight size={14} className="muted" /></td>
                </tr>
              ))}
              {!orders.length && (
                <tr><td colSpan={8} className="empty-row">No orders found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewOrderModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}
