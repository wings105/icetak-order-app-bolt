import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
};

type JsonObject = Record<string, unknown>;

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
    if (action === "get") return json(await unifiedRequest("get"));
    if (action !== "save") return json({ ok: false, error: "Valid action required" }, 400);

    const url = String(body.url || "").trim();
    if (url) {
      let parsed: URL;
      try { parsed = new URL(url); } catch { return json({ ok: false, error: "Webhook URL tidak sah" }, 400); }
      if (parsed.protocol !== "https:") return json({ ok: false, error: "Webhook URL mesti bermula dengan https://" }, 400);
    }
    return json(await unifiedRequest("save", url));
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
