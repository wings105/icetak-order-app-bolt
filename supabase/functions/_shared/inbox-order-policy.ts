// Pure policy shared by every canonical marketplace sync entrypoint.
export function marketplaceWorkPriority(order: Record<string, unknown>, shippedAt: string | null = null, now = Date.now()) {
  const status = String(order.current_status ?? '').trim().toUpperCase();
  const metadata = order.metadata && typeof order.metadata === 'object' ? order.metadata as Record<string, unknown> : {};
  const fulfillment = String(order.fulfillment_status ?? '').toUpperCase();
  if (metadata.dashboard_excluded === true || metadata.dashboard_excluded === 'true'
      || !['READY_TO_SHIP', 'PROCESSED'].includes(status)
      || String(order.payment_status ?? '').toLowerCase() !== 'paid'
      || shippedAt || /PICKUP_DONE|DELIVERY_DONE|IN_TRANSIT|OUT_FOR_DELIVERY|DELIVERED|SHIPPED/.test(fulfillment)) {
    return { active: false, level: 'P9', reason: 'Bukan order To Ship aktif' };
  }
  const shipBy = order.ship_by_at ? new Date(String(order.ship_by_at)) : null;
  if (shipBy && !Number.isNaN(shipBy.getTime()) && shipBy.getUTCFullYear() >= 2020) {
    const hours = (shipBy.getTime() - now) / 3600000;
    if (hours < 0) return { active: true, level: 'P0', reason: 'Ship-by overdue' };
    if (hours <= 24) return { active: true, level: 'P1', reason: 'Ship-by within 24 hours' };
    if (hours <= 48) return { active: true, level: 'P2', reason: 'Ship-by within 48 hours' };
  }
  return { active: true, level: 'P4', reason: 'Order belum ship' };
}
