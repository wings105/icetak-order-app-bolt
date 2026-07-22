import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const text = (...values: unknown[]) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return null;
};

function extract(payload: any) {
  const d = payload?.data ?? payload ?? {};
  const piece = d?.piece ?? payload?.piece ?? {};
  const serviceInfo = d?.serviceProviderInfo ?? payload?.serviceProviderInfo ?? {};
  const tracking = text(
    payload?.consign_no, d?.consign_no, payload?.connote, d?.connote,
    payload?.tracking_no, d?.tracking_no, piece?.consign_no,
  );
  const providerOrderId = text(payload?.orderId, d?.orderId, payload?.objectId, d?.objectId, payload?.order_id, d?.order_id);
  const reference = text(payload?.reference, d?.reference, payload?.external_reference, d?.external_reference);
  const eventType = text(payload?.event, payload?.type, d?.event, d?.type)
    ?? (tracking ? 'CHECKOUT' : 'TRACKING_UPDATE');
  const status = text(payload?.status, d?.status, payload?.shipment_status, d?.shipment_status) ?? 'unknown';
  const statusGroup = text(payload?.statusGroup, d?.statusGroup, payload?.status_group, d?.status_group);
  const courier = text(payload?.serviceProvider, d?.serviceProvider, payload?.courier, d?.courier);
  const eventTime = text(
    payload?.event_time, d?.event_time, payload?.timestamp, d?.timestamp,
    payload?.statusUpdatedAt, d?.statusUpdatedAt, payload?.updated_at, d?.updated_at,
    payload?.createdAt, d?.createdAt,
  );
  const connoteUrl = text(payload?.connoteURL, d?.connoteURL);
  const thermalConnoteUrl = text(payload?.thermalConnoteURL, d?.thermalConnoteURL);
  const trackingLink = text(
    payload?.tracking_link, d?.tracking_link,
    serviceInfo?.tracking_link, serviceInfo?.order_id_link,
  );
  const kg = Number(payload?.kg ?? d?.kg ?? payload?.item?.kg ?? d?.item?.kg ?? 0) || null;
  const price = Number(payload?.price ?? d?.price ?? payload?.prices?.courier?.price ?? d?.prices?.courier?.price ?? 0) || null;
  return {
    d, tracking, providerOrderId, reference, eventType, status, statusGroup,
    courier, eventTime, connoteUrl, thermalConnoteUrl, trackingLink, kg, price,
  };
}

const ranks: Record<string, number> = {
  unknown: 0,
  shipment_created: 10,
  awb_created: 15,
  booked: 15,
  picked_up: 25,
  in_transit: 35,
  delivery_exception: 38,
  out_for_delivery: 45,
  returning: 50,
  delivered: 60,
  cancelled: 70,
  archived: 80,
};

function effectiveStatus(current: string | null, incoming: string | null) {
  const a = current || 'unknown';
  const b = incoming || 'unknown';
  if (a === 'delivered' || a === 'cancelled' || a === 'archived') return a;
  return (ranks[b] ?? 0) >= (ranks[a] ?? 0) ? b : a;
}

async function resolveOrder(reference: string | null) {
  if (!reference) return null;
  const { data, error } = await sb.rpc('resolve_shipping_order_reference', { p_reference: reference });
  if (error) throw error;
  return data || null;
}

