import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const cors = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type,idempotency-key',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: cors,
});
const cfg = (key: string) => Deno.env.get(key) || '';
const first = (...items: unknown[]) => {
  for (const item of items) {
    if (item !== undefined && item !== null && String(item).trim() !== '') return String(item).trim();
  }
  return null;
};

async function provider(path: string, body?: unknown, method = 'POST') {
  const base = (cfg('PARCELDAILY_BASE_URL') || 'https://api.sandbox.parceldaily.com').replace(/\/$/, '');
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      token: cfg('PARCELDAILY_TOKEN'),
      merchantid: cfg('PARCELDAILY_MERCHANT_ID'),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) {
    throw Object.assign(
      new Error(data?.message || data?.error?.message || data?.error || `ParcelDaily HTTP ${response.status}`),
      { status: response.status, details: data },
    );
  }
  return data;
}

function parseRates(payload: any) {
  const source = payload?.success || payload?.data || payload || {};
  return Object.entries(source)
    .filter(([key, value]) => key.toLowerCase().endsWith('price') && Number(value) > 0)
    .map(([key, value]) => ({
      courier: key.slice(0, -5).toLowerCase(),
      price: Number(value),
    }))
    .sort((a, b) => a.price - b.price);
}

async function findOrder(reference: any = {}) {
  for (const [column, input] of [
    ['id', reference.id],
    ['order_no', reference.order_no],
    ['order_id', reference.order_id],
    ['external_order_id', reference.external_order_id || reference.order_id],
  ]) {
    if (!input) continue;
    const { data, error } = await sb.from('orders').select('*').eq(column, String(input)).limit(1).maybeSingle();
    if (error && error.code !== '22P02') throw error;
    if (data) return data;
  }
  return null;
}

async function findShipment(body: any) {
  for (const [column, input] of [
    ['id', body.shipment_id],
    ['tracking_no', body.tracking_no],
    ['provider_order_id', body.provider_order_id],
    ['reference', body.reference],
  ]) {
    if (!input) continue;
    const { data } = await sb.from('shipments').select('*').eq(column, String(input))
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return data;
  }
  if (body.order_reference) {
    const order = await findOrder(body.order_reference);
    if (order) {
      const { data } = await sb.from('shipments').select('*').eq('order_id', order.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data) return data;
    }
  }
  return null;
}

async function checkoutStatus(providerOrderId: string) {
  const raw = await provider('/v1/partner/checkout-status', { orderIds: [providerOrderId] });
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  return list[0] || null;
}

