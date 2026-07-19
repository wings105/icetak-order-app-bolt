import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(url, serviceKey);
const headers = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-api-key,idempotency-key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function requiredScopes(action: string) {
  if (['check_readiness', 'get_tracking', 'list_events', 'get_order_shipping'].includes(action)) return ['shipping.read'];
  if (action === 'get_quote') return ['shipping.quote'];
  if (action === 'create_shipment') return ['shipping.create'];
  if (['create_and_checkout', 'create_and_book_shipment'].includes(action)) return ['shipping.create', 'shipping.pay'];
  if (['get_awb', 'refresh_awb'].includes(action)) return ['shipping.awb'];
  if (['cancel_shipment', 'archive_shipment'].includes(action)) return ['shipping.cancel'];
  return ['shipping.read'];
}

async function authenticate(req: Request, action: string) {
  const key = req.headers.get('x-api-key') || '';
  if (!key) throw Object.assign(new Error('X-API-Key is required'), { status: 401, code: 'API_KEY_REQUIRED' });
  const hash = await sha256(key);
  const { data: client, error } = await sb.from('shipping_api_clients').select('*')
    .eq('secret_hash', hash).eq('active', true).maybeSingle();
  if (error) throw error;
  if (!client) throw Object.assign(new Error('API key is invalid'), { status: 401, code: 'INVALID_API_KEY' });
  const missing = requiredScopes(action).filter((scope) => !(client.scopes || []).includes(scope));
  if (missing.length) {
    throw Object.assign(new Error(`Missing scope: ${missing.join(', ')}`), {
      status: 403,
      code: 'INSUFFICIENT_SCOPE',
    });
  }
  await sb.from('shipping_api_clients').update({
    last_used_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', client.id);
  return client;
}

async function invoke(functionName: string, body: unknown) {
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  return { status: response.status, data };
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
    ['public_tracking_token', body.public_tracking_token],
  ]) {
    if (!input) continue;
    const { data, error } = await sb.from('shipments').select('*')
      .eq(column, String(input)).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error && error.code !== '22P02') throw error;
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

function safeShipment(shipment: any, includePrivate = true) {
  const result: any = {
    id: shipment.id,
    order_id: shipment.order_id,
    provider_order_id: shipment.provider_order_id,
    reference: shipment.reference,
    courier: shipment.courier,
    tracking_no: shipment.tracking_no,
    status: shipment.status,
    status_group: shipment.status_group,
    normalized_status: shipment.normalized_status,
    connote_url: shipment.connote_url,
    thermal_connote_url: shipment.thermal_connote_url,
    awb_status: shipment.awb_status,
    awb_pdf_url: shipment.awb_pdf_url,
    public_tracking_token: shipment.public_tracking_token,
    booked_at: shipment.booked_at,
    shipped_at: shipment.shipped_at,
    delivered_at: shipment.delivered_at,
    updated_at: shipment.updated_at,
  };
  if (includePrivate) {
    result.recipient = shipment.recipient_snapshot;
    result.sender = shipment.sender_snapshot;
    result.quoted_amount = shipment.quoted_amount;
    result.charged_amount = shipment.charged_amount;
    result.parcel_weight_kg = shipment.parcel_weight_kg;
  }
  return result;
}

function normalizedPhone(input: unknown) {
  let value = String(input || '').replace(/\D/g, '');
  if (value.startsWith('60')) value = `0${value.slice(2)}`;
  return value;
}

function validateDirect(body: any) {
  const address = body.delivery_address || {};
  const fields = ['fullName', 'phone', 'line1', 'city', 'postcode', 'state'];
  const completeness = fields.filter((key) => String(address[key] || '').trim()).length / fields.length;
  const caller = Math.max(0, Math.min(1, Number(body.confidence ?? 1)));
  const operational = body.order_context?.paid === true && body.order_context?.production_ready === true ? 1 : 0;
  const confidence = Math.min(completeness, caller, operational);
  return {
    confidence,
    ready: confidence >= 0.95,
    components: { address: completeness, caller, operational },
  };
}

async function createDirectOrder(body: any) {
  const check = validateDirect(body);
  if (!check.ready) {
    throw Object.assign(new Error('Direct shipment confidence is below 0.95'), {
      status: 422,
      code: 'LOW_SHIPPING_CONFIDENCE',
      details: check,
    });
  }
  const a = body.delivery_address;
  const reference = body.reference || body.external_reference;
  if (!reference) {
    throw Object.assign(new Error('reference is required for direct shipment'), {
      status: 422,
      code: 'REFERENCE_REQUIRED',
    });
  }
  const { data: existing } = await sb.from('orders').select('*').eq('order_no', reference).limit(1).maybeSingle();
  if (existing) return existing;
  const { data, error } = await sb.from('orders').insert({
    order_no: reference,
    order_id: reference,
    external_order_id: reference,
    source: 'shipping_agent_direct',
    created_by: 'shipping-api',
    status: 'ready_to_ship',
    admin_status: 'ready_to_ship',
    payment_status: 'paid',
    payment: 'paid',
    production_approved: true,
    total: Number(body.order_context?.order_total_rm || body.parcel?.content_value_rm || 50),
    delivery_name: a.fullName,
    delivery_phone: normalizedPhone(a.phone),
    delivery_address: [a.line1, a.line2].filter(Boolean).join(', '),
    delivery_city: a.city,
    delivery_postcode: String(a.postcode),
    delivery_state: a.state,
    delivery_method: 'courier',
  }).select('*').single();
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  let body: any;
  try {
    body = req.method === 'GET'
      ? Object.fromEntries(new URL(req.url).searchParams.entries())
      : await req.json();
  } catch {
    return json({ success: false, error: { code: 'INVALID_REQUEST' } }, 400);
  }

  const action = body.action || 'check_readiness';
  try {
    if (action === 'get_public_tracking') {
      const shipment = await findShipment(body);
      if (!shipment) return json({ success: false, error: { code: 'SHIPMENT_NOT_FOUND' } }, 404);
      const { data: events } = await sb.from('shipment_events').select(
        'status,status_group,normalized_status,event_name,event_time,location,description',
      ).eq('shipment_id', shipment.id).order('event_time', { ascending: true });
      return json({ success: true, shipment: safeShipment(shipment, false), events: events || [] });
    }

    const client = await authenticate(req, action);

    if (['get_tracking', 'list_events', 'get_order_shipping'].includes(action)) {
      const shipment = await findShipment(body);
      if (!shipment) return json({ success: false, error: { code: 'SHIPMENT_NOT_FOUND' } }, 404);
      const { data: events } = await sb.from('shipment_events').select('*')
        .eq('shipment_id', shipment.id).order('event_time', { ascending: true });
      return json({ success: true, shipment: safeShipment(shipment, true), events: events || [] });
    }

    if (['get_awb', 'refresh_awb'].includes(action)) {
      const shipment = await findShipment(body);
      if (!shipment) return json({ success: false, error: { code: 'SHIPMENT_NOT_FOUND' } }, 404);
      const response = await invoke('shipping-awb', {
        shipment_id: shipment.id,
        force: action === 'refresh_awb',
      });
      return json(response.data, response.status);
    }

    if (body.delivery_address && !body.order_reference) {
      const order = await createDirectOrder(body);
      body.order_reference = { id: order.id };
    }

    body.requested_by = { system: client.client_id };
    body.mode = body.mode || 'automatic';
    const response = await invoke('shipping-agent', body);
    return json(response.data, response.status);
  } catch (error: any) {
    return json({
      success: false,
      error: {
        code: error?.code || 'SHIPPING_API_ERROR',
        message: error?.message || String(error),
        details: error?.details,
      },
    }, error?.status || 500);
  }
});