import type { DueFilter } from '../../../../supabase/functions/_shared/inbox-order-deadline.ts';
export const DUE_FILTERS: ReadonlyArray<readonly [DueFilter, string]> = [
  ['urgent', 'Segera · Lewat hingga Esok'], ['overdue', 'Lewat'], ['today', 'Hari Ini'],
  ['tomorrow', 'Esok'], ['upcoming', 'Akan Datang'], ['undated', 'Tiada Tarikh'], ['all', 'Semua Tarikh'],
];
export function OrderDueFilter({ value, counts, onChange }: {
  value: DueFilter; counts?: Partial<Record<DueFilter, number>>; onChange: (value: DueFilter) => void;
}) {
  return <div>
    <label className="flex min-w-0 items-center gap-2 text-xs text-[var(--text-secondary)]">
      <span className="shrink-0">Deadline</span>
      <select aria-label="Tarikh perlu dibuat" value={value} onChange={(e) => onChange(e.target.value as DueFilter)}
        className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-2 text-xs text-[var(--text)] outline-none focus:border-orange-500">
        {DUE_FILTERS.map(([key, label]) => <option key={key} value={key}>{label}{counts?.[key] !== undefined ? ` (${counts[key]})` : ''}</option>)}
      </select>
    </label>
    <p className="mt-1 text-[10px] leading-4 text-[var(--text-secondary)]">Waktu Malaysia · Shopee: ship-by · Decocake: tarikh perlu</p>
    {value !== 'undated' && (counts?.undated ?? 0) > 0 && <button onClick={() => onChange('undated')} className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">{counts?.undated} order tiada tarikh · semak</button>}
  </div>;
}
