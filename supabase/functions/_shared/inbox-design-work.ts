export type DesignStage = 'needs_design' | 'review' | 'done' | 'unknown';
export type DesignFilter = 'all' | DesignStage;
export interface DesignTask {
  id: string;
  status: string;
  review_status: string | null;
  stage: DesignStage;
  url: string | null;
  updated_at: string | null;
  observed_at: string | null;
}
export interface DesignWork {
  version: 1;
  stage: DesignStage;
  counts: Record<DesignStage, number>;
  tasks: DesignTask[];
}

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export function designTaskStage(status: unknown, reviewStatus?: unknown): DesignStage {
  const value = clean(status).toLowerCase().replace(/\s+/g, ' ');
  // Printing/completion wins over stale review flags; it is already past design.
  if (/printing/.test(value) || ['print alamat', 'ready stock', 'edible print ready stock', 'complete', 'completed', 'done', 'closed', 'cancelled', 'canceled', 'archived'].includes(value)) return 'done';
  if (/^(new custom|design editing\s*-\s*topper|design edible image|acrylic|wafer paper)$/.test(value)) return 'needs_design';
  if (value === 'review') {
    const review = clean(reviewStatus).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    return /^(edit requested|request edit|edit|rejected|reject|changes requested|revision requested|minta edit|ubah design)$/.test(review) ? 'needs_design' : 'review';
  }
  return 'unknown';
}

export function summarizeDesignWork(input: unknown): DesignWork {
  const counts: Record<DesignStage, number> = { needs_design: 0, review: 0, done: 0, unknown: 0 };
  const unique = new Map<string, DesignTask>();
  for (const value of Array.isArray(input) ? input : []) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const id = clean(row.id);
    if (!id) continue;
    const task: DesignTask = {
      id, status: clean(row.status), review_status: clean(row.review_status) || null,
      stage: designTaskStage(row.status, row.review_status),
      url: /^https:\/\/app\.clickup\.com\/t\//.test(clean(row.url)) ? clean(row.url) : null,
      updated_at: clean(row.source_updated_at) || null, observed_at: clean(row.observed_at) || null,
    };
    const prior = unique.get(id);
    if (!prior || (task.updated_at ?? task.observed_at ?? '') >= (prior.updated_at ?? prior.observed_at ?? '')) unique.set(id, task);
  }
  const tasks = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const task of tasks) counts[task.stage]++;
  const stage = counts.needs_design ? 'needs_design' : !tasks.length || counts.unknown ? 'unknown' : counts.review ? 'review' : 'done';
  return { version: 1, stage, counts, tasks };
}

export function getDesignWork(metadata?: Record<string, unknown> | null): DesignWork | null {
  const work = metadata?.design_work as DesignWork | undefined;
  return work?.version === 1 && Array.isArray(work.tasks) && ['needs_design', 'review', 'done', 'unknown'].includes(work.stage) ? work : null;
}
export function orderDesignStage(order: { metadata?: Record<string, unknown> | null }): DesignStage {
  return getDesignWork(order.metadata)?.stage ?? 'unknown';
}
export function matchesDesignFilter(order: Parameters<typeof orderDesignStage>[0], filter: DesignFilter): boolean {
  return filter === 'all' || orderDesignStage(order) === filter;
}
