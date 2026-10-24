export type PickupPaymentOrder = Record<string, unknown>;

const normalized = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

export const isPickupOrder = (order: PickupPaymentOrder | null) =>
  normalized(order?.delivery_method || order?.delivery).includes('pickup');

export function pickupPaymentStage(order: PickupPaymentOrder): 'collected' | 'ready' | 'pending' {
  const states = [order.status, order.admin_status, order.fulfillment_stage].map(normalized);
  // A completed handover takes precedence over the retained ready timestamp.
  if (order.pickup_collected_at || states.some((state) => ['customer collected', 'collected', 'completed', 'delivered'].includes(state))) return 'collected';
  if (order.pickup_ready_at || states.some((state) => ['ready for pickup', 'ready pickup'].includes(state))) return 'ready';
  return 'pending';
}

export function buildPickupPaymentMessage(orders: PickupPaymentOrder[], vars: Record<string, unknown>) {
  if (!orders.length) throw new Error('pickup_payment_orders_missing');
  const counts = { collected: 0, ready: 0, pending: 0 };
  for (const order of orders) counts[pickupPaymentStage(order)]++;

  let statusText: string;
  if (counts.collected === orders.length) {
    statusText = orders.length === 1 ? 'Order ini telah diambil.' : 'Semua order ini telah diambil.';
  } else if (counts.ready === orders.length) {
    statusText = orders.length === 1
      ? 'Order anda sudah siap dan boleh diambil di Pickup Box di luar kedai.'
      : 'Semua order ini sudah siap dan boleh diambil di Pickup Box di luar kedai.';
  } else if (counts.pending === orders.length) {
    statusText = 'Kami akan maklumkan apabila order siap untuk pickup.';
  } else {
    const parts = [
      counts.collected ? `Sudah diambil: ${counts.collected} order.` : '',
      counts.ready ? `Siap untuk pickup: ${counts.ready} order.` : '',
      counts.pending ? `Belum siap untuk pickup: ${counts.pending} order.` : '',
      counts.ready ? 'Order yang sudah siap boleh diambil di Pickup Box di luar kedai.' : '',
      counts.pending ? 'Kami akan maklumkan apabila baki order siap untuk pickup.' : '',
    ];
    statusText = parts.filter(Boolean).join(' ');
  }

  const location = counts.ready > 0 ? '\n\nLokasi:\nswiy.co/decocakePP' : '';
  const amount = vars.order_total ? `\nJumlah bayaran: ${vars.order_total}` : '';
  const orderLink = vars.order_link ? `\n\nSemak order:\n${vars.order_link}` : '';
  return {
    counts,
    statusText,
    text: `Hi ${vars.customer_name || 'Customer'},\n\nbayaran untuk order ${vars.order_id || ''} telah diterima.${amount}\n\n${statusText}${location}${orderLink}\n\nTerima kasih.`,
    templateName: 'pickup_payment_received_ms',
    templateKeys: ['customer_name', 'order_id', 'order_total', 'pickup_payment_status', 'order_link'],
    templateVars: { ...vars, pickup_payment_status: statusText + (counts.ready > 0 ? ' Lokasi: swiy.co/decocakePP' : '') },
  };
}
