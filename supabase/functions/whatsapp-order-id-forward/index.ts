import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-admin-window-token",
};
const SETTING_KEY = "whatsapp_order_id_phone_webhook_url";
const ORDER_ID = /^[0-9]{6}(?=[A-Z0-9]{0,7}[A-Z])[A-Z0-9]{8}$/;
type JsonObject = Record<string, unknown>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
});

function normalizePhone(value: unknown) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `60${digits.slice(1)}`;
  else if (digits.startsWith("1") && digits.length >= 9 && digits.length <= 10) digits = `60${digits}`;
  return /^\d{8,15}$/.test(digits) ? digits : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Runtime not configured" }, 500);
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: tokenRow } = await db.from("private_runtime_settings")
    .select("setting_value").eq("setting_key", "admin_window_bridge_token").maybeSingle();
  const expectedToken = String(tokenRow?.setting_value || "");
  if (!expectedToken || req.headers.get("x-admin-window-token") !== expectedToken) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({})) as JsonObject;
  const phone = normalizePhone(body.phone);
  const candidates = Array.isArray(body.order_ids) ? body.order_ids : [body.order_id];
  const orderIds = [...new Set(candidates.map((value) => String(value || "").trim().toUpperCase()).filter((value) => ORDER_ID.test(value)))];
  if (!phone) return json({ ok: true, forwarded: false, reason: "phone_missing" });
  if (!orderIds.length) return json({ ok: true, forwarded: false, reason: "order_id_missing" });

  const { data: urlRow, error: urlError } = await db.from("private_runtime_settings")
    .select("setting_value").eq("setting_key", SETTING_KEY).maybeSingle();
  if (urlError) return json({ ok: false, error: urlError.message }, 500);
  const targetUrl = String(urlRow?.setting_value || "").trim();
  if (!targetUrl) return json({ ok: true, forwarded: false, reason: "not_configured" });

  const messageId = String(body.message_id || body.provider_message_id || "").trim();
  const basePayload = {
    phone,
    message_id: messageId || null,
    conversation_id: body.conversation_id || null,
    message_text: body.message_text || null,
    received_at: body.received_at || new Date().toISOString(),
    source: "icetak-unified-inbox",
  };

  const results = await Promise.all(orderIds.map(async (orderId) => {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...basePayload,
        order_id: orderId,
        idempotency_key: `${messageId || "no-message-id"}:${orderId}`,
      }),
    });
    const responseText = await response.text().catch(() => "");
    if (!response.ok) {
      console.error("Order ID webhook failed", { orderId, status: response.status, response: responseText.slice(0, 500) });
      return { order_id: orderId, ok: false, status: response.status };
    }
    return { order_id: orderId, ok: true, status: response.status };
  }));

  const failed = results.filter((result) => !result.ok);
  return json({ ok: failed.length === 0, forwarded: failed.length === 0, phone, results }, failed.length ? 502 : 200);
});
