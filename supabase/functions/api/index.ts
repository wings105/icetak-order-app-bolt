import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-client-info, apikey, x-api-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function error(message: string, status = 400) {
  return json({ error: message }, status);
}

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  return data;
}

async function rpc(functionName: string, args: Record<string, unknown>) {
  return rest(`rpc/${functionName}`, { method: "POST", body: JSON.stringify(args) });
}

function fmtDate(value: unknown) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(String(value)));
}

async function shapeOrder(order: any) {
  const items = await rest(`order_items?order_id=eq.${order.id}&order=created_at.asc`).catch(() => []);
  const components = await rest(`production_components?order_id=eq.${order.id}&order=created_at.asc`).catch(() => []);
  const byItem: Record<string, any[]> = {};
  for (const component of components || []) {
    const key = component.order_item_id || component.item_id;
    byItem[key] = byItem[key] || [];
    byItem[key].push(component);
  }

  const shapedItems = (items || []).map((item: any) => ({
    id: item.id,
    k: item.k || item.product_type,
    title: item.title,
    qty: item.qty || 1,
    size: item.size || "",
    style: item.style || "",
    customText: item.custom_text || item.wording || "",
    price: Number(item.price || 0),
    workflow: item.workflow || "Order Received",
    reviewRequired: Boolean(item.review_required),
    previewUrl: item.design_preview_url || "",
    components: (byItem[item.id] || []).map((component: any) => ({
      id: component.id,
      type: component.component_type,
      label: component.label,
      workflow: component.workflow,
      reviewRequired: Boolean(component.review_required),
      reviewStatus: component.review_status,
      previewUrl: component.preview_url || "",
      clickupTaskId: component.clickup_task_id || "",
      clickupStatus: component.clickup_status || "",
      lastSyncedAt: component.last_synced_at ? new Date(component.last_synced_at).getTime() : 0,
    })),
  }));

  const delivery = order.delivery || order.delivery_method || "";
  const deliverySummary = delivery === "Pickup"
    ? "Pickup — Bandar Baru Pasir Puteh"
    : [order.delivery_address, order.delivery_postcode, order.delivery_city, order.delivery_state].filter(Boolean).join(", ") || delivery;

  return {
    id: order.order_id || order.order_no,
    orderToken: order.public_token,
    tab: order.tab,
    dateNeed: fmtDate(order.date_need),
    dateNeedRaw: order.date_need,
    created: fmtDate(order.created_at),
    total: Number(order.total || 0),
    payment: order.payment || (String(order.payment_status).toLowerCase() === "paid" ? "Paid" : "Unpaid"),
    paymentStatus: order.payment_status,
    delivery,
    deliverySummary,
    deliveryName: order.delivery_name || "",
    deliveryPhone: order.delivery_phone || "",
    status: order.status || "",
    tracking: order.tracking || "",
    canCancel: (order.payment || "Unpaid") === "Unpaid" && !order.production_approved && order.status !== "Cancelled",
    adminRemark: order.admin_remark || "",
    productionApproved: Boolean(order.production_approved),
    customerConfirmed: Boolean(order.customer_confirmed),
    items: shapedItems,
    dbId: order.id,
    customerToken: order.customer_token || "",
    adminStatus: order.admin_status || order.status,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return error("Supabase env missing", 500);

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/functions\/v1\/api/, "").replace(/^\/api/, "") || "/";
    const readBody = async () => req.json().catch(() => ({}));

    if (req.method === "GET" && path === "/supabase/status") {
      return json({ configured: true, projectRef: "buivecgahhmrhlmfujgt", bridge: "api", reachable: true });
    }

    if (req.method === "GET" && path === "/migration/appdeploy-counts") {
      const counts = await rpc("icetak_table_counts", {});
      return json({ ok: true, source: "supabase", counts: Object.fromEntries((counts || []).map((row: any) => [row.table_name, row.row_count])) });
    }

    let match = path.match(/^\/orders\/([^/]+)$/);
    if (req.method === "GET" && match) {
      const rows = await rest(`orders?public_token=eq.${encodeURIComponent(match[1])}&limit=1`);
      if (!rows?.[0]) return error("Order not found", 404);
      return json({ order: await shapeOrder(rows[0]) });
    }

    if (req.method === "POST" && path === "/orders") {
      return json(await rpc("icetak_create_order", { payload: await readBody() }));
    }

    match = path.match(/^\/customers\/([^/]+)\/orders$/);
    if (req.method === "GET" && match) {
      const rows = await rest(`orders?customer_token=eq.${encodeURIComponent(match[1])}&order=created_at.desc`);
      return json({ orders: await Promise.all((rows || []).map(shapeOrder)) });
    }

    match = path.match(/^\/customers\/([^/]+)\/profile$/);
    if (req.method === "GET" && match) {
      const rows = await rest(`customers?public_token=eq.${encodeURIComponent(match[1])}&limit=1`);
      const customer = rows?.[0];
      if (!customer) return error("Customer not found", 404);
      return json({ customer: { name: customer.name, phone: customer.phone, address_line1: "", city: "", postcode: "", state: "", address_masked: "" } });
    }

    match = path.match(/^\/orders\/([^/]+)\/cancel$/);
    if (req.method === "POST" && match) {
      const rows = await rest(`orders?public_token=eq.${encodeURIComponent(match[1])}&limit=1`);
      const order = rows?.[0];
      if (!order) return error("Order not found", 404);
      if ((order.payment || "Unpaid") !== "Unpaid") return error("Paid order cannot be cancelled", 409);
      await rest(`orders?id=eq.${order.id}`, { method: "PATCH", body: JSON.stringify({ status: "Cancelled", admin_status: "Cancelled by Customer", tab: "completed" }) });
      return json({ ok: true });
    }

    if (req.method === "POST" && path === "/integrations/order-detail") {
      const body = await readBody();
      const query = body.order_token ? `public_token=eq.${encodeURIComponent(body.order_token)}` : `order_id=eq.${encodeURIComponent(body.order_id)}`;
      const rows = await rest(`orders?${query}&limit=1`);
      if (!rows?.[0]) return error("Order not found", 404);
      return json({ ok: true, order: await shapeOrder(rows[0]) });
    }

    if (req.method === "POST" && path === "/integrations/create-order") {
      const body = await readBody();
      return json(await rpc("icetak_create_order", { payload: { ...body, source: body.source || "external" } }));
    }

    return error(`Not found: ${path}`, 404);
  } catch (err) {
    return error(err?.message || "Server error", 500);
  }
});
