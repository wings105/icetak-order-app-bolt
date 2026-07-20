import { IconSearch, IconBell, IconMenu } from './Icons';

type Props = {
  onToggleSidebar: () => void;
  onOpenMobile: () => void;
  title: string;
};

export default function Topbar({ onToggleSidebar, onOpenMobile, title }: Props) {
  return (
    <header className="topbar">
      <button className="topbar-toggle" onClick={onOpenMobile} style={{ display: 'none' }} id="mobile-menu-btn">
        <IconMenu size={22} />
      </button>
      <button className="topbar-toggle" onClick={onToggleSidebar} id="desktop-toggle">
        <IconMenu size={22} />
      </button>

      <div className="topbar-search">
        <span className="topbar-search-icon"><IconSearch size={18} /></span>
        <input placeholder={`Search ${title.toLowerCase()}...`} />
      </div>

      <div className="topbar-actions">
        <button className="topbar-icon-btn" title="Notifications">
          <IconBell size={20} />
          <span className="dot" />
        </button>
        <div className="topbar-avatar" title="Admin User">AD</div>
      </div>
    </header>
  );
}