async function findShipment(providerOrderId: string | null, tracking: string | null, reference: string | null) {
  for (const [column, input] of [
    ['provider_order_id', providerOrderId],
    ['tracking_no', tracking],
    ['reference', reference],
  ]) {
    if (!input) continue;
    const { data, error } = await sb.from('shipments').select('*')
      .eq('provider', 'parceldaily').eq(column, input)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  return null;
}

async function createShipment(payload: any, x: ReturnType<typeof extract>, normalizedStatus: string, orderId: string | null) {
  const now = new Date().toISOString();
  const row: any = {
    order_id: orderId,
    provider: 'parceldaily',
    provider_order_id: x.providerOrderId,
    reference: x.reference,
    tracking_no: x.tracking,
    courier: x.courier,
    service_provider: x.courier,
    tracking_link: x.trackingLink,
    status: x.status,
    status_group: normalizedStatus,
    normalized_status: normalizedStatus,
    connote_url: x.connoteUrl,
    thermal_connote_url: x.thermalConnoteUrl,
    recipient_snapshot: x.d?.receiver ?? payload?.receiver ?? {},
    sender_snapshot: x.d?.sender ?? payload?.sender ?? payload?.pickup ?? {},
    provider_payload: { created_from_webhook: true, first_webhook: payload, last_webhook: payload },
    quoted_amount: x.price,
    charged_amount: x.price,
    parcel_weight_kg: x.kg,
    currency: 'MYR',
    awb_status: x.connoteUrl || x.tracking ? 'provider_ready' : 'pending',
    booked_at: x.eventType === 'CHECKOUT' || normalizedStatus === 'awb_created' ? now : null,
    shipped_at: ['picked_up', 'in_transit', 'out_for_delivery'].includes(normalizedStatus) ? now : null,
    delivered_at: normalizedStatus === 'delivered' ? now : null,
    updated_at: now,
  };
  const { data, error } = await sb.from('shipments').insert(row).select('*').single();
  if (!error) return data;
  if (error.code === '23505') return await findShipment(x.providerOrderId, x.tracking, x.reference);
  throw error;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const raw = await req.text();
  let payload: any;
  try { payload = JSON.parse(raw); }
  catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const expected = Deno.env.get('PARCELDAILY_WEBHOOK_SECRET') ?? '';
  const supplied = req.headers.get('x-webhook-secret') ?? new URL(req.url).searchParams.get('secret') ?? '';
  if (expected && supplied !== expected) return json({ ok: false, error: 'invalid_webhook_secret' }, 401);

  const x = extract(payload);
  const eventId = req.headers.get('x-event-id') ?? await sha256([
    x.eventType, x.providerOrderId ?? '', x.tracking ?? '', x.reference ?? '',
    x.status, x.statusGroup ?? '', raw,
  ].join('|'));

  const { data: webhookRow, error: captureError } = await sb.from('shipping_webhook_events').insert({
    provider: 'parceldaily',
    provider_event_id: eventId,
    event_type: x.eventType,
    signature_valid: true,
    reference: x.reference,
    payload,
    headers: Object.fromEntries(req.headers.entries()),
    processing_status: 'received',
    resolution_status: 'pending',
  }).select('id').single();

  if (captureError?.code === '23505') return json({ ok: true, duplicate: true, event_id: eventId });
  if (captureError) return json({ ok: false, error: 'webhook_capture_failed' }, 500);

  try {
    const { data: rawNormalized, error: normalizeError } = await sb.rpc('normalize_shipping_status', {
      p_status: x.status,
      p_group: x.statusGroup,
    });
    if (normalizeError) throw normalizeError;
    let incomingNormalized = rawNormalized || 'unknown';
    if (x.eventType === 'CHECKOUT' && incomingNormalized === 'unknown') incomingNormalized = 'awb_created';

    let orderId = await resolveOrder(x.reference);
    let shipment = await findShipment(x.providerOrderId, x.tracking, x.reference);
    const autoCreated = !shipment;
    if (!shipment) shipment = await createShipment(payload, x, incomingNormalized, orderId);
    if (!shipment) throw new Error('shipment_create_or_lookup_failed');

    if (!orderId) orderId = shipment.order_id || await resolveOrder(shipment.reference || x.reference);
    const normalizedStatus = effectiveStatus(shipment.normalized_status, incomingNormalized);
    const now = new Date().toISOString();
    const updates: any = {
      order_id: orderId ?? shipment.order_id,
      provider_order_id: x.providerOrderId ?? shipment.provider_order_id,
      reference: x.reference ?? shipment.reference,
      tracking_no: x.tracking ?? shipment.tracking_no,
      courier: x.courier ?? shipment.courier,
      service_provider: x.courier ?? shipment.service_provider,
      tracking_link: x.trackingLink ?? shipment.tracking_link,
      status: normalizedStatus === incomingNormalized ? x.status : shipment.status,
      status_group: normalizedStatus,
      normalized_status: normalizedStatus,
      connote_url: x.connoteUrl ?? shipment.connote_url,
      thermal_connote_url: x.thermalConnoteUrl ?? shipment.thermal_connote_url,
      recipient_snapshot: Object.keys(x.d?.receiver ?? payload?.receiver ?? {}).length
        ? (x.d?.receiver ?? payload?.receiver) : shipment.recipient_snapshot,
      sender_snapshot: Object.keys(x.d?.sender ?? payload?.sender ?? payload?.pickup ?? {}).length
        ? (x.d?.sender ?? payload?.sender ?? payload?.pickup) : shipment.sender_snapshot,
      provider_payload: { ...(shipment.provider_payload ?? {}), last_webhook: payload },
      quoted_amount: shipment.quoted_amount ?? x.price,
      charged_amount: shipment.charged_amount ?? x.price,
      parcel_weight_kg: shipment.parcel_weight_kg ?? x.kg,
      awb_status: x.connoteUrl || x.tracking ? 'provider_ready' : shipment.awb_status,
      updated_at: now,
    };
    if ((x.eventType === 'CHECKOUT' || normalizedStatus === 'awb_created') && !shipment.booked_at) updates.booked_at = now;
    if (['picked_up', 'in_transit', 'out_for_delivery'].includes(normalizedStatus) && !shipment.shipped_at) updates.shipped_at = now;
    if (normalizedStatus === 'delivered' && !shipment.delivered_at) updates.delivered_at = now;
    if (normalizedStatus !== 'delivered' && incomingNormalized !== 'delivered' && shipment.normalized_status !== 'delivered') updates.delivered_at = null;

    const { data: updatedShipment, error: updateError } = await sb.from('shipments')
      .update(updates).eq('id', shipment.id).select('*').single();
    if (updateError) throw updateError;
    shipment = updatedShipment || { ...shipment, ...updates };

    const { error: eventError } = await sb.from('shipment_events').insert({
      shipment_id: shipment.id,
      order_id: shipment.order_id,
      provider: 'parceldaily',
      provider_event_id: eventId,
      event_key: eventId,
      tracking_no: shipment.tracking_no,
      courier: shipment.courier,
      status: x.status,
      status_group: incomingNormalized,
      normalized_status: incomingNormalized,
      previous_status: text(payload?.previousStatus, x.d?.previousStatus),
      event_name: x.eventType,
      event_time: x.eventTime ?? now,
      location: text(payload?.location, x.d?.location),
      description: text(payload?.description, x.d?.description, payload?.message, x.d?.message),
      raw_payload: payload,
      source: 'webhook',
    });
    if (eventError && eventError.code !== '23505') throw eventError;

    await sb.from('shipping_webhook_events').update({
      reference: shipment.reference ?? x.reference,
      shipment_id: shipment.id,
      order_id: shipment.order_id,
      resolution_status: shipment.order_id ? 'matched_order' : 'shipment_only',
      processing_status: 'processed',
      processed_at: now,
      error_message: null,
    }).eq('id', webhookRow.id);

    return json({
      ok: true,
      duplicate: false,
      event_id: eventId,
      reference: shipment.reference,
      shipment_id: shipment.id,
      order_id: shipment.order_id,
      normalized_status: shipment.normalized_status,
      auto_created_shipment: autoCreated,
      matched_order: Boolean(shipment.order_id),
    });
  } catch (error: any) {
    await sb.from('shipping_webhook_events').update({
      processing_status: 'failed',
      resolution_status: 'failed',
      error_message: error?.message ?? String(error),
      processed_at: new Date().toISOString(),
    }).eq('id', webhookRow.id);
    return json({ ok: false, error: 'processing_failed', event_id: eventId, detail: error?.message }, 500);
  }
});
