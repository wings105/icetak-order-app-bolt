import { ORDER_CATEGORIES, type OrderCategoryCounts, type OrderCategoryFilter as Category } from '../lib/orderCategories';

export function OrderCategoryFilter({ value, counts, onChange }: {
  value: Category;
  counts?: OrderCategoryCounts;
  onChange: (value: Category) => void;
}) {
  return <label className="flex min-w-0 items-center gap-2 text-xs text-[var(--text-secondary)]">
    <span className="shrink-0">Kategori</span>
    <select aria-label="Kategori produk" value={value} onChange={(event) => onChange(event.target.value as Category)}
      className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-2 text-xs text-[var(--text)] outline-none focus:border-orange-500">
      {([['all', 'Semua Kategori'], ...ORDER_CATEGORIES] as const).map(([key, label]) => <option key={key} value={key}>
        {label}{counts?.[key] !== undefined ? ` (${counts[key]})` : ''}
      </option>)}
    </select>
  </label>;
}
