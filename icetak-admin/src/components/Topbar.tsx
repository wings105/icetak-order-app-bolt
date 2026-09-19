import { IconBell, IconRefresh, IconMenu } from './Icons';
import GlobalSearch from './GlobalSearch';

type Props = {
  title: string;
  subtitle?: string;
  onOpenMobile: () => void;
  onRefresh?: () => void;
  onOpenInternalOrder?: (orderNo: string) => void;
  onOpenMarketplace?: (query: string) => void;
};

export default function Topbar({ title, subtitle, onOpenMobile, onRefresh, onOpenInternalOrder, onOpenMarketplace }: Props) {
  return <header className="topbar">
    <button className="topbar-mobile-btn" onClick={onOpenMobile}><IconMenu size={20} /></button>
    <div className="topbar-left"><h1 className="topbar-title">{title}</h1>{subtitle && <span className="topbar-subtitle">{subtitle}</span>}</div>
    <div className="topbar-right">
      {onOpenInternalOrder && onOpenMarketplace && <GlobalSearch onOpenInternalOrder={onOpenInternalOrder} onOpenMarketplace={onOpenMarketplace} />}
      {onRefresh && <button className="topbar-btn" onClick={onRefresh} title="Refresh"><IconRefresh size={16} /></button>}
      <button className="topbar-btn" title="Notifications"><IconBell size={18} /><span className="topbar-dot" /></button>
      <div className="topbar-avatar">AD</div>
    </div>
  </header>;
}
