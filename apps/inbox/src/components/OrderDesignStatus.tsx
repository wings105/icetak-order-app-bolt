import { getDesignWork } from '../../../../supabase/functions/_shared/inbox-design-work.ts';

export function OrderDesignStatus({ metadata }: { metadata?: Record<string, unknown> | null }) {
  const work = getDesignWork(metadata);
  const statuses = [...new Set(work?.tasks.map(task => task.status).filter(Boolean) ?? [])];
  const detail = statuses.join(' · ');
  const label = work?.counts.needs_design ? `${work.counts.needs_design} task belum design`
    : work?.stage === 'done' ? 'Printing / siap'
    : work?.stage === 'review' ? 'Tunggu review' : 'Status task perlu semakan';
  return <p className="mt-1 truncate text-[10px] text-[var(--text-secondary)]" title={`Status ClickUp terakhir: ${detail || 'Belum dipadankan'}`}>
    <span className={work?.stage === 'needs_design' ? 'font-semibold text-orange-700 dark:text-orange-300' : ''}>{label}</span>
    {detail ? ` · ${detail}` : ''}
  </p>;
}
