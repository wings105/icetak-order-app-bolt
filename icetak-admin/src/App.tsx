import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Dashboard from './pages/Dashboard';
import Payments from './pages/Payments';
import Shipping from './pages/Shipping';
import WhatsAppControl from './pages/WhatsAppControl';
import WhatsAppTemplates from './pages/WhatsAppTemplates';
import WhatsAppOutbox from './pages/WhatsAppOutbox';
import Integrations from './pages/Integrations';
import StaffRoles from './pages/StaffRoles';
import Settings from './pages/Settings';

const pageMap: Record<string, { title: string; subtitle?: string }> = {
  dashboard: { title: 'Order Control Tower', subtitle: 'Business Overview' },
  orders: { title: 'Orders', subtitle: 'All orders' },
  payments: { title: 'Payments Center', subtitle: 'Transactions' },
  shipping: { title: 'Shipping & Tracking', subtitle: 'Parcels' },
  'whatsapp-control': { title: 'WhatsApp Control', subtitle: 'Pipeline' },
  'whatsapp-templates': { title: 'WhatsApp Templates' },
  'whatsapp-outbox': { title: 'WhatsApp Outbox' },
  integrations: { title: 'Integrations', subtitle: 'Third-party' },
  staff: { title: 'Staff / Roles' },
  settings: { title: 'Settings' },
};

type Props = {
  onSwitchToV1?: () => void;
  adminData?: {
    orders?: React.ComponentProps<typeof Dashboard>['adminOrders'];
  };
};

export default function App({ onSwitchToV1, adminData }: Props) {
  const linkedOrder = new URLSearchParams(window.location.search).get('order')?.trim() || '';
  const [page, setPage] = useState(linkedOrder ? 'orders' : 'dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigate = (key: string) => {
    if (key !== 'orders') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('order')) {
        url.searchParams.delete('order');
        window.history.replaceState({}, '', url);
      }
    }
    setPage(key);
    setMobileOpen(false);
  };

  const info = pageMap[page] || pageMap.dashboard;
  const linkedOrders = linkedOrder && adminData?.orders
    ? adminData.orders.filter((order) => {
        const orderNo = String(order.id || '').trim().toLowerCase();
        const dbId = String(order.dbId || '').trim().toLowerCase();
        const target = linkedOrder.toLowerCase();
        return orderNo === target || dbId === target;
      })
    : adminData?.orders;

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard adminOrders={adminData?.orders} />;
      case 'orders': return <Dashboard adminOrders={linkedOrders} />;
      case 'payments': return <Payments />;
      case 'shipping': return <Shipping />;
      case 'whatsapp-control': return <WhatsAppControl />;
      case 'whatsapp-templates': return <WhatsAppTemplates />;
      case 'whatsapp-outbox': return <WhatsAppOutbox />;
      case 'integrations': return <Integrations />;
      case 'staff': return <StaffRoles />;
      case 'settings': return <Settings />;
      default: return <Dashboard adminOrders={adminData?.orders} />;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar
        active={page}
        onNavigate={navigate}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="main-content">
        <Topbar
          title={info.title}
          subtitle={info.subtitle}
          onOpenMobile={() => setMobileOpen(true)}
          onSwitchAdmin={onSwitchToV1}
        />
        <div className="content-area">
          {renderPage()}
        </div>
      </div>
    </div>
  );
}
