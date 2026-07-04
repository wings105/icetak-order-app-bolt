import { LayoutDashboard, Package, Users, Printer } from 'lucide-react';

type Page = 'dashboard' | 'orders' | 'customers';

const NAV = [
  { id: 'dashboard' as Page, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'orders'    as Page, label: 'Orders',    icon: Package           },
  { id: 'customers' as Page, label: 'Customers', icon: Users             },
];

type Props = {
  current: Page;
  onNavigate: (p: Page) => void;
};

export default function Sidebar({ current, onNavigate }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <Printer size={22} />
        <span>iCetak</span>
      </div>
      <nav className="sidebar-nav">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item${current === id ? ' active' : ''}`}
            onClick={() => onNavigate(id)}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">Order Management</div>
    </aside>
  );
}
