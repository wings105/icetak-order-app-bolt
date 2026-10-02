import { ConversationStatus } from '../types';

const STATUS_STYLES: Record<ConversationStatus, string> = {
  'Menunggu Balasan': 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400',
  'Design Belum Siap': 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-400',
  'Menunggu Approval': 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400',
  'Approved': 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400',
  'Perlu Edit': 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
  'Dah Bayar': 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400',
  'Perlu Pos Hari Ini': 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400',
  'Selesai': 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  'Gagal': 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
};

interface StatusBadgeProps {
  status: ConversationStatus;
  size?: 'sm' | 'xs';
}

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const base = STATUS_STYLES[status];
  const sizeClass = size === 'xs'
    ? 'text-[10px] px-1.5 py-0.5'
    : 'text-xs px-2 py-0.5';

  return (
    <span className={`inline-block rounded font-medium leading-tight ${base} ${sizeClass}`}>
      {status}
    </span>
  );
}

