import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,x-client-info,apikey,x-api-key',
};
const url = Deno.env.get('SUPABASE_URL') || '';
const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const receiptBucket = 'icetak-receipts';
const output = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
});
const fail = (message: string, status = 400) => output({ error: message }, status);
const text = (value: unknown) => value == null ? '' : String(value);
const key = (value: unknown) => text(value).trim().toLowerCase().replace(/[\s-]+/g, '_');

async function db(path: string, init: RequestInit = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRole,
      authorization: `Bearer ${serviceRole}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  return data;
}

const rpc = (name: string, args: unknown) => db(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
const millis = (value: unknown) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const parsed = new Date(text(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};
const dateText = (value: unknown) => {
  if (!value) return '';
  const date = new Date(text(value));
  if (Number.isNaN(date.getTime())) return text(value);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(date);
};

function customerWorkflow(value: unknown, delivery = '') {
  const workflow = key(value);
  if (!workflow || ['new', 'received', 'order_received', 'hold'].includes(workflow)) return 'Order Received';
  if ([
    'design_pending', 'design_editing', 'designing', 'drafting', 'edit_requested', 'revision_requested',
    'design_new_custom', 'design_acrylic', 'design_edible', 'design_editing_topper', 'design_wafer',
  ].includes(workflow)) return 'Design Editing';
  if (['waiting_review', 'review_pending', 'pending_review', 'customer_review', 'awaiting_approval'].includes(workflow)) return 'Waiting Review';
  if (['approved', 'design_approved', 'customer_approved'].includes(workflow)) return 'Approved';
  if (['production', 'in_production', 'production_started', 'printing', 'manual_processing', 'cutting', 'print', 'cut'].includes(workflow)) return 'Production';
  if (['finishing', 'packing', 'ready_stock', 'quality_check', 'qc', 'packed'].includes(workflow)) return 'Finishing';
  if (['ready', 'ready_to_pickup', 'ready_for_pickup'].includes(workflow)) return key(delivery).includes('pickup') ? 'Ready' : 'Finishing';
  if (['production_complete', 'complete', 'completed'].includes(workflow)) return key(delivery).includes('pickup') ? 'Ready' : 'Finishing';
  if (workflow === 'delivered') return 'Delivered';
  return text(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function paymentLabel(order: any) {
  const payment = key(order.payment || order.payment_status);
  if (!payment || payment.startsWith('unpaid') || ['pending', 'pending_review', 'receipt_submitted', 'waiting_payment'].includes(payment)) return 'Unpaid';
  if (payment.includes('cash')) return 'Cash at Counter';
  if (['paid', 'matched', 'payment_received', 'success', 'completed'].includes(payment)) return 'Paid';
  return 'Unpaid';
}

const latest = (rows: any[]) => [...(rows || [])].sort((a, b) => millis(b.updated_at || b.created_at) - millis(a.updated_at || a.created_at))[0] || null;

function orderStatus(order: any, payment: string, components: any[], shipment: any, actions: number) {
  const raw = key(order.status || order.admin_status);
  const shipping = key(shipment?.normalized_status || shipment?.status || order.shipment_status || order.shipment_status_group);
  if (raw.includes('cancel')) return 'Cancelled';
  if (shipping.includes('deliver') || raw.includes('deliver') || raw.includes('complete')) return 'Completed';
  if (shipping.includes('out_for_delivery')) return 'Out for Delivery';
  if (shipping.includes('in_transit') || shipping.includes('picked_up') || raw.includes('shipped')) return 'Shipped';
  if (raw.includes('ready_for_pickup') || raw.includes('ready_pickup')) return 'Ready for Pickup';
  if (payment === 'Unpaid') return 'Waiting Payment';
  if (actions) return 'Action Required';
  const stages = components.map((component) => customerWorkflow(component.workflow, order.delivery || order.delivery_method));
  if (stages.some((stage) => stage === 'Finishing')) return 'Finishing';
  if (stages.some((stage) => stage === 'Production')) return 'In Production';
  if (stages.some((stage) => stage === 'Approved' || stage === 'Design Editing' || stage === 'Waiting Review')) return 'Design / Production';
  if (stages.length && stages.every((stage) => ['Ready', 'Delivered'].includes(stage))) {
    return key(order.delivery || order.delivery_method).includes('pickup') ? 'Ready for Pickup' : 'Ready to Ship';
  }
  return payment === 'Paid' || payment === 'Cash at Counter' ? 'Ready to Process' : text(order.status || 'Order Received').replaceAll('_', ' ');
}

function historyTab(order: any, payment: string, shipment: any, actions: number) {
  const raw = key(order.status || order.admin_status);
  const shipping = key(shipment?.normalized_status || shipment?.status || order.shipment_status || order.shipment_status_group);
  if (raw.includes('cancel') || raw.includes('complete') || raw.includes('deliver') || shipping.includes('deliver')) return 'completed';
  if (shipment?.tracking_no || order.tracking || ['awb_created', 'picked_up', 'shipped', 'in_transit', 'out_for_delivery', 'ready_for_pickup'].some((value) => raw.includes(value) || shipping.includes(value))) return 'receive';
  if (payment === 'Unpaid') return 'to_pay';
  if (actions) return 'progress';
  return ['to_pay', 'progress', 'receive', 'completed'].includes(key(order.tab)) ? key(order.tab) : 'progress';
}

const findOrder = async (token: string) => (await db(`orders?public_token=eq.${encodeURIComponent(token)}&limit=1`))?.[0] || null;

async function shapeOrder(order: any) {
  const [items, components, shipments] = await Promise.all([
    db(`order_items?order_id=eq.${order.id}&order=updated_at.asc`).catch(() => []),
    db(`production_components?order_id=eq.${order.id}&order=updated_at.asc`).catch(() => []),
    db(`shipments?order_id=eq.${order.id}&order=updated_at.desc&limit=1`).catch(() => []),
  ]);
  const byItem: Record<string, any[]> = {};
  for (const component of components || []) {
    const itemId = text(component.order_item_id || component.item_id);
    if (itemId) (byItem[itemId] ||= []).push(component);
  }
  const delivery = text(order.delivery || order.delivery_method);
  const shapedItems = (items || []).map((item: any) => {
    let itemComponents = byItem[text(item.id)] || [];
    if (!itemComponents.length) {
      itemComponents = [{
        id: item.id,
        component_type: item.k || item.product_type,
        label: item.title,
        workflow: item.workflow,
        review_required: item.review_required,
        review_status: item.review_required ? 'pending' : 'not_required',
        preview_url: item.design_preview_url,
        legacy: true,
      }];
    }
    return {
      id: item.id,
      k: item.k || item.product_type || 'edible',
      title: item.title || 'Item',
      qty: Number(item.qty || 1),
      size: item.size || '',
      style: item.style || '',
      customText: item.custom_text || item.wording || '',
      price: Number(item.price || 0),
      workflow: customerWorkflow(item.workflow, delivery),
      reviewRequired: Boolean(item.review_required),
      previewUrl: item.design_preview_url || '',
      components: itemComponents.map((component: any) => ({
        id: component.id,
        type: component.component_type || item.k || item.product_type,
        label: component.label || item.title,
        workflow: component.customer_stage || customerWorkflow(component.workflow, delivery),
        customerLabel: component.customer_label || '',
        progressPercent: Number(component.progress_percent ?? 0),
        reviewRequired: Boolean(component.review_required),
        reviewStatus: component.review_status || (component.review_required ? 'pending' : 'not_required'),
        previewUrl: component.preview_url || item.design_preview_url || '',
        clickupTaskId: component.clickup_task_id || '',
        clickupStatus: component.clickup_status || '',
        lastSyncedAt: millis(component.last_synced_at),
        legacy: Boolean(component.legacy),
      })),
    };
  });
  const flat = shapedItems.flatMap((item: any) => item.components || []);
  const actions = flat.filter((component: any) => component.reviewRequired && component.workflow === 'Waiting Review').length;
  const payment = paymentLabel(order);
  const shipment = latest(shipments || []);
  const pickup = key(delivery).includes('pickup');
  const deliverySummary = pickup
    ? 'Pickup — Bandar Baru Pasir Puteh'
    : [order.delivery_address, order.delivery_postcode, order.delivery_city, order.delivery_state].filter(Boolean).join(', ') || delivery;
  return {
    id: order.order_id || order.order_no || order.id,
    orderToken: order.public_token,
    tab: historyTab(order, payment, shipment, actions),
    dateNeed: dateText(order.date_need),
    dateNeedRaw: order.date_need,
    created: dateText(order.created_at),
    total: Number(order.total || 0),
    payment,
    paymentStatus: order.payment_status || '',
    delivery,
    deliverySummary,
    deliveryName: order.delivery_name || '',
    deliveryPhone: order.delivery_phone || '',
    status: orderStatus(order, payment, flat, shipment, actions),
    actionCount: actions,
    tracking: shipment?.tracking_no || order.tracking || '',
    canCancel: payment === 'Unpaid' && !order.production_approved && !key(order.status).includes('cancel'),
    adminRemark: order.admin_remark || '',
    productionApproved: Boolean(order.production_approved),
    customerConfirmed: Boolean(order.customer_confirmed),
    items: shapedItems,
    dbId: order.id,
    customerToken: order.customer_token || '',
    adminStatus: order.admin_status || order.status || '',
  };
}

async function shipmentFor(order: any) {
  const [shipments, events] = await Promise.all([
    db(`shipments?order_id=eq.${order.id}&order=updated_at.desc&limit=1`).catch(() => []),
    db(`shipment_events?order_id=eq.${order.id}&order=event_time.desc`).catch(() => []),
  ]);
  const shipment = latest(shipments || []);
  return {
    tracking: text(shipment?.tracking_no || order.tracking),
    courier: text(shipment?.courier || shipment?.service_provider || order.courier || order.delivery),
    trackingLink: text(shipment?.tracking_link || order.tracking_link),
    connoteUrl: text(shipment?.connote_url || shipment?.thermal_connote_url || shipment?.awb_pdf_url || order.connote_url),
    status: text(shipment?.status || shipment?.normalized_status || order.shipment_status),
    statusGroup: text(shipment?.status_group || order.shipment_status_group),
    updatedAt: millis(shipment?.updated_at || order.shipment_updated_at),
    events: (events || []).map((event: any) => ({
      status: text(event.status || event.normalized_status),
      statusGroup: text(event.status_group),
      previousStatus: text(event.previous_status),
      event: text(event.event_name || event.description),
      eventTime: millis(event.event_time || event.created_at),
      location: text(event.location),
    })),
  };
}

async function reviewAction(order: any, componentId: string, requestEdit: boolean, comment = '') {
  const rows = await db(`production_components?id=eq.${encodeURIComponent(componentId)}&order_id=eq.${order.id}&limit=1`);
  const component = rows?.[0];
  if (!component) throw new Error('Component not found');
  if (!component.review_required || !component.preview_url) throw new Error('Design preview belum tersedia');
  const now = new Date().toISOString();
  const workflow = requestEdit ? 'Design Editing' : 'Approved';
  const reviewStatus = requestEdit ? 'edit_requested' : 'approved';
  await db(`production_components?id=eq.${component.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ workflow, review_status: reviewStatus, updated_at: now }),
  });
  await db('artwork_reviews', {
    method: 'POST',
    body: JSON.stringify({
      order_id: order.id,
      component_id: component.id,
      customer_id: order.customer_id || null,
      status: reviewStatus,
      comment,
      preview_url: component.preview_url,
      approved_at: requestEdit ? null : now,
      requested_edit_at: requestEdit ? now : null,
      created_at: now,
    }),
  }).catch(() => null);
}

