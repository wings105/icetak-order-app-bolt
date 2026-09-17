import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
};

type JsonObject = Record<string, unknown>;
type ForwardKind = "raw" | "order_id_phone";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
});

async function rest(path: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data?.message || data?.error || `REST ${response.status}`);
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

async function setting(key: string) {
  const rows = await rest(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&select=text_value,secret_value&limit=1`);
  return String(rows?.[0]?.secret_value || rows?.[0]?.text_value || "").trim();
}

async function privateSetting(key: string) {
  const rows = await rest(`private_runtime_settings?setting_key=eq.${encodeURIComponent(key)}&select=setting_value&limit=1`);
  return String(rows?.[0]?.setting_value || "").trim();
}

async function savePrivateSetting(key: string, value: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/private_runtime_settings?on_conflict=setting_key`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ setting_key: key, setting_value: value, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.message || data?.error || `REST ${response.status}`);
  }
}

function parseKind(value: unknown): ForwardKind | null {
  const kind = String(value || "raw").trim().toLowerCase();
  return kind === "raw" || kind === "order_id_phone" ? kind : null;
}

function validateWebhookUrl(url: string) {
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "Webhook URL tidak sah"; }
  return parsed.protocol === "https:" ? null : "Webhook URL mesti bermula dengan https://";
}

async function unifiedRequest(action: string, url: string | null = null) {
  const [bridgeTarget, bridgeToken] = await Promise.all([
    setting("unified_inbox_24h_url"),
    privateSetting("admin_window_bridge_token"),
  ]);
  if (!bridgeTarget || !bridgeToken) throw new Error("Unified Inbox bridge configuration missing");
  const endpoint = new URL(bridgeTarget);
  endpoint.pathname = "/functions/v1/webhook-forward-settings";
  endpoint.search = "";
  endpoint.hash = "";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-window-token": bridgeToken },
    body: JSON.stringify({ action, url }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `Unified Inbox ${response.status}`);
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "Runtime not configured" }, 500);

  try {
    const admin = await currentAdmin(req);
    if (!admin) return json({ ok: false, error: "Admin authentication required" }, 401);
    if (admin.role !== "owner" && !admin.permissions.includes("manage_admins")) {
      return json({ ok: false, error: "Manage Admins permission required" }, 403);
    }

    const body = await req.json().catch(() => ({})) as JsonObject;
    const action = String(body.action || "get").trim().toLowerCase();
    const kind = parseKind(body.kind);
    if (!kind) return json({ ok: false, error: "Webhook setting kind tidak sah" }, 400);

    if (action === "get") {
      if (kind === "raw") return json({ ...(await unifiedRequest("get")), kind });
      const url = await privateSetting("whatsapp_order_id_phone_webhook_url");
      return json({ ok: true, kind, url });
    }
    if (action !== "save") return json({ ok: false, error: "Valid action required" }, 400);

    const url = String(body.url || "").trim();
    const urlError = validateWebhookUrl(url);
    if (urlError) return json({ ok: false, error: urlError }, 400);

    if (kind === "raw") return json({ ...(await unifiedRequest("save", url)), kind });
    await savePrivateSetting("whatsapp_order_id_phone_webhook_url", url);
    return json({ ok: true, kind, url });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
