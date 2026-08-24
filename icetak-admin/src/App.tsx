import { lazy, Suspense, useState } from 'react';
import { supabase } from './lib/supabase';
import './order-fulfillment-tracking';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Customers from './pages/Customers';
import type { LinkedQrPayment } from './pages/CreateOrder';
import Payments from './pages/Payments';
import Finance from './pages/Finance';
import QrPayDailySummary, { type QrPayCreatePayload } from './pages/QrPayDailySummary';
import DraftOrders from './pages/DraftOrders';
import Shipping from './pages/Shipping';
import ClickUpQueue from './pages/ClickUpQueue';
import WhatsAppControl from './pages/WhatsAppControl';
import WhatsAppTemplates from './pages/WhatsAppTemplates';
import WhatsAppOutbox from './pages/WhatsAppOutbox';
import Integrations from './pages/Integrations';
import StaffRoles from './pages/StaffRoles';
import Settings from './pages/Settings';

const AiLearningSettings = lazy(() => import('./pages/AiLearningSettings'));
const CreateOrder = lazy(() => import('./pages/CreateOrder'));
const PickupCounter = lazy(() => import('./pages/PickupCounter'));

const pageMap: Record<string, { title: string; subtitle?: string }> = {
  dashboard: { title: 'Order Control Tower', subtitle: 'Business Overview' },
  orders: { title: 'Orders', subtitle: 'Full order lifecycle' },
  'pickup-counter': { title: 'Pickup Counter', subtitle: 'Multi-order payment & secure handover' },
  customers: { title: 'Customer CRM', subtitle: 'Customer 360° & relationship management' },
  'create-order': { title: 'Create Order', subtitle: 'Prepaid, cash counter, QRPay & custom pricing' },
  payments: { title: 'Payments Center', subtitle: 'Transactions' },
  finance: { title: 'Finance', subtitle: 'Bank, wallet & accounting' },
  'qrpay-summary': { title: 'QRPay Daily', subtitle: 'Daily payment control' },
  'draft-orders': { title: 'Draft Orders', subtitle: 'Review, edit & payment linking' },
  shipping: { title: 'Shipping & Tracking', subtitle: 'Parcels' },
  'clickup-queue': { title: 'ClickUp Queue', subtitle: 'Activepieces production task queue' },
  'whatsapp-control': { title: 'WhatsApp Control', subtitle: 'Pipeline' },
  'whatsapp-templates': { title: 'WhatsApp Templates' },
  'whatsapp-outbox': { title: 'WhatsApp Outbox' },
  integrations: { title: 'Integrations', subtitle: 'Third-party' },
  staff: { title: 'Staff / Roles' },
  settings: { title: 'Settings', subtitle: 'Admin system settings' },
  'ai-learning': { title: 'AI Learning', subtitle: 'Weekly draft learning, rules and rollback' },
};

type AdminData = {
  admin?: { username?: string; display_name?: string; role?: string; permissions?: string[] };
  orders?: React.ComponentProps<typeof Dashboard>['adminOrders'];
  admins?: Array<{ username?: string; display_name?: string; email?: string; role?: string; permissions?: string[] }>;
};
type Props = { adminData?: AdminData };

