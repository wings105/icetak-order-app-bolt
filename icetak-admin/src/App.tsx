import { useState } from 'react';
import { supabase } from './lib/supabase';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import QuickOrder from './pages/QuickOrder';
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
  orders: { title: 'Orders', subtitle: 'Full order lifecycle' },
  'quick-order': { title: 'Quick Order', subtitle: 'Counter & WhatsApp orders' },
  payments: { title: 'Payments Center', subtitle: 'Transactions' },
  shipping: { title: 'Shipping & Tracking', subtitle: 'Parcels' },
  'whatsapp-control': { title: 'WhatsApp Control', subtitle: 'Pipeline' },
  'whatsapp-templates': { title: 'WhatsApp Templates' },
  'whatsapp-outbox': { title: 'WhatsApp Outbox' },
  integrations: { title: 'Integrations', subtitle: 'Third-party' },
  staff: { title: 'Staff / Roles' },
  settings: { title: 'Settings', subtitle: 'Admin system settings' },
};

type AdminData = {
  admin?: { username?: string; display_name?: string; role?: string; permissions?: string[] };
  orders?: React.ComponentProps<typeof Dashboard>['adminOrders'];
  admins?: Array<{ username?: string; display_name?: string; email?: string; role?: string; permissions?: string[] }>;
};
type Props = { adminData?: AdminData };

export default function App({ adminData }: Props) {
  const linkedOrder = new URLSearchParams(window.location.search).get('order')?.trim() || '';
  const [page, setPage] = useState(linkedOrder ? 'orders' : 'dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const permissions = adminData?.admin?.permissions || [];

  const navigate = (key: string) => {
    const url = new URL(window.location.href);
    if (key !== 'orders') url.searchParams.delete('order');
    window.history.replaceState({}, '', url);
    setPage(key); setMobileOpen(false);
  };
  const openOrder = (orderNo: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('admin','v2');
    url.searchParams.set('order',orderNo);
    window.history.replaceState({},'',url);
    setPage('orders');
  };
  const logout = async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem('admin_access_token');
    sessionStorage.removeItem('admin_refresh_token');
    sessionStorage.removeItem('admin_session');
    window.location.assign(`${window.location.pathname}?admin=v2`);
  };

  const info = pageMap[page] || pageMap.dashboard;
  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard adminOrders={adminData?.orders} onQuickOrder={() => navigate('quick-order')} onOpenOrder={openOrder} />;
      case 'orders': return <Orders permissions={permissions} initialOrder={linkedOrder} />;
      case 'quick-order': return <QuickOrder permissions={permissions} onOpenOrder={openOrder} />;
      case 'payments': return <Payments />;
      case 'shipping': return <Shipping />;
      case 'whatsapp-control': return <WhatsAppControl />;
      case 'whatsapp-templates': return <WhatsAppTemplates />;
      case 'whatsapp-outbox': return <WhatsAppOutbox />;
      case 'integrations': return <Integrations />;
      case 'staff': return <StaffRoles currentPermissions={permissions} />;
      case 'settings': return <Settings permissions={permissions} />;
      default: return <Dashboard adminOrders={adminData?.orders} onQuickOrder={() => navigate('quick-order')} onOpenOrder={openOrder} />;
    }
  };

  return <div className="app-layout"><Sidebar active={page} onNavigate={navigate} mobileOpen={mobileOpen} onCloseMobile={()=>setMobileOpen(false)} onLogout={()=>void logout()} /><div className="main-content"><Topbar title={info.title} subtitle={info.subtitle} onOpenMobile={()=>setMobileOpen(true)} /><div className="content-area">{renderPage()}</div></div></div>;
}
