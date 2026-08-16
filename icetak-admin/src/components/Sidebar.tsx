import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  IconDashboard, IconOrders, IconPayments, IconFinance, IconShipping, IconWhatsApp,
  IconIntegration, IconStaff, IconSettings, IconLogout,
} from './Icons';

type NavItem = {
  key: string;
  label: string;
  icon: React.FC<{ size?: number }>;
  children?: { key: string; label: string }[];
};

const navItems: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: IconDashboard },
  { key: 'orders', label: 'Orders', icon: IconOrders },
  { key: 'customers', label: 'Customers CRM', icon: IconStaff },
  {
    key: 'create-orders', label: 'Create Order', icon: IconOrders,
    children: [
      { key: 'quick-order', label: 'Quick Order' },
      { key: 'manual-order', label: 'Manual Order' },
    ],
  },
  { key: 'payments', label: 'Payments', icon: IconPayments },
  { key: 'finance', label: 'Finance', icon: IconFinance },
  { key: 'qrpay-summary', label: 'QRPay Daily', icon: IconPayments },
  { key: 'shipping', label: 'Shipping', icon: IconShipping },
  { key: 'clickup-queue', label: 'ClickUp Queue', icon: IconIntegration },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: IconWhatsApp,
    children: [
      { key: 'whatsapp-control', label: 'Control Center' },
      { key: 'whatsapp-templates', label: 'Templates' },
      { key: 'whatsapp-outbox', label: 'Outbox' },
    ],
  },
  { key: 'integrations', label: 'Integrations', icon: IconIntegration },
  { key: 'staff', label: 'Staff / Roles', icon: IconStaff },
  { key: 'settings', label: 'Settings', icon: IconSettings },
];

type Props = {
  active: string;
  onNavigate: (key: string) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onLogout?: () => void;
  canViewFinance?: boolean;
  canViewCustomers?: boolean;
};

type ShippingAttention = { attention?: number; critical?: number; oldest_hours?: number };

export default function Sidebar({ active, onNavigate, mobileOpen, onCloseMobile, onLogout, canViewFinance = false, canViewCustomers = false }: Props) {
  const visibleNavItems = navItems.filter((item) => {
    if (['finance','qrpay-summary'].includes(item.key) && !canViewFinance) return false;
    if (item.key === 'customers' && !canViewCustomers) return false;
    return true;
  });
  const [expanded, setExpanded] = useState<string | null>(
    visibleNavItems.find((n) => n.children?.some((c) => c.key === active))?.key ?? null
  );
  const [clickupAttention, setClickupAttention] = useState(0);
  const [shippingAttention, setShippingAttention] = useState<ShippingAttention>({ attention: 0, critical: 0, oldest_hours: 0 });

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [clickup, shipping] = await Promise.all([
        supabase.rpc('icetak_admin_clickup_queue_summary'),
        supabase.rpc('icetak_admin_shipping_attention_summary'),
      ]);
      if (!mounted) return;
      if (!clickup.error) setClickupAttention(Number((clickup.data as { attention?: number } | null)?.attention || 0));
      if (!shipping.error) setShippingAttention((shipping.data as ShippingAttention | null) || { attention: 0, critical: 0, oldest_hours: 0 });
    };
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  const handleClick = (item: NavItem) => {
    if (item.children) setExpanded(expanded === item.key ? null : item.key);
    else onNavigate(item.key);
  };

  const isActive = (item: NavItem) => item.children ? item.children.some((c) => c.key === active) : item.key === active;
  const stuckCount = Number(shippingAttention.attention || 0);
  const criticalCount = Number(shippingAttention.critical || 0);

  return <>
    {mobileOpen && <div className="sidebar-overlay" onClick={onCloseMobile} />}
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand"><div className="sidebar-brand-title">iCetak ERP</div><div className="sidebar-brand-sub">Automation OS</div></div>
      <nav className="sidebar-nav">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const active_ = isActive(item);
          const isOpen = expanded === item.key;
          return <div key={item.key}>
            <button
              className={`sidebar-item ${active_ && !item.children ? 'active' : ''}`}
              onClick={() => handleClick(item)}
              title={item.key === 'shipping' && stuckCount > 0 ? `${stuckCount} parcel tiada movement lebih 48 jam` : undefined}
            >
              <span className="sidebar-item-icon"><Icon size={18} /></span><span className="sidebar-item-label">{item.label}</span>
              {item.key === 'shipping' && stuckCount > 0 && <span style={{ marginLeft: 'auto', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: criticalCount > 0 ? '#dc2626' : '#f59e0b', color: '#fff', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: criticalCount > 0 ? '0 0 0 3px rgba(220,38,38,.13)' : '0 0 0 3px rgba(245,158,11,.13)' }}>{stuckCount > 99 ? '99+' : stuckCount}</span>}
              {item.key === 'clickup-queue' && clickupAttention > 0 && <span style={{ marginLeft: 'auto', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{clickupAttention > 99 ? '99+' : clickupAttention}</span>}
              {item.children && <svg className={`sidebar-chevron ${isOpen ? 'open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>}
            </button>
            {item.children && isOpen && <div className="sidebar-subnav">{item.children.map((child) => <button key={child.key} className={`sidebar-subitem ${active === child.key ? 'active' : ''}`} onClick={() => onNavigate(child.key)}>{child.label}</button>)}</div>}
          </div>;
        })}
      </nav>
      <div className="sidebar-footer"><button className="sidebar-item" style={{ opacity: 0.7 }} onClick={onLogout}><span className="sidebar-item-icon"><IconLogout size={16} /></span><span className="sidebar-item-label">Log Out</span></button></div>
    </aside>
  </>;
}