export default function App({ adminData }: Props) {
  const initialParams=new URLSearchParams(window.location.search);
  const linkedOrder = initialParams.get('order')?.trim() || '';
  const linkedCustomer = initialParams.get('customer')?.trim() || '';
  const linkedView = initialParams.get('view')?.trim() || '';
  const initialPayment:LinkedQrPayment|null=initialParams.get('qrpay_tx')?{
    transactionId:initialParams.get('qrpay_tx')||'',
    amount:Number(initialParams.get('qrpay_amount')||0),
    phone:initialParams.get('qrpay_phone')||'',
    customerName:initialParams.get('qrpay_name')||'',
    paidAt:initialParams.get('qrpay_paid_at')||'',
  }:null;
  const [page, setPage] = useState(linkedOrder ? 'orders' : linkedView === 'pickup-counter' ? 'pickup-counter' : (linkedView === 'customers' || linkedCustomer) ? 'customers' : linkedView === 'qrpay-summary' ? 'qrpay-summary' : linkedView === 'draft-orders' ? 'draft-orders' : linkedView === 'ai-learning' ? 'ai-learning' : ['create-order','quick-order','manual-order'].includes(linkedView)?'create-order':'dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [linkedPayment,setLinkedPayment]=useState<LinkedQrPayment|null>(initialPayment);
  const permissions = adminData?.admin?.permissions || [];
  const canViewCustomers = permissions.includes('view_customers') || permissions.includes('manage_customers') || permissions.includes('manage_admins');
  const canViewPickup = canViewCustomers || permissions.includes('verify_payments') || permissions.includes('approve_production');

  const navigate = (key: string) => {
    if (key === 'quick-order' || key === 'manual-order') key = 'create-order';
    setLinkedPayment(null);
    const url = new URL(window.location.href);
    if (key !== 'orders') url.searchParams.delete('order');
    if (key !== 'customers' && key !== 'pickup-counter') url.searchParams.delete('customer');
    if (key === 'customers') url.searchParams.set('view','customers');
    else if (key === 'pickup-counter') url.searchParams.set('view','pickup-counter');
    else if (key === 'qrpay-summary') url.searchParams.set('view','qrpay-summary');
    else if (key === 'draft-orders') url.searchParams.set('view','draft-orders');
    else if (key === 'ai-learning') url.searchParams.set('view','ai-learning');
    else if (key === 'create-order') url.searchParams.set('view','create-order');
    else { url.searchParams.delete('view'); url.searchParams.delete('date'); }
    ['qrpay_tx','qrpay_amount','qrpay_phone','qrpay_name','qrpay_paid_at'].forEach((param)=>url.searchParams.delete(param));
    window.history.replaceState({}, '', url);
    setPage(key); setMobileOpen(false);
  };
  const createOrderFromQrPay=(payment:QrPayCreatePayload)=>{
    setLinkedPayment(payment);
    const url=new URL(window.location.href);
    url.searchParams.set('admin','v2');url.searchParams.set('view','create-order');
    url.searchParams.set('qrpay_tx',payment.transactionId);url.searchParams.set('qrpay_amount',String(payment.amount));
    url.searchParams.set('qrpay_phone',payment.phone);url.searchParams.set('qrpay_name',payment.customerName);
    url.searchParams.set('qrpay_paid_at',payment.paidAt);
    url.searchParams.delete('date');url.searchParams.delete('order');url.searchParams.delete('customer');
    window.history.replaceState({},'',url);
    setPage('create-order');setMobileOpen(false);
  };
  const openOrder = (orderNo: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('admin','v2');
    url.searchParams.set('order',orderNo);
    url.searchParams.delete('view');
    url.searchParams.delete('date');
    url.searchParams.delete('customer');
    ['qrpay_tx','qrpay_amount','qrpay_phone','qrpay_name','qrpay_paid_at'].forEach((param)=>url.searchParams.delete(param));
    window.history.replaceState({},'',url);
    setPage('orders');
  };
  const openPickup = (customerId?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('admin','v2');
    url.searchParams.set('view','pickup-counter');
    if (customerId) url.searchParams.set('customer',customerId);
    else url.searchParams.delete('customer');
    url.searchParams.delete('order'); url.searchParams.delete('date');
    window.history.replaceState({},'',url);
    setPage('pickup-counter'); setMobileOpen(false);
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
      case 'dashboard': return <Dashboard adminOrders={adminData?.orders} onQuickOrder={() => navigate('create-order')} onOpenOrder={openOrder} />;
      case 'orders': return <Orders permissions={permissions} initialOrder={linkedOrder} />;
      case 'customers': return canViewCustomers ? <Customers permissions={permissions} initialCustomer={linkedCustomer} onOpenOrder={openOrder} onOpenPickup={openPickup} /> : <Dashboard adminOrders={adminData?.orders} onQuickOrder={() => navigate('create-order')} onOpenOrder={openOrder} />;
      case 'pickup-counter': return canViewPickup ? <Suspense fallback={<div style={{padding:24}}>Loading Pickup Counter...</div>}><PickupCounter permissions={permissions} initialCustomer={linkedCustomer} onOpenOrder={openOrder}/></Suspense> : <Dashboard adminOrders={adminData?.orders} onQuickOrder={() => navigate('create-order')} onOpenOrder={openOrder} />;
      case 'create-order': return <Suspense fallback={<div style={{padding:24}}>Loading Create Order...</div>}><CreateOrder key={linkedPayment?.transactionId||'new-order'} permissions={permissions} onOpenOrder={openOrder} onOpenDrafts={()=>navigate('draft-orders')} linkedPayment={linkedPayment} /></Suspense>;
      case 'payments': return <Payments onOpenOrder={openOrder} canManage={permissions.includes('verify_payments')} />;
      case 'finance': return permissions.includes('view_finance') ? <Finance canManage={permissions.includes('manage_finance')} onOpenOrder={openOrder} /> : <Dashboard adminOrders={adminData?.orders} onQuickOrder={() => navigate('create-order')} onOpenOrder={openOrder} />;
      case 'draft-orders': return permissions.includes('view_finance') ? <DraftOrders canManage={permissions.includes('manage_finance')} onOpenOrder={openOrder} onCreateOrder={()=>navigate('create-order')} /> : <Dashboard adminOrders={adminData?.orders} onQuickOrder={() => navigate('create-order')} onOpenOrder={openOrder} />;
      case 'qrpay-summary': return permissions.includes('view_finance') ? <QrPayDailySummary canManage={permissions.includes('manage_finance')} onCreateOrder={permissions.includes('create_order')&&permissions.includes('verify_payments')?createOrderFromQrPay:undefined} onOpenOrder={openOrder} /> : <Dashboard adminOrders={adminData?.orders} onQuickOrder={() => navigate('create-order')} onOpenOrder={openOrder} />;
      case 'shipping': return <Shipping />;
      case 'clickup-queue': return <ClickUpQueue permissions={permissions} onOpenOrder={openOrder} />;
      case 'whatsapp-control': return <WhatsAppControl />;
      case 'whatsapp-templates': return <WhatsAppTemplates />;
      case 'whatsapp-outbox': return <WhatsAppOutbox />;
      case 'integrations': return <Integrations />;
      case 'staff': return <StaffRoles currentPermissions={permissions} />;
      case 'settings': return <Settings permissions={permissions} onOpenAiLearning={() => navigate('ai-learning')} />;
      case 'ai-learning': return permissions.includes('view_finance') || permissions.includes('manage_admins')
        ? <Suspense fallback={<div style={{ padding: 24 }}>Loading AI Learning...</div>}><AiLearningSettings /></Suspense>
        : <Dashboard adminOrders={adminData?.orders} onQuickOrder={() => navigate('create-order')} onOpenOrder={openOrder} />;
      default: return <Dashboard adminOrders={adminData?.orders} onQuickOrder={() => navigate('create-order')} onOpenOrder={openOrder} />;
    }
  };

  return <div className="app-layout"><Sidebar active={page} onNavigate={navigate} mobileOpen={mobileOpen} onCloseMobile={()=>setMobileOpen(false)} onLogout={()=>void logout()} canViewFinance={permissions.includes('view_finance')} canViewCustomers={canViewCustomers} canViewPickup={canViewPickup} /><div className="main-content"><Topbar title={info.title} subtitle={info.subtitle} onOpenMobile={()=>setMobileOpen(true)} /><div className="content-area">{renderPage()}</div></div></div>;
}
