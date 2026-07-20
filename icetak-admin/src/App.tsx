import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Payments from './pages/Payments';
import Shipping from './pages/Shipping';
import Settings from './pages/Settings';

const pageTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  orders: 'Orders',
  payments: 'Payments',
  shipping: 'Shipping',
  products: 'Products',
  customers: 'Customers',
  reports: 'Reports',
  settings: 'Settings',
};

export default function App() {
  const [active, setActive] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNavigate = (key: string) => {
    setActive(key);
    setMobileOpen(false);
  };

  const renderPage = () => {
    switch (active) {
      case 'dashboard': return <Dashboard />;
      case 'orders': return <Orders />;
      case 'payments': return <Payments />;
      case 'shipping': return <Shipping />;
      case 'settings': return <Settings />;
      default: return <Placeholder title={pageTitles[active] || active} />;
    }
  };

  return (
    <div className="app">
      <Sidebar
        active={active}
        onNavigate={handleNavigate}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="main">
        <Topbar
          onToggleSidebar={() => setCollapsed(!collapsed)}
          onOpenMobile={() => setMobileOpen(true)}
          title={pageTitles[active] || ''}
        />
        <div className="content">
          {renderPage()}
        </div>
      </div>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">This page is under construction</p>
        </div>
      </div>
      <div className="panel">
        <div className="empty">
          <div className="empty-icon">🚧</div>
          <div>{title} page coming soon</div>
        </div>
      </div>
    </div>
  );
}
