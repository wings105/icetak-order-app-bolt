import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-client-info, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const ALL_PERMISSIONS = [
  "view_orders",
  "create_order",
  "mark_paid",
  "approve_cash",
  "cancel_order",
  "edit_order",
  "approve_production",
  "manage_permissions",
  "open_whatsapp",
  "export_data",
];

const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  admin1: ALL_PERMISSIONS,
  admin2: ["view_orders", "create_order", "mark_paid", "approve_cash", "edit_order", "approve_production", "open_whatsapp"],
  admin3: ["view_orders", "open_whatsapp"],
};

const PASSWORD_HASHES: Record<string, string> = {
  admin1: "f24c9d70bf705e12b01d142823ca8a6d1f9e757486151ab5226e3e6a262bb0de",
  admin2: "8fdff8a1d00401f26e14b945980b3e6f5868a899fb3ac2621795f4fa3bcd81b6",
  admin3: "48bd0e9d7f6a1413002e76d8908bd678810dcd54ebe67023ee9fe3b38c1e93c2",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function error(message: string, status = 400) {
  return json({ error: message }, status);
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  return data;
}

async function permissionsFor(username: string) {
  const rows = await rest(`admin_permissions?username=eq.${encodeURIComponent(username)}&limit=1`).catch(() => []);
  return rows?.[0]?.permissions?.length ? rows[0].permissions : DEFAULT_PERMISSIONS[username] || [];
}

async function sessionFor(token: string) {
  const rows = await rest(`admin_sessions?token=eq.${encodeURIComponent(token)}&limit=1`).catch(() => []);
  const session = rows?.[0];
  if (!session || new Date(session.expires_at).getTime() < Date.now()) return null;
  return { username: session.username, permissions: await permissionsFor(session.username) };
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return error("Method not allowed", 405);

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/functions\/v1\/api-admin/, "").replace(/^\/api-admin/, "").replace(/^\/admin/, "") || "/";
    const body = await req.json().catch(() => ({}));

    if (path === "/login") {
      const username = String(body.username || "").toLowerCase();
      const password = String(body.password || "");
      if (!PASSWORD_HASHES[username] || (await sha256(`${username}|icetak|${password}`)) !== PASSWORD_HASHES[username]) {
        return error("Username atau password salah", 401);
      }

      const token = `adm_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
      await rest("admin_sessions", {
        method: "POST",
        body: JSON.stringify({ token, username, expires_at: new Date(Date.now() + 12 * 3600e3).toISOString() }),
      });

      return json({ session_token: token, username, permissions: await permissionsFor(username) });
    }

    if (path === "/dashboard") {
      const admin = await sessionFor(String(body.session_token || ""));
      if (!admin || !admin.permissions.includes("view_orders")) return error("Unauthorized", 401);

      const orders = await rest("orders?order=created_at.desc");
      return json({
        admin: {
          ...admin,
          paymentWebhookConfigured: true,
          shipmentWebhookConfigured: true,
          orderWebhookConfigured: false,
          whatsappSettings: { enabled: false },
          productionIntegration: { configured: false, url: "" },
        },
        orders,
        admins: await Promise.all(["admin1", "admin2", "admin3"].map(async (username) => ({ username, permissions: await permissionsFor(username) }))),
      });
    }

    return error(`Not found: ${path}`, 404);
  } catch (err) {
    return error(err?.message || "Server error", 500);
  }
});
