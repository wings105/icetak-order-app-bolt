import type { DesignFilter } from '../../../../supabase/functions/_shared/inbox-design-work.ts';

export const DESIGN_FILTERS: ReadonlyArray<readonly [DesignFilter, string]> = [
  ['needs_design', 'Belum Design'], ['done', 'Printing / Siap'], ['review', 'Tunggu Review'],
  ['unknown', 'Perlu Semakan'], ['all', 'Semua Status ClickUp'],
];

export function OrderDesignFilter({ value, counts, onChange }: {
  value: DesignFilter;
  counts?: Partial<Record<DesignFilter, number>>;
  onChange: (value: DesignFilter) => void;
}) {
  return <label className="flex min-w-0 items-center gap-2 text-xs text-[var(--text-secondary)]">
    <span className="shrink-0">Design</span>
    <select aria-label="Status kerja design" value={value} onChange={(event) => onChange(event.target.value as DesignFilter)}
      className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-2 text-xs text-[var(--text)] outline-none focus:border-orange-500">
      {DESIGN_FILTERS.map(([key, label]) => <option key={key} value={key}>{label}{counts?.[key] !== undefined ? ` (${counts[key]})` : ''}</option>)}
    </select>
  </label>;
}
