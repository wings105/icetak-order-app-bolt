import { useState } from 'react';
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
  {
    key: 'create-orders', label: 'Create Order', icon: IconOrders,
    children: [
      { key: 'quick-order', label: 'Quick Order' },
      { key: 'manual-order', label: 'Manual Order' },
    ],
  },
  { key: 'payments', label: 'Payments', icon: IconPayments },
  { key: 'finance', label: 'Finance', icon: IconFinance },
  { key: 'shipping', label: 'Shipping', icon: IconShipping },
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
};

export default function Sidebar({ active, onNavigate, mobileOpen, onCloseMobile, onLogout, canViewFinance = false }: Props) {
  const visibleNavItems = canViewFinance ? navItems : navItems.filter((item) => item.key !== 'finance');
  const [expanded, setExpanded] = useState<string | null>(
    visibleNavItems.find((n) => n.children?.some((c) => c.key === active))?.key ?? null
  );

  const handleClick = (item: NavItem) => {
    if (item.children) setExpanded(expanded === item.key ? null : item.key);
    else onNavigate(item.key);
  };

  const isActive = (item: NavItem) => item.children ? item.children.some((c) => c.key === active) : item.key === active;

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
            <button className={`sidebar-item ${active_ && !item.children ? 'active' : ''}`} onClick={() => handleClick(item)}>
              <span className="sidebar-item-icon"><Icon size={18} /></span><span className="sidebar-item-label">{item.label}</span>
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
