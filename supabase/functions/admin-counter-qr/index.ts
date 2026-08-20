import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });
const text = (v: unknown) => String(v ?? "").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!URL || !ANON || !SERVICE) return json({ ok: false, error: "Runtime not configured" }, 500);

  const authorization = req.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return json({ ok: false, error: "Admin authentication required" }, 401);

  const userDb = createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const serviceDb = createClient(URL, SERVICE, { auth: { persistSession: false } });

  try {
    const { data: userData, error: userError } = await userDb.auth.getUser();
    if (userError || !userData?.user?.id) return json({ ok: false, error: "Admin authentication required" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = text(body.action || "prepare").toLowerCase();
    const orderRef = text(body.order_ref || body.order_id);
    if (!orderRef) return json({ ok: false, error: "Order reference required" }, 400);

    let query = serviceDb.from("orders").select("id,order_no,order_id");
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(orderRef)) query = query.eq("id", orderRef);
    else query = query.or(`order_no.eq.${orderRef},order_id.eq.${orderRef}`);
    const { data: order, error: orderError } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (orderError) throw orderError;
    if (!order?.id) return json({ ok: false, error: "Order not found" }, 404);

    const rpcName = action === "status" ? "icetak_admin_counter_qr_status" : "icetak_admin_prepare_counter_qr";
    const { data, error } = await userDb.rpc(rpcName, { p_order_id: order.id });
    if (error) return json({ ok: false, error: error.message }, 400);
    return json({ ok: true, data });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
