// A new canonical read may observe task deletion/remapping without an order timestamp change.
export function isOlderOrderSummary(existing: Record<string, any> | null, incoming: Record<string, any>) {
  if (existing?.metadata?.source !== 'canonical_order_sync') return false;
  const nextObserved = Date.parse(incoming.metadata?.source_observed_at ?? '');
  const previousObserved = Date.parse(existing.metadata?.source_observed_at ?? existing.last_synced_at ?? '');
  if (Number.isFinite(nextObserved) && Number.isFinite(previousObserved)) return previousObserved > nextObserved;
  const previous = Date.parse(existing.order_updated_at ?? '');
  const next = Date.parse(incoming.order_updated_at ?? '');
  return Number.isFinite(previous) && Number.isFinite(next) && previous > next;
}
