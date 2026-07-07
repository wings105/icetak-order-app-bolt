import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "content-type,authorization,apikey" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } }); }
function error(message: string, status = 400) { return json({ ok: false, error: message }, status); }
function normalizePhone(phone: string) { const v = String(phone || "").replace(/\D/g, ""); if (!v) return ""; if (v.startsWith("60")) return v; if (v.startsWith("0")) return `6${v}`; if (v.startsWith("1")) return `60${v}`; return v; }
function render(template: string, vars: Record<string, unknown>) { return String(template || "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => String(vars?.[key] ?? "")); }

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  return data;
}
async function rpc(fn: string, args: Record<string, unknown>) { return rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }); }
async function setting(key: string) { const rows = await rest(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => []); const row = rows?.[0]; return row?.secret_value || row?.text_value || row?.value?.url || ""; }
async function creds() { return { baseUrl: (await setting("base_url")) || "https://officialapi.wasapflow.com/bridge/v1", partnerKey: await setting("partner_key"), wabaId: await setting("waba_id") }; }

async function wasapflow(path: string, body: unknown) {
  const c = await creds();
  if (!c.partnerKey || !c.wabaId) throw new Error("WasapFlow partner_key atau waba_id belum diisi");
  const response = await fetch(`${c.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-partner-key": c.partnerKey, "x-waba-id": c.wabaId }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data?.error?.message || `WasapFlow HTTP ${response.status}`);
  return data;
}

async function logMessage(phone: string, payload: any, response: any, meta: any) {
  await rest("whatsapp_outbox", {
    method: "POST",
    body: JSON.stringify({
      phone,
      customer_name: meta.customer_name || null,
      event_type: meta.event_type || null,
      order_no: meta.order_no || null,
      order_token: meta.order_token || null,
      message_type: meta.mode === "template" ? "template" : "text",
      body: payload.text || null,
      template_name: payload.template?.name || null,
      template_language: payload.template?.language || null,
      template_components: payload.template?.components || null,
      status: "sent",
      provider_message_id: response.message_id,
      request_payload: payload,
      response_payload: response,
      source: meta.source || "manual",
      sent_at: new Date().toISOString(),
    }),
  }).catch(() => null);
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return error("Method not allowed", 405);
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhone(body.phone || body.to || "");
    if (!phone) return error("phone required");

    const eventType = body.event_type || "manual";
    const rule = (await rest(`whatsapp_notification_rules?event_type=eq.${encodeURIComponent(eventType)}&limit=1`).catch(() => []))?.[0];
    const window = await rpc("icetak_whatsapp_window", { p_phone: phone }).catch(() => ({ can_send_freeform: false }));
    const canFreeform = Boolean(window?.can_send_freeform);
    const mode = body.mode || (canFreeform ? "text" : "template");

    if (mode === "text") {
      const text = body.text || render(rule?.freeform_text || "", body.vars || body);
      const payload = { to: phone, text, preview_url: false };
      const response = await wasapflow("/messages/send", payload);
      await logMessage(phone, payload, response, { ...body, event_type: eventType, mode: "text" });
      return json({ ok: true, mode: "text", can_send_freeform: canFreeform, to: phone, message_id: response.message_id });
    }

    const templateName = body.template_name || rule?.template_name;
    if (!templateName) return error("template_name required");
    const keys = body.template_params || rule?.template_params || [];
    const params = Array.isArray(keys) ? keys.map((key: string) => ({ type: "text", text: String((body.vars || body)?.[key] ?? "") })) : [];
    const payload = { to: phone, template: { name: templateName, language: body.template_language || rule?.template_language || "ms", components: params.length ? [{ type: "body", parameters: params }] : [] } };
    const response = await wasapflow("/messages/template", payload);
    await logMessage(phone, payload, response, { ...body, event_type: eventType, mode: "template" });
    return json({ ok: true, mode: "template", can_send_freeform: canFreeform, to: phone, message_id: response.message_id });
  } catch (err) {
    return error(err?.message || "Server error", 500);
  }
});
