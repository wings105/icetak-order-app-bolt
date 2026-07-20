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

type PageInfo = { title: string; crumb: string };

const pageInfo: Record<string, PageInfo> = {
  dashboard: { title: 'Order Control Tower', crumb: 'Main / Order Control Tower' },
  payments: { title: 'Payments Center', crumb: 'Operations / Payments' },
  shipping: { title: 'Shipping & Delivery', crumb: 'Operations / Shipping' },
  'whatsapp-control': { title: 'WhatsApp Control', crumb: 'Operations / WhatsApp / Control' },
  'whatsapp-templates': { title: 'WhatsApp Templates', crumb: 'Operations / WhatsApp / Templates' },
  'whatsapp-outbox': { title: 'WhatsApp Outbox', crumb: 'Operations / WhatsApp / Outbox' },
  integrations: { title: 'Integrations', crumb: 'Control / Integrations' },
  staff: { title: 'Staff & Roles', crumb: 'Control / Staff & Roles' },
  settings: { title: 'Settings', crumb: 'Control / Settings' },
};

export default function App() {
  const [active, setActive] = useState('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNavigate = (key: string) => {
    setActive(key);
    setMobileOpen(false);
  };

  const renderPage = () => {
    switch (active) {
      case 'dashboard': return <Dashboard />;
      case 'payments': return <Payments />;
      case 'shipping': return <Shipping />;
      case 'whatsapp-control': return <WhatsAppControl />;
      case 'whatsapp-templates': return <WhatsAppTemplates />;
      case 'whatsapp-outbox': return <WhatsAppOutbox />;
      case 'integrations': return <Integrations />;
      case 'staff': return <StaffRoles />;
      case 'settings': return <Settings />;
      default: return <Dashboard />;
    }
  };

  const info = pageInfo[active] || pageInfo.dashboard;

  return (
    <div className="app">
      <Sidebar
        active={active}
        onNavigate={handleNavigate}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="main">
        <Topbar
          title={info.title}
          crumb={info.crumb}
          onOpenMobile={() => setMobileOpen(true)}
        />
        <div className="content">
          {renderPage()}
        </div>
      </div>
    </div>
  );
}
