import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "content-type,authorization,apikey" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } }); }
function error(message: string, status = 400) { return json({ ok: false, error: message }, status); }
function normalizePhone(phone: string) { const v = String(phone || "").replace(/\D/g, ""); if (!v) return ""; if (v.startsWith("60")) return v; if (v.startsWith("0")) return `6${v}`; if (v.startsWith("1")) return `60${v}`; return v; }
async function sha256(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  return data;
}
async function setting(key: string) { const rows = await rest(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => []); const row = rows?.[0]; return row?.secret_value || row?.text_value || row?.value?.url || ""; }

async function sendLoginMessage(phone: string, customerName: string, otp: string, magicLink: string) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ phone, event_type: "customer_login", customer_name: customerName, vars: { customer_name: customerName, otp, magic_link: magicLink }, source: "whatsapp-login" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `WhatsApp send failed (${response.status})`);
  return data;
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return error("Method not allowed", 405);
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/functions\/v1\/whatsapp-login/, "").replace(/^\/whatsapp-login/, "") || "/";
    const body = await req.json().catch(() => ({}));

    if (path === "/request") {
      const phone = normalizePhone(body.phone || body.to || "");
      if (!phone) return error("phone required");
      const cooldown = new Date(Date.now() - 60_000).toISOString();
      const recent = await rest(`customer_login_otps?phone=eq.${phone}&status=eq.pending&created_at=gt.${encodeURIComponent(cooldown)}&limit=1`).catch(() => []);
      if (recent?.length) return error("Tunggu 60 saat sebelum minta kod baru", 429);

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      const customers = await rest(`customers?phone=eq.${phone}&limit=1`).catch(() => []);
      const customer = customers?.[0] || {};
      const baseUrl = (await setting("customer_app_base_url")) || "https://decocake.my";
      const magicLink = `${baseUrl.replace(/\/$/, "")}/login?token=${token}`;

      await rest("customer_login_otps", {
        method: "POST",
        body: JSON.stringify({ customer_id: customer.id || null, customer_token: customer.public_token || null, phone, code_hash: await sha256(otp), magic_token_hash: await sha256(token), purpose: "login", status: "pending", expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }),
      });

      const customerName = body.customer_name || customer.name || "customer";
      await sendLoginMessage(phone, customerName, otp, magicLink);
      return json({ ok: true, phone, sent: true, expires_in_seconds: 600 });
    }

    if (path === "/verify") {
      const phone = normalizePhone(body.phone || "");
      const code = String(body.otp || body.code || "");
      const token = String(body.token || "");
      if (!code && !token) return error("otp or token required");
      const hash = await sha256(code || token);
      const query = code ? `phone=eq.${phone}&code_hash=eq.${hash}&status=eq.pending&expires_at=gt.${new Date().toISOString()}&limit=1` : `magic_token_hash=eq.${hash}&status=eq.pending&expires_at=gt.${new Date().toISOString()}&limit=1`;
      const rows = await rest(`customer_login_otps?${query}`);
      if (!rows?.[0]) return error("invalid_or_expired", 401);
      await rest(`customer_login_otps?id=eq.${rows[0].id}`, { method: "PATCH", body: JSON.stringify({ status: "used", used_at: new Date().toISOString() }) });
      return json({ ok: true, customer_token: rows[0].customer_token, phone: rows[0].phone });
    }

    return error(`Not found: ${path}`, 404);
  } catch (err) {
    return error(err?.message || "Server error", 500);
  }
});
