import { orderDeadline } from '../../../../supabase/functions/_shared/inbox-order-deadline.ts';
import type { ExternalOrderSummary } from '../lib/externalOrderSummaries';
const labels = { overdue: 'Lewat', today: 'Hari Ini', tomorrow: 'Esok', upcoming: 'Akan Datang', undated: 'Tiada Tarikh' };
export function OrderDeadlineStatus({ order, now }: { order: ExternalOrderSummary; now: number }) {
  const due = orderDeadline(order, now);
  const urgent = ['overdue', 'today', 'tomorrow'].includes(due.bucket);
  const date = due.date ? new Intl.DateTimeFormat('ms-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', ...(due.source === 'ship_by' ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(due.sort_at!)) : '';
  return <p className={`mt-1.5 text-[10px] leading-4 ${due.bucket === 'overdue' ? 'text-red-700 dark:text-red-300' : urgent ? 'text-amber-700 dark:text-amber-300' : 'text-[var(--text-secondary)]'}`}>
    <span className="font-semibold">{labels[due.bucket]}</span>{date && ` · ${date} · ${due.source === 'ship_by' ? 'Ship-by' : 'Tarikh perlu'}`}
  </p>;
}
