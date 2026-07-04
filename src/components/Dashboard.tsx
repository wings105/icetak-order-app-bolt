import { useEffect, useState } from 'react';
import { TrendingUp, Package, Clock, Cog, ArrowRight } from 'lucide-react';
import { fetchDashboardStats, fetchRecentOrders } from '../lib/queries';
import type { DashboardStats, Order } from '../lib/types';
import { statusLabel, statusClass, paymentClass, paymentLabel, fmtCurrency, fmtDate } from './utils';

type Props = { onOrderClick: (id: string) => void };

const STATUS_ORDER = ['pending','confirmed','in_production','ready','shipped','delivered','cancelled'];

export default function Dashboard({ onOrderClick }: Props) {
  const [stats,   setStats]   = useState<DashboardStats | null>(null);
  const [recent,  setRecent]  = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, r] = await Promise.all([fetchDashboardStats(), fetchRecentOrders()]);
        if (!cancelled) { setStats(s); setRecent(r); }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="page-loading">Loading dashboard…</div>;
  if (error)   return <div className="page-error">{error}</div>;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-subtitle">Overview of all orders and production</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><Package size={20} /></div>
          <div>
            <div className="stat-value">{stats!.total}</div>
            <div className="stat-label">Total orders</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><TrendingUp size={20} /></div>
          <div>
            <div className="stat-value">{fmtCurrency(stats!.revenue)}</div>
            <div className="stat-label">Total revenue</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><Cog size={20} /></div>
          <div>
            <div className="stat-value">{stats!.in_production}</div>
            <div className="stat-label">In production</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon yellow"><Clock size={20} /></div>
          <div>
            <div className="stat-value">{stats!.pending}</div>
            <div className="stat-label">Pending</div>
          </div>
        </div>
      </div>

      <div className="dashboard-body">
        <div className="panel">
          <div className="panel-head"><h2>Recent orders</h2></div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Order No</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Total</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recent.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => onOrderClick(o.id)}>
                  <td><strong>{o.order_no}</strong></td>
                  <td>{o.customers?.name ?? '—'}</td>
                  <td><span className={`pill ${statusClass(o.status)}`}>{statusLabel(o.status)}</span></td>
                  <td><span className={`pill ${paymentClass(o.payment_status)}`}>{paymentLabel(o.payment_status)}</span></td>
                  <td>{fmtCurrency(o.total)}</td>
                  <td className="muted">{fmtDate(o.created_at)}</td>
                  <td><ArrowRight size={14} className="muted" /></td>
                </tr>
              ))}
              {!recent.length && (
                <tr><td colSpan={7} className="empty-row">No orders yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>By status</h2></div>
          <div className="status-breakdown">
            {STATUS_ORDER.map((s) => {
              const count = stats!.byStatus[s] ?? 0;
              const pct   = stats!.total ? Math.round((count / stats!.total) * 100) : 0;
              return (
                <div key={s} className="status-row">
                  <span className={`pill ${statusClass(s)}`}>{statusLabel(s)}</span>
                  <div className="status-bar-wrap">
                    <div className="status-bar" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="status-count">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