Deno.serve(async (request) => {
  try {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (!url || !serviceRole) return fail('Supabase env missing', 500);
    const requestUrl = new URL(request.url);
    const path = requestUrl.pathname.replace(/^\/functions\/v1\/api/, '').replace(/^(?:\/api)+/, '') || '/';
    const body = () => request.json().catch(() => ({}));
    let match: RegExpMatchArray | null;

    if (request.method === 'GET' && path === '/supabase/status') {
      return output({ configured: true, projectRef: 'buivecgahhmrhlmfujgt', bridge: 'api', reachable: true });
    }

    match = path.match(/^\/orders\/([^/]+)$/);
    if (request.method === 'GET' && match) {
      const order = await findOrder(decodeURIComponent(match[1]));
      return order ? output({ order: await shapeOrder(order) }) : fail('Order not found', 404);
    }

    match = path.match(/^\/orders\/([^/]+)\/shipment$/);
    if (request.method === 'GET' && match) {
      const order = await findOrder(decodeURIComponent(match[1]));
      return order ? output({ shipment: await shipmentFor(order) }) : fail('Order not found', 404);
    }

    match = path.match(/^\/orders\/([^/]+)\/payment-session$/);
    if (request.method === 'POST' && match) {
      const payload = await body();
      return output({ payment: await rpc('icetak_prepare_payment', {
        p_order_token: decodeURIComponent(match[1]),
        p_force_new: Boolean(payload.force_new),
      }) });
    }

    match = path.match(/^\/orders\/([^/]+)\/components\/([^/]+)\/(approve|request-edit)$/);
    if (request.method === 'POST' && match) {
      const order = await findOrder(decodeURIComponent(match[1]));
      if (!order) return fail('Order not found', 404);
      const payload = await body();
      await reviewAction(order, decodeURIComponent(match[2]), match[3] === 'request-edit', text(payload.comment));
      return output({ ok: true, action: match[3] });
    }

    if (request.method === 'POST' && path === '/orders') {
      return output(await rpc('icetak_create_order', { payload: await body() }));
    }

    match = path.match(/^\/customers\/([^/]+)\/orders$/);
    if (request.method === 'GET' && match) {
      const token = decodeURIComponent(match[1]);
      let orders = await db(`orders?customer_token=eq.${encodeURIComponent(token)}&order=created_at.desc`);
      if (!orders?.length && /^[0-9a-f-]{36}$/i.test(token)) {
        orders = await db(`orders?customer_id=eq.${encodeURIComponent(token)}&order=created_at.desc`);
      }
      return output({ orders: await Promise.all((orders || []).map(shapeOrder)) });
    }

    match = path.match(/^\/orders\/([^/]+)\/cancel$/);
    if (request.method === 'POST' && match) {
      const order = await findOrder(decodeURIComponent(match[1]));
      if (!order) return fail('Order not found', 404);
      if (paymentLabel(order) !== 'Unpaid') return fail('Paid order cannot be cancelled', 409);
      if (order.production_approved) return fail('Order already in production', 409);
      if (key(order.status).includes('cancel')) return output({ ok: true, already_cancelled: true });
      await db(`orders?id=eq.${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'Cancelled', admin_status: 'Cancelled by Customer', tab: 'completed', updated_at: new Date().toISOString(),
        }),
      });
      return output({ ok: true });
    }

    match = path.match(/^\/order-confirmations\/([^/]+)$/);
    if (match) {
      const rows = await db(`orders?customer_confirm_token=eq.${encodeURIComponent(decodeURIComponent(match[1]))}&limit=1`);
      const order = rows?.[0];
      if (!order) return fail('Confirmation link not found', 404);
      if (request.method === 'GET') return output({ order: await shapeOrder(order) });
      if (request.method === 'POST') {
        if (order.customer_confirmed) return output({ ok: true, already_confirmed: true, order_id: order.order_id || order.order_no });
        await db(`orders?id=eq.${order.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            customer_confirmed: true,
            customer_confirmed_at: new Date().toISOString(),
            status: 'Customer Confirmed',
            admin_status: 'Customer Confirmed',
            tab: 'progress',
            updated_at: new Date().toISOString(),
          }),
        });
        return output({ ok: true, order_id: order.order_id || order.order_no });
      }
    }

    if (request.method === 'POST' && path === '/integrations/order-detail') {
      const payload = await body();
      const query = payload.order_token
        ? `public_token=eq.${encodeURIComponent(payload.order_token)}`
        : `order_id=eq.${encodeURIComponent(payload.order_id)}`;
      const rows = await db(`orders?${query}&limit=1`);
      return rows?.[0] ? output({ ok: true, order: await shapeOrder(rows[0]) }) : fail('Order not found', 404);
    }

    if (request.method === 'POST' && path === '/integrations/create-order') {
      const payload = await body();
      return output(await rpc('icetak_create_order', { payload: { ...payload, source: payload.source || 'external' } }));
    }

    return fail(`Not found: ${path}`, 404);
  } catch (error) {
    console.error('api error', error);
    return fail(error instanceof Error ? error.message : 'Server error', 500);
  }
});
