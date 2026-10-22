/** Calendar focus uses canonical fulfillment deadlines, never order-created dates or ClickUp rescheduling. */
export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'undated';
export type DueFilter = 'urgent' | 'all' | DueBucket;
export interface OrderDeadline { bucket: DueBucket; date: string | null; source: 'ship_by' | 'date_need' | null; sort_at: string | null }
interface DeadlineOrder { source_channel?: string; ship_by_at?: string | null; date_need?: string | null }
const dayMs = 86400000;
function localDay(now: number) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
function validDay(value: string) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) && value >= '2020-01-01' && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
export function orderDeadline(order: DeadlineOrder, now = Date.now()): OrderDeadline {
  const empty: OrderDeadline = { bucket: 'undated', date: null, source: null, sort_at: null };
  const shopee = order.source_channel === 'shopee';
  const raw = shopee ? order.ship_by_at : order.date_need;
  if (!raw) return empty;
  let date: string, time: number;
  if (shopee) {
    if (!/^20\d{2}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !validDay(raw.slice(0, 10))) return empty;
    time = Date.parse(raw);
    if (!Number.isFinite(time)) return empty;
    date = localDay(time);
  } else {
    if (!validDay(raw)) return empty;
    date = raw;
    time = Date.parse(date + 'T00:00:00+08:00');
  }
  const today = localDay(now), tomorrow = localDay(now + dayMs);
  const bucket: DueBucket = (shopee ? time < now : date < today) ? 'overdue' : date === today ? 'today' : date === tomorrow ? 'tomorrow' : 'upcoming';
  return { bucket, date, source: shopee ? 'ship_by' : 'date_need', sort_at: new Date(time).toISOString() };
}
export function matchesDueFilter(order: DeadlineOrder, filter: DueFilter, now = Date.now()) {
  if (filter === 'all') return true;
  const bucket = orderDeadline(order, now).bucket;
  return filter === 'urgent' ? ['overdue', 'today', 'tomorrow'].includes(bucket) : bucket === filter;
}