async function refreshShipment(shipment: any) {
  if (!shipment.provider_order_id) return shipment;
  const info = await checkoutStatus(shipment.provider_order_id);
  if (!info) return shipment;
  const updates = {
    tracking_no: first(info.consign_no, info.connote, shipment.tracking_no),
    connote_url: first(info.connoteURL, shipment.connote_url),
    thermal_connote_url: first(info.thermalConnoteURL, shipment.thermal_connote_url),
    courier: first(info.serviceProvider, shipment.courier),
    service_provider: first(info.serviceProvider, shipment.service_provider),
    status: first(info.status, shipment.status),
    updated_at: new Date().toISOString(),
  };
  const { data } = await sb.from('shipments').update(updates).eq('id', shipment.id).select('*').single();
  return data || { ...shipment, ...updates };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json();
    const action = body.action || 'check_readiness';
    const requestId = body.request_id || crypto.randomUUID();

    if (['get_tracking', 'get_awb', 'refresh_awb', 'cancel_shipment', 'archive_shipment'].includes(action)) {
      let shipment = await findShipment(body);
      if (!shipment) return json({ success: false, error: { code: 'SHIPMENT_NOT_FOUND' } }, 404);

      if (['get_awb', 'refresh_awb'].includes(action) && (!shipment.connote_url || action === 'refresh_awb')) {
        shipment = await refreshShipment(shipment);
      }

      if (['cancel_shipment', 'archive_shipment'].includes(action)) {
        if (!shipment.provider_order_id) {
          return json({ success: false, error: { code: 'PROVIDER_ORDER_ID_MISSING' } }, 422);
        }
        const endpoint = action === 'cancel_shipment'
          ? '/v1/partner/order/cancel'
          : '/v1/partner/order/archive';
        const providerResponse = await provider(endpoint, { orderId: shipment.provider_order_id });
        const now = new Date().toISOString();
        const updates = action === 'cancel_shipment'
          ? { status: 'cancelled', status_group: 'cancelled', normalized_status: 'cancelled', cancelled_at: now }
          : { status: 'archived', status_group: 'archived', normalized_status: 'archived', archived_at: now };
        await sb.from('shipments').update({ ...updates, updated_at: now }).eq('id', shipment.id);
        return json({ success: true, shipment_id: shipment.id, provider_response: providerResponse });
      }

      const { data: events } = await sb.from('shipment_events').select('*')
        .eq('shipment_id', shipment.id).order('event_time', { ascending: true });
      return json({
        success: true,
        shipment,
        awb: {
          status: shipment.connote_url ? 'ready' : 'pending',
          pdf_url: shipment.connote_url,
          thermal_pdf_url: shipment.thermal_connote_url,
        },
        events: events || [],
      });
    }

    const order = await findOrder(body.order_reference || {});
    if (!order) return json({ success: false, error: { code: 'ORDER_NOT_FOUND' } }, 404);

    const { data: settingRows } = await sb.from('shipping_settings').select('key,value');
    const settings = Object.fromEntries((settingRows || []).map((row: any) => [row.key, row.value]));
    const policy = settings.policy || {};
    const blocks: string[] = [];

    const paid = [order.payment_status, order.payment]
      .some((value) => ['paid', 'completed', 'success'].includes(String(value || '').toLowerCase()));
    const productionReady = order.production_approved === true ||
      ['ready_to_ship', 'ready', 'completed'].includes(String(order.status || '').toLowerCase());
    if (policy.require_paid_order && !paid) blocks.push('ORDER_NOT_PAID');
    if (policy.require_production_ready && !productionReady) blocks.push('PRODUCTION_NOT_READY');
    for (const [input, code] of [
      [order.delivery_name, 'RECIPIENT_NAME_MISSING'],
      [order.delivery_phone, 'RECIPIENT_PHONE_MISSING'],
      [order.delivery_address, 'ADDRESS_INCOMPLETE'],
      [order.delivery_city, 'CITY_MISSING'],
      [order.delivery_postcode, 'POSTCODE_MISSING'],
      [order.delivery_state, 'STATE_MISSING'],
    ]) if (!input) blocks.push(code as string);

    const confidence = blocks.length ? 0 : 1;
    const readiness = { ready: blocks.length === 0, blocking_reasons: blocks, confidence };
    const { data: run } = await sb.from('shipping_agent_runs').insert({
      request_id: requestId,
      action,
      mode: body.mode || settings.agent_mode || 'automatic',
      order_id: order.id,
      requested_by: body.requested_by?.system || 'external',
      input_payload: body,
      confidence,
      requires_human: !readiness.ready,
    }).select('*').single();

    if (action === 'check_readiness') {
      const result = {
        success: true,
        request_id: requestId,
        run_id: run.id,
        result: {
          order_id: order.id,
          readiness,
          defaults: {
            weight_kg: policy.default_weight_kg || 1,
            content: policy.default_content || 'decoration cake',
            content_value_rm: policy.default_content_value_rm || 50,
          },
        },
      };
      await sb.from('shipping_agent_runs').update({
        status: 'completed',
        result_payload: result,
        completed_at: new Date().toISOString(),
      }).eq('id', run.id);
      return json(result);
    }

    if (!readiness.ready) {
      return json({
        success: false,
        request_id: requestId,
        error: { code: blocks[0], details: readiness },
      }, 422);
    }

    const origin = settings.origin_address || {};
    if (!origin.postcode) return json({ success: false, error: { code: 'ORIGIN_NOT_CONFIGURED' } }, 422);
    const weight = Number(body.parcel?.weight_kg || policy.default_weight_kg || 1);
    const quoteRequest = {
      origin: String(origin.postcode),
      destination: String(order.delivery_postcode),
      originCountry: origin.country || 'Malaysia',
      destinationCountry: 'Malaysia',
      weight,
    };
    const quoteRaw = await provider('/v1/partner/merchant/quote', quoteRequest);
    const quotes = parseRates(quoteRaw);
    if (!quotes.length) return json({ success: false, error: { code: 'NO_COURIER_AVAILABLE' } }, 422);
    const preference = body.options?.courier_preference;
    const selected = preference && preference !== 'auto'
      ? quotes.find((quote) => quote.courier.includes(String(preference).toLowerCase()))
      : quotes[0];
    if (!selected) return json({ success: false, error: { code: 'PREFERRED_COURIER_UNAVAILABLE' } }, 422);

    await sb.from('shipping_quotes').insert(quotes.map((quote) => ({
      run_id: run.id,
      order_id: order.id,
      service_provider: quote.courier,
      price: quote.price,
      selected: quote.courier === selected.courier,
      raw_response: quoteRaw,
    })));

    const mode = body.mode || settings.agent_mode || 'automatic';
    if (action === 'get_quote' || mode !== 'automatic') {
      const result = {
        success: true,
        request_id: requestId,
        run_id: run.id,
        status: action === 'get_quote' ? 'completed' : 'approval_required',
        requires_human: action !== 'get_quote',
        result: { order_id: order.id, quotes, selected_quote: selected },
      };
      await sb.from('shipping_agent_runs').update({
        status: result.status,
        result_payload: result,
        requires_human: result.requires_human,
        completed_at: new Date().toISOString(),
      }).eq('id', run.id);
      return json(result);
    }

    const reference = String(body.reference || order.order_no || order.order_id || order.id).slice(0, 100);
    const { data: existing } = await sb.from('shipments').select('*').eq('reference', reference)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing && !['cancelled', 'archived'].includes(String(existing.normalized_status || existing.status || '').toLowerCase())) {
      return json({ success: true, duplicate_prevented: true, shipment: existing });
    }

    const pickup = {
      fullName: origin.fullName || origin.name,
      countryCode: '+60',
      phone: String(origin.phone || '').replace(/^60/, '').replace(/^0/, ''),
      email: origin.email || '',
      line1: origin.line1,
      line2: origin.line2 || '',
      city: origin.city,
      postcode: String(origin.postcode),
      state: origin.state,
      country: origin.country || 'Malaysia',
    };
    const receiver = {
      fullName: order.delivery_name,
      countryCode: '+60',
      phone: String(order.delivery_phone || '').replace(/^60/, '').replace(/^0/, ''),
      email: '',
      line1: order.delivery_address,
      line2: '',
      city: order.delivery_city,
      postcode: String(order.delivery_postcode),
      state: order.delivery_state,
      country: 'Malaysia',
    };
    const createRequest = {
      serviceProvider: selected.courier,
      pickupAddress: pickup,
      clientAddress: receiver,
      isDropoff: body.parcel?.is_dropoff ?? policy.default_is_dropoff ?? false,
      kg: weight,
      price: selected.price,
      content: body.parcel?.content || policy.default_content || 'decoration cake',
      content_value: Number(body.parcel?.content_value_rm || order.total || policy.default_content_value_rm || 50),
      contentValueCurrency: 'MYR',
      reference,
    };
    const createdRaw = await provider('/v1/partner/order/create', createRequest);
    const created = createdRaw?.success || createdRaw?.data || createdRaw;
    const providerOrderId = first(created.orderId, created.objectId, created.id, created.order_id);
    if (!providerOrderId) throw new Error('ParcelDaily response missing orderId');

    const { data: createdShipment } = await sb.from('shipments').insert({
      order_id: order.id,
      provider: 'parceldaily',
      provider_order_id: providerOrderId,
      reference,
      service_provider: selected.courier,
      courier: selected.courier,
      status: 'created',
      status_group: 'shipment_created',
      normalized_status: 'created',
      quoted_amount: selected.price,
      parcel_weight_kg: weight,
      recipient_snapshot: receiver,
      sender_snapshot: pickup,
      provider_payload: { created: createdRaw },
      awb_status: 'pending',
    }).select('*').single();

    let shipment = createdShipment;
    let checkoutRaw: any = null;
    if (['create_and_checkout', 'create_and_book_shipment'].includes(action)) {
      checkoutRaw = await provider('/v1/partner/order/pay', { orderId: providerOrderId });
      const checkout = checkoutRaw?.data || checkoutRaw?.success || checkoutRaw;
      const tracking = first(checkout.connote, checkout.consign_no, checkout.tracking_no);
      const { data: updated } = await sb.from('shipments').update({
        status: 'booked',
        status_group: 'booked',
        normalized_status: 'booked',
        tracking_no: tracking,
        booked_at: new Date().toISOString(),
        provider_payload: { created: createdRaw, checkout: checkoutRaw },
      }).eq('id', createdShipment.id).select('*').single();
      shipment = await refreshShipment(updated || { ...createdShipment, tracking_no: tracking });
    }

    await sb.from('orders').update({
      tracking: shipment.tracking_no,
      courier: shipment.courier,
      connote_url: shipment.connote_url,
      shipment_status: shipment.status,
      shipment_status_group: shipment.status_group,
      shipment_updated_at: new Date().toISOString(),
    }).eq('id', order.id);

    const result = {
      success: true,
      request_id: requestId,
      run_id: run.id,
      status: 'completed',
      result: {
        order_id: order.id,
        shipment,
        awb: {
          status: shipment.connote_url ? 'ready' : 'pending',
          pdf_url: shipment.connote_url,
          thermal_pdf_url: shipment.thermal_connote_url,
        },
        provider_response: { created: createdRaw, checkout: checkoutRaw },
      },
    };
    await sb.from('shipping_agent_runs').update({
      status: 'completed',
      shipment_id: shipment.id,
      result_payload: result,
      completed_at: new Date().toISOString(),
    }).eq('id', run.id);
    return json(result);
  } catch (error: any) {
    return json({
      success: false,
      error: {
        code: 'SHIPPING_AGENT_ERROR',
        message: error?.message || String(error),
        details: error?.details,
      },
    }, error?.status || 400);
  }
});