import { IconMenu, IconRefresh, IconBell } from './Icons';

type Props = {
  title: string;
  crumb: string;
  onOpenMobile: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
};

export default function Topbar({ title, crumb, onOpenMobile, onRefresh, refreshing }: Props) {
  return (
    <header className="topbar">
      <button className="topbar-icon-btn" onClick={onOpenMobile} style={{ display: 'none' }} id="mobile-menu-btn">
        <IconMenu size={20} />
      </button>

      <div style={{ minWidth: 0 }}>
        <div className="topbar-title">{title}</div>
        <div className="topbar-crumb">{crumb}</div>
      </div>

      <span className="topbar-live">Live</span>

      <div className="topbar-actions">
        {onRefresh && (
          <button className="topbar-icon-btn" onClick={onRefresh} disabled={refreshing} title="Refresh">
            <IconRefresh size={16} style={{ animation: refreshing ? 'spin 0.7s linear infinite' : undefined }} />
          </button>
        )}
        <button className="topbar-icon-btn" title="Notifications">
          <IconBell size={18} />
        </button>
        <div className="topbar-avatar" title="Admin User">AD</div>
      </div>
    </header>
  );
}
