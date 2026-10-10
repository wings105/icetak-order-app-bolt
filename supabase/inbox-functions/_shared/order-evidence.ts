export type OrderEvidence = {
  authoritative: boolean;
  channel?: string;
  cod?: boolean;
  source: string | null;
  order_no: string | null;
  payment_status: string;
  order_status: string;
  shipment_status: string;
  fulfillment_status: string;
  tracking_no: string | null;
  ship_by_at: string | null;
  state: 'unknown'|'unpaid'|'paid'|'ready_to_ship'|'shipped'|'delivered'|'completed'|'cancelled'|'returned'|'refunded'|'delivery_failed';
};

function normalizeStatus(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function orderTimestamp(order: any): number {
  for (const value of [order?.order_updated_at, order?.last_synced_at, order?.updated_at, order?.placed_at]) {
    const parsed = Date.parse(String(value ?? ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function resolveOrderEvidence(summaries: any[],referenceText=''): OrderEvidence {
  if (!summaries.length) return {
    authoritative: false, source: null, order_no: null, payment_status: '', order_status: '',
    shipment_status: '', fulfillment_status: '', tracking_no: null, ship_by_at: null, state: 'unknown'
  };
  const references=summaries.filter(order=>order.order_no && referenceText.toUpperCase().includes(String(order.order_no).toUpperCase()));
  const primary=summaries.filter(order=>order.is_primary===true);
  const active=summaries.filter(order=>order.active_order===true);
  const candidates=references.length===1?references:primary.length===1?primary:active.length===1?active:summaries.length===1?summaries:[];
  if(!candidates.length)return resolveOrderEvidence([]);
  const order = [...candidates].sort((a, b) => {
    const primary = Number(Boolean(b?.is_primary)) - Number(Boolean(a?.is_primary));
    return primary || orderTimestamp(b) - orderTimestamp(a);
  })[0];
  const payment = normalizeStatus(order?.payment_status);
  const orderStatus = normalizeStatus(order?.order_status);
  const shipment = normalizeStatus(order?.shipment_status);
  const fulfillment = normalizeStatus(order?.fulfillment_status);
  const joined = [orderStatus, shipment, fulfillment].join(' ');
  let state: OrderEvidence['state'] = 'unknown';
  if (/REFUND/.test(joined)) state = 'refunded';
  else if (/RETURN/.test(joined)) state = 'returned';
  else if (/IN_CANCEL|CANCELLED|CANCELED|LOGISTICS_INVALID|REQUEST_CANCELED/.test(joined)) state = 'cancelled';
  else if (/\bCOMPLETED\b/.test(orderStatus)) state = 'completed';
  else if (/DELIVERY_DONE|\bDELIVERED\b|TO_CONFIRM_RECEIVE/.test(joined)) state = 'delivered';
  else if (/DELIVERY_FAILED/.test(joined)) state = 'delivery_failed';
  else if (/\bSHIPPED\b|PICKUP_DONE|IN_TRANSIT|TO_RECEIVE|OUT_FOR_DELIVERY/.test(joined)) state = 'shipped';
  else if (/READY_TO_SHIP|\bPROCESSED\b|LOGISTICS_READY|REQUEST_CREATED/.test(joined)) state = 'ready_to_ship';
  else if (/^(PAID|SUCCESS|COMPLETED|VERIFIED)$/.test(payment)) state = 'paid';
  else if (/UNPAID|WAITING|PENDING/.test(payment) || /\bUNPAID\b/.test(orderStatus)) state = 'unpaid';
  return {
    authoritative: order?.ai_match_source === 'conversation_order_link' && !order?.metadata?.provisional && !!order?.order_system_order_id,
    channel: order?.source_channel,
    cod: /cod|cash/i.test(String(order?.payment_method||'')),
    source: String(order?.ai_match_source ?? ''),
    order_no: order?.order_no ? String(order.order_no) : null,
    payment_status: payment,
    order_status: orderStatus,
    shipment_status: shipment,
    fulfillment_status: fulfillment,
    tracking_no: order?.tracking_no ? String(order.tracking_no) : null,
    ship_by_at: order?.ship_by_at ? String(order.ship_by_at) : null,
    state
  };
}

