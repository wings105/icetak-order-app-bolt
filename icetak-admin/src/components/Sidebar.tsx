import { useState, useEffect } from 'react';
import {
  IconTower, IconPayments, IconShipping, IconWhatsApp, IconIntegration,
  IconStaff, IconSettings, IconChevronRight, IconMessage, IconLogout,
} from './Icons';

type NavItem = {
  key: string;
  label: string;
  icon: React.FC<{ size?: number }>;
  badge?: string | number;
  badgeType?: 'default' | 'warn';
  children?: { key: string; label: string }[];
};

const sections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Main',
    items: [
      { key: 'dashboard', label: 'Order Control Tower', icon: IconTower },
    ],
  },
  {
    title: 'Operations',
    items: [
      { key: 'payments', label: 'Payments Center', icon: IconPayments },
      { key: 'shipping', label: 'Shipping & Delivery', icon: IconShipping },
      {
        key: 'whatsapp',
        label: 'WhatsApp Templates',
        icon: IconWhatsApp,
        children: [
          { key: 'whatsapp-control', label: 'WhatsApp Control' },
          { key: 'whatsapp-templates', label: 'Templates' },
          { key: 'whatsapp-outbox', label: 'Outbox' },
        ],
      },
    ],
  },
  {
    title: 'Control',
    items: [
      { key: 'integrations', label: 'Integrations', icon: IconIntegration },
      { key: 'staff', label: 'Staff & Roles', icon: IconStaff },
      { key: 'settings', label: 'Settings', icon: IconSettings },
    ],
  },
];

type Props = {
  active: string;
  onNavigate: (key: string) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

export default function Sidebar({ active, onNavigate, mobileOpen, onCloseMobile }: Props) {
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    for (const sec of sections) {
      for (const it of sec.items) {
        if (it.children?.some((c) => c.key === active)) {
          setOpenMenus((prev) => ({ ...prev, [it.key]: true }));
        }
      }
    }
  }, [active]);

  const toggle = (key: string) => setOpenMenus((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <>
      <div className={`mobile-overlay ${mobileOpen ? 'open' : ''}`} onClick={onCloseMobile} />
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-logo">iC</div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-title">iCetak ERP</div>
            <div className="sidebar-brand-sub">Automation OS</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {sections.map((sec) => (
            <div key={sec.title}>
              <div className="nav-section">{sec.title}</div>
              {sec.items.map((item) => {
                const Icon = item.icon;
                const hasChildren = !!item.children?.length;
                const childActive = item.children?.some((c) => c.key === active) ?? false;
                const isActive = !hasChildren && active === item.key;
                const isOpen = openMenus[item.key] || childActive;

                return (
                  <div key={item.key}>
                    <div
                      className={`nav-item ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        if (hasChildren) toggle(item.key);
                        else onNavigate(item.key);
                      }}
                    >
                      <span className="nav-icon"><Icon size={18} /></span>
                      <span className="nav-label">{item.label}</span>
                      {item.badge != null && (
                        <span className={`nav-badge ${item.badgeType === 'warn' ? 'warn' : ''}`}>{item.badge}</span>
                      )}
                      {hasChildren && (
                        <span className={`nav-chev ${isOpen ? 'open' : ''}`}>
                          <IconChevronRight size={14} />
                        </span>
                      )}
                    </div>
                    {hasChildren && (
                      <div className={`nav-submenu ${isOpen ? 'open' : ''}`}>
                        {item.children!.map((c) => (
                          <div
                            key={c.key}
                            className={`nav-subitem ${active === c.key ? 'active' : ''}`}
                            onClick={() => onNavigate(c.key)}
                          >
                            <IconMessage size={12} />
                            <span>{c.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-avatar">AD</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name">Admin User</div>
            <div className="sidebar-user-role">Administrator</div>
          </div>
          <button className="topbar-icon-btn" style={{ background: 'transparent', color: 'var(--text-sidebar)' }} title="Logout">
            <IconLogout size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}
