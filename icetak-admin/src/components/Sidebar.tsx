import { useState } from 'react';
import {
  IconDashboard, IconOrders, IconPayments, IconShipping, IconProducts,
  IconCustomers, IconReports, IconSettings, IconChevronLeft, IconChevronRight,
  IconLogout,
} from './Icons';

type NavItem = {
  key: string;
  label: string;
  icon: React.FC<{ size?: number }>;
  badge?: string;
  badgeType?: 'primary' | 'warn';
};

const sections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Main',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: IconDashboard },
      { key: 'orders', label: 'Orders', icon: IconOrders, badge: '12', badgeType: 'primary' },
      { key: 'payments', label: 'Payments', icon: IconPayments },
      { key: 'shipping', label: 'Shipping', icon: IconShipping, badge: '3', badgeType: 'warn' },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { key: 'products', label: 'Products', icon: IconProducts },
      { key: 'customers', label: 'Customers', icon: IconCustomers },
    ],
  },
  {
    title: 'Insights',
    items: [
      { key: 'reports', label: 'Reports', icon: IconReports },
      { key: 'settings', label: 'Settings', icon: IconSettings },
    ],
  },
];

type Props = {
  active: string;
  onNavigate: (key: string) => void;
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

export default function Sidebar({ active, onNavigate, collapsed, onToggle, mobileOpen, onCloseMobile }: Props) {
  const [hovered, setHovered] = useState(false);

  return (
    <>
      {mobileOpen && <div className="mobile-overlay" onClick={onCloseMobile} />}
      <aside
        className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">iC</div>
          {(!collapsed || hovered) && <span className="sidebar-logo-text">iCetak Admin</span>}
        </div>

        <nav className="sidebar-nav">
          {sections.map((sec) => (
            <div key={sec.title}>
              {(!collapsed || hovered) && <div className="nav-section-title">{sec.title}</div>}
              {sec.items.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.key;
                return (
                  <div
                    key={item.key}
                    className={`nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => onNavigate(item.key)}
                    title={collapsed && !hovered ? item.label : undefined}
                  >
                    <span className="nav-icon"><Icon size={20} /></span>
                    {(!collapsed || hovered) && <span className="nav-label">{item.label}</span>}
                    {(!collapsed || hovered) && item.badge && (
                      <span className={`nav-badge ${item.badgeType === 'warn' ? 'warn' : ''}`}>{item.badge}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-avatar">AD</div>
          {(!collapsed || hovered) && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sidebar-user-name">Admin User</div>
              <div className="sidebar-user-role">Administrator</div>
            </div>
          )}
          {(!collapsed || hovered) && (
            <button className="topbar-icon-btn" style={{ color: 'var(--sidebar-text)' }} title="Logout">
              <IconLogout size={18} />
            </button>
          )}
        </div>

        <button
          onClick={onToggle}
          style={{
            position: 'absolute',
            right: -12,
            top: 76,
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: '#fff',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)',
            boxShadow: 'var(--shadow)',
            zIndex: 10,
          }}
        >
          {collapsed ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
        </button>
      </aside>
    </>
  );
}
