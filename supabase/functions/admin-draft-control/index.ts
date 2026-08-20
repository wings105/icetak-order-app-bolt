import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
};

type JsonObject = Record<string, unknown>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function rest(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error(data?.message || data?.error || `REST ${r.status}`);
  return data;
}

async function rpc(name: string, body: JsonObject) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.message || data?.error || `RPC ${name} ${r.status}`);
  return data;
}

async function currentAdmin(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const auth = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${token}` },
  });
  const user = await auth.json().catch(() => null);
  if (!auth.ok || !user?.id) return null;
  const admins = await rest(`admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=username,role&limit=1`);
  const admin = admins?.[0];
  if (!admin?.username) return null;
  const rows = await rest(`admin_permissions?username=eq.${encodeURIComponent(admin.username)}&select=permissions&limit=1`);
  const permissions = Array.isArray(rows?.[0]?.permissions) ? rows[0].permissions.map(String) : [];
  return { username: String(admin.username), role: String(admin.role || "staff"), permissions };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ success: false, error: "Runtime not configured" }, 500);

  try {
    const admin = await currentAdmin(req);
    if (!admin) return json({ success: false, error: "Admin authentication required" }, 401);
    const canCreate = admin.permissions.includes("create_order");
    const canEdit = admin.permissions.includes("edit_order") || admin.permissions.includes("approve_production");
    const body = await req.json().catch(() => ({})) as JsonObject;
    const action = String(body.action || "").trim();

    if (action === "create_manual") {
      if (!canCreate) return json({ success: false, error: "Create Order permission required" }, 403);
      const customerName = String(body.customer_name || "").trim();
      const customerPhone = String(body.customer_phone || "").trim();
      const dateNeed = String(body.date_need || "").trim();
      const delivery = String(body.delivery || "unknown").trim().toLowerCase();
      const paymentMode = String(body.payment_mode || "prepaid").trim().toLowerCase();
      if (customerName.length > 200 || customerPhone.length > 30) return json({ success: false, error: "Customer details are too long" }, 400);
      if (dateNeed && !/^\d{4}-\d{2}-\d{2}$/.test(dateNeed)) return json({ success: false, error: "Invalid Date Need" }, 400);
      if (!["unknown","pickup","spx","jnt","ninja"].includes(delivery)) return json({ success: false, error: "Invalid delivery" }, 400);
      if (!["prepaid","cash_counter"].includes(paymentMode)) return json({ success: false, error: "Invalid payment flow" }, 400);
      if (paymentMode === "cash_counter" && !["pickup","unknown"].includes(delivery)) return json({ success: false, error: "Cash at Counter is only available for Pickup" }, 400);
      const data = await rpc("icetak_admin_create_manual_order_draft", {
        p_customer_name: customerName || null,
        p_customer_phone: customerPhone || null,
        p_date_need: dateNeed || null,
        p_delivery: delivery,
        p_payment_mode: paymentMode,
        p_actor: admin.username,
      });
      return json({ success: true, data });
    }

    if (action === "set_flow") {
      if (!canEdit) return json({ success: false, error: "Edit Order permission required" }, 403);
      const reviewToken = String(body.review_token || "").trim();
      const delivery = String(body.delivery || "").trim().toLowerCase();
      const paymentMode = String(body.payment_mode || "").trim().toLowerCase();
      if (!/^qrd_[a-f0-9]{32}$/i.test(reviewToken)) return json({ success: false, error: "Valid draft is required" }, 400);
      if (!["pickup","spx","jnt","ninja"].includes(delivery)) return json({ success: false, error: "Shipping / Pickup required" }, 400);
      if (!["prepaid","cash_counter"].includes(paymentMode)) return json({ success: false, error: "Invalid payment flow" }, 400);
      const data = await rpc("icetak_admin_set_draft_flow", {
        p_review_token: reviewToken,
        p_delivery: delivery,
        p_payment_mode: paymentMode,
        p_actor: admin.username,
      });
      return json({ success: true, data });
    }

    return json({ success: false, error: "Unknown action" }, 400);
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
