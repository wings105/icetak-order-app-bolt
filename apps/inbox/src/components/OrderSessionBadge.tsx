import { Clock3, LockKeyhole } from 'lucide-react';
import type { OrderSessionSnapshot } from '../types';

function localTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(date);
}

export function OrderSessionBadge({
  session,
  compact = false,
}: {
  session?: OrderSessionSnapshot;
  compact?: boolean;
}) {
  if (!session || session.state === 'none') return null;

  const closed = session.state === 'closed';
  const Icon = closed ? LockKeyhole : Clock3;
  const label = closed ? 'Session Closed' : 'Session Active';
  const date = localTime(closed ? session.closed_at : session.opened_at);
  const details = closed
    ? [session.order_no ? `Order ${session.order_no} disahkan` : 'Sesi order telah ditutup', date, 'AI tidak membaca chat sebelum sesi ini'].filter(Boolean).join(' · ')
    : ['AI membaca sesi order semasa', date ? `Dibuka ${date}` : null].filter(Boolean).join(' · ');
  const color = closed
    ? 'bg-slate-200 text-slate-700 dark:bg-slate-700/70 dark:text-slate-200'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/45 dark:text-emerald-300';

  return (
    <span
      title={details}
      aria-label={`${label}${session.order_no ? ` ${session.order_no}` : ''}`}
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-tight ${color}`}
    >
      <Icon size={10} strokeWidth={2.1} className="shrink-0" />
      <span className="truncate">{compact ? (closed ? 'Closed' : 'Active') : label}</span>
      {!compact && closed && session.order_no && (
        <span className="truncate opacity-80">· {session.order_no}</span>
      )}
    </span>
  );
}

