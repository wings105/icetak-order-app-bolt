import {
  IconDollar, IconCart, IconBox, IconUsers, IconArrowUp, IconArrowDown,
  IconDownload, IconPlus, IconFilter, IconMore, IconCheck, IconClock, IconPackage, IconTruck,
} from '../components/Icons';

const stats = [
  { icon: IconDollar, color: 'green', value: 'RM 48,560', label: 'Total Revenue', trend: 'up', trendVal: '+12.5%' },
  { icon: IconCart, color: 'blue', value: '1,284', label: 'Total Orders', trend: 'up', trendVal: '+8.2%' },
  { icon: IconBox, color: 'purple', value: '342', label: 'Products', trend: 'up', trendVal: '+3.1%' },
  { icon: IconUsers, color: 'amber', value: '2,847', label: 'Customers', trend: 'down', trendVal: '-2.4%' },
];

const orders = [
  { id: '#ORD-7842', customer: 'Nurul Aisyah', email: 'nurul@example.com', product: 'Business Cards (500pcs)', qty: 2, amount: 'RM 120.00', status: 'success', date: '20 Jul 2026' },
  { id: '#ORD-7841', customer: 'Tan Wei Ming', email: 'weiming@example.com', product: 'A2 Poster Print', qty: 1, amount: 'RM 85.00', status: 'info', date: '20 Jul 2026' },
  { id: '#ORD-7840', customer: 'Siti Khadijah', email: 'siti@example.com', product: 'Wedding Invitation Set', qty: 1, amount: 'RM 450.00', status: 'warning', date: '19 Jul 2026' },
  { id: '#ORD-7839', customer: 'Raj Kumar', email: 'raj@example.com', product: 'Banner 6x2 ft', qty: 3, amount: 'RM 240.00', status: 'success', date: '19 Jul 2026' },
  { id: '#ORD-7838', customer: 'Lim Mei Ling', email: 'meiling@example.com', product: 'Flyer Design + Print', qty: 1, amount: 'RM 320.00', status: 'error', date: '18 Jul 2026' },
  { id: '#ORD-7837', customer: 'Ahmad Faizal', email: 'faizal@example.com', product: 'Name Cards Premium', qty: 2, amount: 'RM 180.00', status: 'neutral', date: '18 Jul 2026' },
];

const statusMap: Record<string, { label: string; cls: string }> = {
  success: { label: 'Completed', cls: 'badge-success' },
  info: { label: 'Processing', cls: 'badge-info' },
  warning: { label: 'Pending', cls: 'badge-warning' },
  error: { label: 'Cancelled', cls: 'badge-error' },
  neutral: { label: 'Draft', cls: 'badge-neutral' },
};

const activities = [
  { icon: IconCheck, color: '#d1fae5', iconColor: '#059669', text: 'Order #ORD-7842 was completed by Nurul Aisyah', time: '2 minutes ago' },
  { icon: IconPackage, color: '#dbeafe', iconColor: '#2563eb', text: 'New order #ORD-7841 received from Tan Wei Ming', time: '18 minutes ago' },
  { icon: IconTruck, color: '#fef3c7', iconColor: '#d97706', text: 'Shipment #SHP-2391 dispatched for delivery', time: '1 hour ago' },
  { icon: IconClock, color: '#ede9fe', iconColor: '#7c3aed', text: 'Payment RM 450.00 pending verification', time: '2 hours ago' },
  { icon: IconCheck, color: '#d1fae5', iconColor: '#059669', text: 'Product "A2 Poster Print" stock updated', time: '3 hours ago' },
];

export default function Dashboard() {
  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Welcome back, Admin. Here's what's happening today.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline"><IconDownload size={16} /> Export</button>
          <button className="btn btn-primary"><IconPlus size={16} /> New Order</button>
        </div>
      </div>

      <div className="stats-grid">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="stat-card">
              <div className="stat-header">
                <div className={`stat-icon ${s.color}`}><Icon size={22} /></div>
                <span className={`stat-trend ${s.trend}`}>
                  {s.trend === 'up' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />}
                  {s.trendVal}
                </span>
              </div>
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          );
        })}
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Recent Orders</div>
              <div className="panel-subtitle">Latest 6 orders across all channels</div>
            </div>
            <div className="panel-actions">
              <div className="filter-tabs">
                <button className="filter-tab active">All</button>
                <button className="filter-tab">Pending</button>
                <button className="filter-tab">Completed</button>
              </div>
              <button className="btn btn-ghost"><IconFilter size={16} /></button>
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
                {orders.map((o) => {
                  const st = statusMap[o.status];
                  return (
                    <tr key={o.id} className="row-hover">
                      <td className="cell-id">{o.id}</td>
                      <td>
                        <div className="cell-customer">
                          <div className="cell-avatar">{o.customer.split(' ').map(n => n[0]).join('').slice(0, 2)}</div>
                          <div>
                            <div className="cell-name">{o.customer}</div>
                            <div className="cell-sub">{o.email}</div>
                          </div>
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

        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Recent Activity</div>
              <div className="panel-subtitle">Last 24 hours</div>
            </div>
          </div>
          <div>
            {activities.map((a, i) => {
              const Icon = a.icon;
              return (
                <div key={i} className="activity-item">
                  <div className="activity-dot" style={{ background: a.color, color: a.iconColor }}>
                    <Icon size={16} />
                  </div>
                  <div>
                    <div className="activity-text">{a.text}</div>
                    <div className="activity-time">{a.time}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
