import { IconDollar, IconCart, IconUsers, IconArrowUp, IconArrowDown, IconDownload, IconMore } from '../components/Icons';

const payments = [
  { id: '#PAY-3421', order: '#ORD-7842', customer: 'Nurul Aisyah', method: 'Online Banking', amount: 'RM 120.00', status: 'success', date: '20 Jul 2026' },
  { id: '#PAY-3420', order: '#ORD-7841', customer: 'Tan Wei Ming', method: 'Credit Card', amount: 'RM 85.00', status: 'success', date: '20 Jul 2026' },
  { id: '#PAY-3419', order: '#ORD-7840', customer: 'Siti Khadijah', method: 'FPX', amount: 'RM 450.00', status: 'warning', date: '19 Jul 2026' },
  { id: '#PAY-3418', order: '#ORD-7839', customer: 'Raj Kumar', method: 'E-Wallet', amount: 'RM 240.00', status: 'success', date: '19 Jul 2026' },
  { id: '#PAY-3417', order: '#ORD-7838', customer: 'Lim Mei Ling', method: 'Credit Card', amount: 'RM 320.00', status: 'error', date: '18 Jul 2026' },
];

const statusMap: Record<string, { label: string; cls: string }> = {
  success: { label: 'Paid', cls: 'badge-success' },
  warning: { label: 'Pending', cls: 'badge-warning' },
  error: { label: 'Failed', cls: 'badge-error' },
};

const stats = [
  { icon: IconDollar, color: 'green', value: 'RM 48,560', label: 'Total Revenue', trend: 'up', trendVal: '+12.5%' },
  { icon: IconCart, color: 'blue', value: 'RM 9,820', label: 'This Month', trend: 'up', trendVal: '+5.8%' },
  { icon: IconUsers, color: 'amber', value: 'RM 1,240', label: 'Pending', trend: 'down', trendVal: '-3.2%' },
];

export default function Payments() {
  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">Track transactions and payment status</p>
        </div>
        <button className="btn btn-outline"><IconDownload size={16} /> Export Report</button>
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

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Transaction History</div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Payment ID</th>
                <th>Order</th>
                <th>Customer</th>
                <th>Method</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const st = statusMap[p.status];
                return (
                  <tr key={p.id} className="row-hover">
                    <td className="cell-id">{p.id}</td>
                    <td className="cell-sub">{p.order}</td>
                    <td className="cell-name">{p.customer}</td>
                    <td>{p.method}</td>
                    <td className="cell-amount">{p.amount}</td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td className="cell-sub">{p.date}</td>
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
