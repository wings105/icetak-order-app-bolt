import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

function text(...values: unknown[]) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function statusLabel(value: unknown) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (key === 'awb_created' || key === 'shipment_created' || key === 'booked') return 'AWB Created';
  if (key === 'picked_up') return 'Picked Up';
  if (key === 'in_transit') return 'In Transit';
  if (key === 'out_for_delivery') return 'Out for Delivery';
  if (key === 'delivered') return 'Delivered';
  if (key === 'delivery_exception') return 'Delivery Exception';
  if (key === 'returning') return 'Returning';
  if (key === 'cancelled') return 'Cancelled';
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Shipment Update';
}

async function findOrderByToken(token: string) {
  const { data, error } = await sb.from('orders').select('id,public_token,customer_id,customer_token')
    .eq('public_token', token).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function findCustomerOrders(token: string) {
  let { data: orders, error } = await sb.from('orders')
    .select('id,public_token,customer_id,customer_token')
    .eq('customer_token', token).order('created_at', { ascending: false });
  if (error) throw error;
  if (orders?.length) return orders;

  const { data: customer, error: customerError } = await sb.from('customers')
    .select('id').eq('public_token', token).limit(1).maybeSingle();
  if (customerError) throw customerError;
  if (customer) {
    const result = await sb.from('orders').select('id,public_token,customer_id,customer_token')
      .eq('customer_id', customer.id).order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }

  if (/^[0-9a-f-]{36}$/i.test(token)) {
    const result = await sb.from('orders').select('id,public_token,customer_id,customer_token')
      .eq('customer_id', token).order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }
  return [];
}

async function shipmentForOrder(orderId: string) {
  const { data: shipment, error } = await sb.from('shipments').select('*')
    .eq('order_id', orderId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!shipment) return null;

  const [{ data: events, error: eventError }, { data: pods, error: podError }] = await Promise.all([
    sb.from('shipment_events')
      .select('id,status,status_group,normalized_status,event_name,event_time,location,description,created_at')
      .eq('shipment_id', shipment.id).order('event_time', { ascending: false }),
    sb.from('shipment_pod_files')
      .select('id,position,content_type,size_bytes,archive_status,archived_at')
      .eq('shipment_id', shipment.id)
      .in('archive_status', ['archived_db', 'archived_storage'])
      .order('position', { ascending: true }),
  ]);
  if (eventError) throw eventError;
  if (podError) throw podError;

  const normalized = text(shipment.normalized_status, shipment.status_group, shipment.status);
  const publicToken = text(shipment.public_tracking_token);
  const podFiles = (pods || []).map((pod) => ({
    id: pod.id,
    position: Number(pod.position || 0),
    contentType: pod.content_type || 'image/jpeg',
    sizeBytes: Number(pod.size_bytes || 0),
    archivedAt: pod.archived_at,
    url: `${url}/functions/v1/shipping-pod-view?token=${encodeURIComponent(publicToken)}&pod_id=${encodeURIComponent(pod.id)}`,
  }));

  return {
    id: shipment.id,
    reference: shipment.reference || '',
    tracking: shipment.tracking_no || '',
    courier: text(shipment.courier, shipment.service_provider),
    trackingLink: shipment.tracking_link || '',
    connoteUrl: text(shipment.awb_pdf_url, shipment.connote_url, shipment.thermal_connote_url),
    thermalConnoteUrl: shipment.thermal_connote_url || '',
    status: shipment.status || statusLabel(normalized),
    statusGroup: normalized,
    normalizedStatus: normalized,
    statusLabel: statusLabel(normalized),
    updatedAt: shipment.updated_at ? new Date(shipment.updated_at).getTime() : 0,
    bookedAt: shipment.booked_at ? new Date(shipment.booked_at).getTime() : 0,
    shippedAt: shipment.shipped_at ? new Date(shipment.shipped_at).getTime() : 0,
    deliveredAt: shipment.delivered_at ? new Date(shipment.delivered_at).getTime() : 0,
    podStatus: shipment.pod_status || '',
    podCount: podFiles.length,
    pods: podFiles,
    events: (events || []).map((event) => {
      const eventNormalized = text(event.normalized_status, event.status_group, event.status);
      return {
        id: event.id,
        status: event.status || statusLabel(eventNormalized),
        statusGroup: eventNormalized,
        normalizedStatus: eventNormalized,
        statusLabel: statusLabel(eventNormalized),
        event: event.event_name || event.description || '',
        eventTime: event.event_time || event.created_at
          ? new Date(event.event_time || event.created_at).getTime()
          : 0,
        location: event.location || '',
        description: event.description || '',
      };
    }),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  try {
    const search = new URL(req.url).searchParams;
    const orderToken = text(search.get('order_token'));
    const customerToken = text(search.get('customer_token'));

    if (orderToken) {
      const order = await findOrderByToken(orderToken);
      if (!order) return json({ error: 'order_not_found' }, 404);
      return json({ orderToken: order.public_token, shipment: await shipmentForOrder(order.id) });
    }

    if (customerToken) {
      const orders = await findCustomerOrders(customerToken);
      const shipments = await Promise.all(orders.map(async (order) => ({
        orderToken: order.public_token,
        shipment: await shipmentForOrder(order.id),
      })));
      return json({ shipments });
    }

    return json({ error: 'order_token_or_customer_token_required' }, 400);
  } catch (error) {
    console.error('customer-shipment error', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
