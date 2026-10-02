import { WindowStatus } from '../types';
import { getWindowStatus, getWindowRemaining } from '../utils/timeUtils';
import { Clock, AlertCircle, XCircle, MinusCircle } from 'lucide-react';

interface WindowBadgeProps {
  lastInboundAt: Date | undefined;
  compact?: boolean;
}

const statusConfig: Record<WindowStatus, {
  label: string;
  bg: string;
  text: string;
  icon: React.ElementType;
}> = {
  open: {
    label: 'Terbuka',
    bg: 'bg-emerald-100 dark:bg-emerald-900/40',
    text: 'text-emerald-700 dark:text-emerald-400',
    icon: Clock,
  },
  closing_soon: {
    label: 'Hampir Tutup',
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    text: 'text-amber-700 dark:text-amber-400',
    icon: AlertCircle,
  },
  expired: {
    label: 'Tamat',
    bg: 'bg-red-100 dark:bg-red-900/40',
    text: 'text-red-700 dark:text-red-400',
    icon: XCircle,
  },
  no_window: {
    label: 'Tiada Tetingkap',
    bg: 'bg-gray-100 dark:bg-gray-700',
    text: 'text-gray-500 dark:text-gray-400',
    icon: MinusCircle,
  },
};

export function WindowBadge({ lastInboundAt, compact = false }: WindowBadgeProps) {
  const status = getWindowStatus(lastInboundAt);
  const remaining = getWindowRemaining(lastInboundAt);
  const cfg = statusConfig[status];
  const Icon = cfg.icon;

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.bg} ${cfg.text}`}>
        <Icon size={10} strokeWidth={2.5} />
        {status !== 'no_window' && status !== 'expired' && remaining}
      </span>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <Icon size={12} strokeWidth={2.5} />
      <span>
        {status === 'open' && `Tetingkap Terbuka · ${remaining}`}
        {status === 'closing_soon' && `Hampir Tutup · ${remaining}`}
        {status === 'expired' && 'Tetingkap Tamat'}
        {status === 'no_window' && 'Tiada Mesej Masuk'}
      </span>
    </div>
  );
}

