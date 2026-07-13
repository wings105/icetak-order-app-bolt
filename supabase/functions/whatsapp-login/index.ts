import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "content-type,authorization,apikey" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });
function normalizePhone(phone: string) { const v = String(phone || "").replace(/\D/g, ""); return v.startsWith("60") ? v : v.startsWith("0") ? `6${v}` : v.startsWith("1") ? `60${v}` : v; }
async function sha256(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function rest(path: string, init: RequestInit = {}) { const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) } }); const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`); return data; }
async function setting(key: string) { const rows = await rest(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => []); const row = rows?.[0]; return row?.secret_value || row?.text_value || row?.value?.url || ""; }
async function sendLoginMessage(phone: string, customerName: string, otp: string, magicLink: string) { const response = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE_ROLE_KEY}` }, body: JSON.stringify({ phone, event_type: "customer_login", vars: { customer_name: customerName, otp_code: otp, otp, magic_link: magicLink, expiry_minutes: "10" }, source: "whatsapp-login", idempotency_key: `login:${phone}:${Date.now()}` }) }); const data = await response.json().catch(() => ({})); if (!response.ok || data.ok === false) throw new Error(data.error || `WhatsApp send failed (${response.status})`); return data; }

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
    const path = new URL(req.url).pathname.replace(/^\/functions\/v1\/whatsapp-login/, "").replace(/^\/whatsapp-login/, "") || "/";
    const body = await req.json().catch(() => ({}));
    if (path === "/request") {
      const phone = normalizePhone(body.phone || body.to || "");
      if (!/^601\d{8,9}$/.test(phone)) return json({ ok: false, error: "Nombor WhatsApp Malaysia tidak sah" }, 400);
      const recent = await rest(`customer_login_otps?phone=eq.${phone}&status=eq.pending&created_at=gt.${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}&limit=1`).catch(() => []);
      if (recent?.length) return json({ ok: false, error: "Tunggu 60 saat sebelum minta kod baru" }, 429);
      const attempts = await rest(`customer_login_otps?phone=eq.${phone}&created_at=gt.${encodeURIComponent(new Date(Date.now() - 15 * 60000).toISOString())}&select=id`).catch(() => []);
      if ((attempts || []).length >= 5) return json({ ok: false, error: "Terlalu banyak cubaan. Cuba semula selepas 15 minit" }, 429);
      const customers = await rest(`customers?or=(phone.eq.${encodeURIComponent(phone)},phone.eq.${encodeURIComponent("+" + phone)})&limit=1`).catch(() => []);
      const customer = customers?.[0];
      if (!customer?.public_token) return json({ ok: false, error: "Nombor tidak dijumpai dalam rekod order" }, 404);
      await rest(`customer_login_otps?phone=eq.${phone}&status=eq.pending`, { method: "PATCH", body: JSON.stringify({ status: "replaced" }) }).catch(() => null);
      const random = new Uint32Array(1); crypto.getRandomValues(random);
      const otp = String(100000 + (random[0] % 900000));
      const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      const baseUrl = (await setting("customer_app_base_url")) || "https://icetak.bolt.host";
      const magicLink = `${baseUrl.replace(/\/$/, "")}/?magic_token=${token}`;
      await rest("customer_login_otps", { method: "POST", body: JSON.stringify({ customer_id: customer.id, customer_token: customer.public_token, phone, code_hash: await sha256(otp), magic_token_hash: await sha256(token), purpose: "login", status: "pending", attempts: 0, expires_at: new Date(Date.now() + 600000).toISOString() }) });
      const sent = await sendLoginMessage(phone, body.customer_name || customer.name || "Customer", otp, magicLink);
      return json({ ok: true, phone, sent: true, mode: sent.mode, expires_in_seconds: 600 });
    }
    if (path === "/verify") {
      const phone = normalizePhone(body.phone || ""); const code = String(body.otp || body.code || "").trim(); const token = String(body.token || "").trim();
      if (!code && !token) return json({ ok: false, error: "otp or token required" }, 400);
      let row: any = null;
      if (token) { const rows = await rest(`customer_login_otps?magic_token_hash=eq.${await sha256(token)}&status=eq.pending&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=created_at.desc&limit=1`); row = rows?.[0]; }
      else { const rows = await rest(`customer_login_otps?phone=eq.${phone}&status=eq.pending&order=created_at.desc&limit=1`); row = rows?.[0]; if (!row || new Date(row.expires_at).getTime() <= Date.now()) return json({ ok: false, error: "Kod tamat tempoh" }, 401); if (Number(row.attempts || 0) >= 5) return json({ ok: false, error: "Terlalu banyak cubaan" }, 429); if (row.code_hash !== await sha256(code)) { const count = Number(row.attempts || 0) + 1; await rest(`customer_login_otps?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ attempts: count, status: count >= 5 ? "blocked" : "pending" }) }); return json({ ok: false, error: "Kod OTP tidak sah", attempts_remaining: Math.max(0, 5 - count) }, 401); } }
      if (!row) return json({ ok: false, error: "Link atau kod tidak sah" }, 401);
      await rest(`customer_login_otps?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ status: "used", used_at: new Date().toISOString() }) });
      return json({ ok: true, customer_token: row.customer_token, phone: row.phone });
    }
    return json({ ok: false, error: `Not found: ${path}` }, 404);
  } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500); }
});
