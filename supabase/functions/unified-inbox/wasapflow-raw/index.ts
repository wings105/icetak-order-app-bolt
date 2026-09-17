import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-wasapflow-event, x-wasapflow-waba-id, x-wasapflow-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
type JsonObject = Record<string, unknown>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});
const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function validSignature(rawBody: string, received: string | null, secret: string) {
  if (!received) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return safeEqual(`sha256=${hex(digest)}`.toLowerCase(), received.trim().toLowerCase());
}

async function forwardEvent(supabaseUrl: string, forwardSecret: string, rawBody: string, eventName: string, wabaId: string) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/wasapflow-ap-forward`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ap-forward-secret": forwardSecret, "x-wasapflow-event": eventName, "x-wasapflow-waba-id": wabaId },
      body: rawBody,
    });
    if (!response.ok) console.error("WasapFlow background processing failed", { status: response.status, eventName, response: (await response.text()).slice(0, 1000) });
  } catch (error) {
    console.error("WasapFlow background forwarding failed", { eventName, error: error instanceof Error ? error.message : String(error) });
  }
}

async function forwardAdminWindow(supabaseUrl: string, forwardSecret: string, rawBody: string, eventName: string) {
  if (eventName !== "message.received") return;
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/admin-window-bridge`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-ap-forward-secret": forwardSecret }, body: rawBody,
    });
    if (!response.ok) console.error("Admin window bridge failed", { status: response.status, response: (await response.text()).slice(0, 1000) });
  } catch (error) {
    console.error("Admin window bridge forwarding failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function forwardExternalWebhook(supabaseUrl: string, serviceRoleKey: string, rawBody: string) {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/private_runtime_settings?setting_key=eq.external_webhook_forward_url&select=setting_value&limit=1`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    if (!response.ok) throw new Error(`Unable to load external webhook URL (${response.status})`);
    const rows = await response.json().catch(() => []);
    const targetUrl = String(rows?.[0]?.setting_value || "").trim();
    if (!targetUrl) return;
    const forwarded = await fetch(targetUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: rawBody });
    if (!forwarded.ok) console.error("External raw webhook forwarding failed", { status: forwarded.status, response: (await forwarded.text()).slice(0, 1000) });
  } catch (error) {
    console.error("External raw webhook forwarding failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

function messageText(payload: JsonObject) {
  const data = object(payload.data);
  const message = object(object(data.raw).message);
  const interactive = object(message.interactive);
  return String(
    data.text || data.body || object(message.text).body || object(interactive.button_reply).title ||
    object(interactive.list_reply).title || object(message.button).text || "",
  ).trim();
}

function normalizePhone(value: unknown) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `60${digits.slice(1)}`;
  else if (digits.startsWith("1") && digits.length >= 9 && digits.length <= 10) digits = `60${digits}`;
  return /^\d{8,15}$/.test(digits) ? digits : "";
}

function inboundPhone(payload: JsonObject) {
  const data = object(payload.data);
  const raw = object(data.raw);
  const contacts = Array.isArray(raw.contacts) ? raw.contacts.map(object) : [];
  return normalizePhone(data.from || contacts[0]?.wa_id || object(raw.message).from);
}

function receivedAt(payload: JsonObject) {
  const data = object(payload.data);
  const value = data.timestamp || payload.timestamp;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
    : value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function extractOrderIds(text: string) {
  const matches = text.toUpperCase().matchAll(/(?:^|[^A-Z0-9])([0-9]{6}(?=[A-Z0-9]{0,7}[A-Z])[A-Z0-9]{8})(?=$|[^A-Z0-9])/g);
  return [...new Set([...matches].map((match) => match[1]))];
}

async function forwardOrderIdEvent(supabaseUrl: string, serviceRoleKey: string, payload: JsonObject, eventName: string) {
  if (eventName !== "message.received") return;
  const text = messageText(payload);
  const orderIds = extractOrderIds(text);
  const phone = inboundPhone(payload);
  if (!orderIds.length || !phone) return;

  try {
    const settingsResponse = await fetch(
      `${supabaseUrl}/rest/v1/private_runtime_settings?setting_key=in.(admin_window_bridge_target,admin_window_bridge_token)&select=setting_key,setting_value`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } },
    );
    if (!settingsResponse.ok) throw new Error(`Unable to load Order System bridge settings (${settingsResponse.status})`);
    const rows = await settingsResponse.json().catch(() => []);
    const settings = Object.fromEntries(rows.map((row: JsonObject) => [String(row.setting_key), String(row.setting_value || "")]));
    const bridgeTarget = String(settings.admin_window_bridge_target || "").trim();
    const bridgeToken = String(settings.admin_window_bridge_token || "").trim();
    if (!bridgeTarget || !bridgeToken) throw new Error("Order System bridge configuration missing");

    const endpoint = new URL(bridgeTarget);
    endpoint.pathname = "/functions/v1/whatsapp-order-id-forward";
    endpoint.search = "";
    endpoint.hash = "";
    const data = object(payload.data);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-window-token": bridgeToken },
      body: JSON.stringify({
        order_ids: orderIds,
        phone,
        message_id: data.message_id || data.id || null,
        message_text: text,
        received_at: receivedAt(payload),
      }),
    });
    if (!response.ok) console.error("Order ID bridge failed", { status: response.status, response: (await response.text()).slice(0, 1000) });
  } catch (error) {
    console.error("Order ID bridge failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const forwardSecret = Deno.env.get("AP_FORWARD_SECRET");
  const webhookSecret = Deno.env.get("WASAPFLOW_WEBHOOK_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !forwardSecret) return json({ error: "Forwarding configuration missing" }, 500);

  const rawBody = await req.text();
  if (!rawBody) return json({ error: "Empty body" }, 400);
  if (webhookSecret && !await validSignature(rawBody, req.headers.get("x-wasapflow-signature"), webhookSecret)) return json({ error: "Invalid x-wasapflow-signature." }, 401);

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody);
    if (typeof decoded === "string") decoded = JSON.parse(decoded);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const payload = object(decoded);
  const eventName = String(req.headers.get("x-wasapflow-event") || payload.event || "").trim().toLowerCase();
  const wabaId = String(req.headers.get("x-wasapflow-waba-id") || payload.waba_id || "");

  EdgeRuntime.waitUntil(Promise.allSettled([
    forwardEvent(supabaseUrl, forwardSecret, rawBody, eventName, wabaId),
    forwardAdminWindow(supabaseUrl, forwardSecret, rawBody, eventName),
    forwardExternalWebhook(supabaseUrl, serviceRoleKey, rawBody),
    forwardOrderIdEvent(supabaseUrl, serviceRoleKey, payload, eventName),
  ]));
  return json({ ok: true, accepted: true, event: eventName });
});
