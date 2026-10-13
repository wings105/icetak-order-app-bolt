const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_MS = 6 * 60 * 60 * 1000;
type Cursor = Record<string, any>;

export function prepareReleaseCursor(cursor: Cursor, now: number): Cursor {
  const next = { ...cursor };
  // Extend a short tail before reading it. Changing its end after every read
  // otherwise makes catch-up chase a moving target at each cron invocation.
  // Later pages must keep the exact range used by their first page.
  if (Number(next.page) === 1) {
    next.to_at = new Date(Math.min(Date.parse(next.from_at) + WEEK_MS, now)).toISOString();
  }
  return next;
}

export function finishReleaseCursor(cursor: Cursor, response: Cursor, count: number, now: number): Cursor {
  const next: Cursor = { ...cursor, error: null };
  if (response.more || response.has_more || count === 100) {
    next.page = Number(cursor.page) + 1;
  } else if (Date.parse(cursor.to_at) < now) {
    next.from_at = cursor.to_at;
    next.to_at = new Date(Math.min(Date.parse(cursor.to_at) + WEEK_MS, now)).toISOString();
    next.page = 1;
    next.next_at = new Date(now).toISOString();
  } else {
    next.from_at = new Date(now - WEEK_MS).toISOString();
    next.to_at = new Date(now).toISOString();
    next.page = 1;
    next.next_at = new Date(now + POLL_MS).toISOString();
  }
  return next;
}
