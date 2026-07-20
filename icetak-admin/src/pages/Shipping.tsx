import { IconTruck, IconPackage, IconCheck, IconClock, IconMore } from '../components/Icons';

const shipments = [
  { id: '#SHP-2391', order: '#ORD-7842', customer: 'Nurul Aisyah', courier: 'Pos Laju', tracking: 'PL123456789MY', status: 'info', date: '20 Jul 2026' },
  { id: '#SHP-2390', order: '#ORD-7841', customer: 'Tan Wei Ming', courier: 'J&T Express', tracking: 'JT987654321', status: 'success', date: '19 Jul 2026' },
  { id: '#SHP-2389', order: '#ORD-7840', customer: 'Siti Khadijah', courier: 'GDEX', tracking: 'GD456789123', status: 'warning', date: '19 Jul 2026' },
  { id: '#SHP-2388', order: '#ORD-7839', customer: 'Raj Kumar', courier: 'DHL', tracking: 'DHL789456123', status: 'success', date: '18 Jul 2026' },
  { id: '#SHP-2387', order: '#ORD-7838', customer: 'Lim Mei Ling', courier: 'Pos Laju', tracking: 'PL789456123MY', status: 'neutral', date: '18 Jul 2026' },
];

const statusMap: Record<string, { label: string; cls: string }> = {
  success: { label: 'Delivered', cls: 'badge-success' },
  info: { label: 'In Transit', cls: 'badge-info' },
  warning: { label: 'Delayed', cls: 'badge-warning' },
  neutral: { label: 'Pending Pickup', cls: 'badge-neutral' },
};

const stats = [
  { icon: IconTruck, color: 'blue', value: '24', label: 'In Transit' },
  { icon: IconPackage, color: 'amber', value: '3', label: 'Pending Pickup' },
  { icon: IconCheck, color: 'green', value: '186', label: 'Delivered (Month)' },
  { icon: IconClock, color: 'red', value: '2', label: 'Delayed' },
];

export default function Shipping() {
  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Shipping</h1>
          <p className="page-subtitle">Track shipments and delivery status</p>
        </div>
      </div>

      <div className="stats-grid">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="stat-card">
              <div className="stat-header">
                <div className={`stat-icon ${s.color}`}><Icon size={22} /></div>
              </div>
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Shipments</div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Shipment ID</th>
                <th>Order</th>
                <th>Customer</th>
                <th>Courier</th>
                <th>Tracking No.</th>
                <th>Status</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => {
                const st = statusMap[s.status];
                return (
                  <tr key={s.id} className="row-hover">
                    <td className="cell-id">{s.id}</td>
                    <td className="cell-sub">{s.order}</td>
                    <td className="cell-name">{s.customer}</td>
                    <td>{s.courier}</td>
                    <td className="cell-sub">{s.tracking}</td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td className="cell-sub">{s.date}</td>
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
