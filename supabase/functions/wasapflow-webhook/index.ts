import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "content-type,x-wasapflow-signature,x-wasapflow-event" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } }); }
function normalizePhone(phone: string) { const v = String(phone || "").replace(/\D/g, ""); if (!v) return ""; if (v.startsWith("60")) return v; if (v.startsWith("0")) return `6${v}`; if (v.startsWith("1")) return `60${v}`; return v; }

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) } });
  return response.json().catch(() => null);
}

async function getOrCreateContact(phone: string, name = "") {
  const normalizedPhone = normalizePhone(phone);
  let rows = await rest(`whatsapp_contacts?normalized_phone=eq.${encodeURIComponent(normalizedPhone)}&limit=1`) || [];
  if (rows?.[0]) return rows[0];
  rows = await rest("whatsapp_contacts", { method: "POST", body: JSON.stringify({ phone: normalizedPhone, normalized_phone: normalizedPhone, name, source: "wasapflow" }) }) || [];
  return rows?.[0];
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const payload = await req.json().catch(() => ({}));
    const event = payload.event || req.headers.get("x-wasapflow-event") || "unknown";
    const data = payload.data || {};
    const now = new Date().toISOString();

    if (event === "message.received") {
      const phone = normalizePhone(data.from || "");
      if (phone) {
        const contact = await getOrCreateContact(phone, data.contact_name || "");
        await rest(`whatsapp_contacts?id=eq.${contact.id}`, {
          method: "PATCH",
          body: JSON.stringify({ bsuid: data.bsuid || contact.bsuid || null, last_message_at: now, last_inbound_at: now, window_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), window_status: "open", unread_count: (contact.unread_count || 0) + 1 }),
        });
        await rest("whatsapp_messages", {
          method: "POST",
          body: JSON.stringify({ contact_id: contact.id, direction: "inbound", message_type: data.type || "text", body: data.text || "", provider_message_id: data.message_id || null, raw_payload: payload, event_type: event, status: "received" }),
        });
      }
    }

    if (["message.sent", "message.delivered", "message.read", "message.failed"].includes(event) && data.message_id) {
      const status = data.status || event.replace("message.", "");
      const patch: Record<string, unknown> = { status, updated_at: now, raw_payload: payload };
      if (event === "message.delivered") patch.delivered_at = now;
      if (event === "message.read") patch.read_at = now;
      await rest(`whatsapp_messages?provider_message_id=eq.${encodeURIComponent(data.message_id)}`, { method: "PATCH", body: JSON.stringify(patch) });
      await rest(`whatsapp_outbox?provider_message_id=eq.${encodeURIComponent(data.message_id)}`, { method: "PATCH", body: JSON.stringify({ status, response_payload: payload, error_message: data.errors ? JSON.stringify(data.errors) : null }) });
    }

    return json({ ok: true, event });
  } catch (err) {
    return json({ ok: false, error: err?.message || "Server error" }, 500);
  }
});
