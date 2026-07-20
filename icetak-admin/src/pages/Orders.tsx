import { useState } from 'react';
import { IconPlus, IconDownload, IconMore, IconSearch } from '../components/Icons';

const allOrders = [
  { id: '#ORD-7842', customer: 'Nurul Aisyah', product: 'Business Cards (500pcs)', amount: 'RM 120.00', status: 'success', date: '20 Jul 2026' },
  { id: '#ORD-7841', customer: 'Tan Wei Ming', product: 'A2 Poster Print', amount: 'RM 85.00', status: 'info', date: '20 Jul 2026' },
  { id: '#ORD-7840', customer: 'Siti Khadijah', product: 'Wedding Invitation Set', amount: 'RM 450.00', status: 'warning', date: '19 Jul 2026' },
  { id: '#ORD-7839', customer: 'Raj Kumar', product: 'Banner 6x2 ft', amount: 'RM 240.00', status: 'success', date: '19 Jul 2026' },
  { id: '#ORD-7838', customer: 'Lim Mei Ling', product: 'Flyer Design + Print', amount: 'RM 320.00', status: 'error', date: '18 Jul 2026' },
  { id: '#ORD-7837', customer: 'Ahmad Faizal', product: 'Name Cards Premium', amount: 'RM 180.00', status: 'neutral', date: '18 Jul 2026' },
  { id: '#ORD-7836', customer: 'Goh Pei San', product: 'Sticker Roll (Custom)', amount: 'RM 95.00', status: 'info', date: '17 Jul 2026' },
  { id: '#ORD-7835', customer: 'Mohd Hafiz', product: 'Brochure Tri-fold', amount: 'RM 210.00', status: 'success', date: '17 Jul 2026' },
];

const statusMap: Record<string, { label: string; cls: string }> = {
  success: { label: 'Completed', cls: 'badge-success' },
  info: { label: 'Processing', cls: 'badge-info' },
  warning: { label: 'Pending', cls: 'badge-warning' },
  error: { label: 'Cancelled', cls: 'badge-error' },
  neutral: { label: 'Draft', cls: 'badge-neutral' },
};

export default function Orders() {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const filtered = allOrders.filter((o) => {
    const matchFilter = filter === 'all' || o.status === filter;
    const matchQuery = !query || o.id.toLowerCase().includes(query.toLowerCase()) || o.customer.toLowerCase().includes(query.toLowerCase());
    return matchFilter && matchQuery;
  });

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Orders</h1>
          <p className="page-subtitle">Manage and track all customer orders</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline"><IconDownload size={16} /> Export</button>
          <button className="btn btn-primary"><IconPlus size={16} /> New Order</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="filter-tabs">
            {[
              { k: 'all', l: 'All' },
              { k: 'warning', l: 'Pending' },
              { k: 'info', l: 'Processing' },
              { k: 'success', l: 'Completed' },
              { k: 'error', l: 'Cancelled' },
            ].map((t) => (
              <button key={t.k} className={`filter-tab ${filter === t.k ? 'active' : ''}`} onClick={() => setFilter(t.k)}>{t.l}</button>
            ))}
          </div>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><IconSearch size={16} /></span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search orders..."
              style={{ height: 38, width: 240, padding: '0 12px 0 38px', border: '1px solid var(--border)', borderRadius: 8, outline: 'none', background: 'var(--content-bg)' }}
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7}><div className="empty">No orders found</div></td></tr>
              ) : filtered.map((o) => {
                const st = statusMap[o.status];
                return (
                  <tr key={o.id} className="row-hover">
                    <td className="cell-id">{o.id}</td>
                    <td>
                      <div className="cell-customer">
                        <div className="cell-avatar">{o.customer.split(' ').map((n) => n[0]).join('').slice(0, 2)}</div>
                        <div className="cell-name">{o.customer}</div>
                      </div>
                    </td>
                    <td>{o.product}</td>
                    <td className="cell-amount">{o.amount}</td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td className="cell-sub">{o.date}</td>
                    <td><button className="icon-btn"><IconMore size={16} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
