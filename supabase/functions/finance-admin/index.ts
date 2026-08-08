import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
};

type JsonObject = Record<string, unknown>;
type FinanceAdmin = {
  username: string;
  role: string;
  permissions: string[];
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function rest(path: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data?.message || data?.error || `REST request failed with HTTP ${response.status}`);
  return data;
}

async function rpc(name: string, body: JsonObject = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ error: `RPC ${name} returned invalid JSON` }));
  if (!response.ok) throw new Error(data?.message || data?.error || `RPC ${name} failed with HTTP ${response.status}`);
  return data;
}

async function currentFinanceAdmin(req: Request): Promise<FinanceAdmin | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${token}` },
  });
  const user = await authResponse.json().catch(() => null);
  if (!authResponse.ok || !user?.id) return null;

  const admins = await rest(`admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=username,role&limit=1`);
  const admin = admins?.[0];
  if (!admin?.username) return null;
  const rows = await rest(`admin_permissions?username=eq.${encodeURIComponent(admin.username)}&select=permissions&limit=1`);
  const permissions = Array.isArray(rows?.[0]?.permissions) ? rows[0].permissions.map(String) : [];
  if (admin.username !== "admin1" || admin.role !== "owner" || !permissions.includes("view_finance")) return null;
  return { username: admin.username, role: admin.role, permissions };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ success: false, error: "Finance runtime is not configured" }, 500);

  try {
    const admin = await currentFinanceAdmin(req);
    if (!admin) return json({ success: false, error: "Finance access is restricted to Zaim" }, 403);
    const body = await req.json().catch(() => ({})) as JsonObject;
    const action = String(body.action || "snapshot");

    if (action === "snapshot") {
      return json({ success: true, data: await rpc("finance_admin_snapshot") });
    }
    if (action === "transactions") {
      return json({
        success: true,
        data: await rpc("finance_admin_transactions", {
          p_limit: Math.min(Math.max(Number(body.limit) || 100, 1), 500),
          p_offset: Math.max(Number(body.offset) || 0, 0),
          p_status: body.status || null,
          p_direction: body.direction || null,
          p_query: body.query || null,
          p_from: body.from || null,
          p_to: body.to || null,
        }),
      });
    }
    if (action === "report") {
      const from = String(body.from || "");
      const to = String(body.to || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return json({ success: false, error: "Valid report dates are required" }, 400);
      }
      return json({ success: true, data: await rpc("finance_admin_report", { p_from: from, p_to: to }) });
    }
    if (!admin.permissions.includes("manage_finance")) return json({ success: false, error: "Manage Finance permission required" }, 403);

    if (action === "classify") {
      const transactionId = Number(body.transaction_id);
      const accountCode = String(body.account_code || "");
      if (!Number.isInteger(transactionId) || !accountCode) return json({ success: false, error: "Transaction and account are required" }, 400);
      return json({ success: true, data: await rpc("finance_admin_classify_transaction", {
        p_transaction_id: transactionId,
        p_account_code: accountCode,
        p_actor: admin.username,
      }) });
    }
    if (action === "resolve") {
      const caseId = Number(body.case_id);
      const resolution = String(body.resolution || "");
      if (!Number.isInteger(caseId) || !["confirm_same", "keep_separate", "ignore"].includes(resolution)) {
        return json({ success: false, error: "Valid reconciliation action is required" }, 400);
      }
      return json({ success: true, data: await rpc("finance_admin_resolve_reconciliation", {
        p_case_id: caseId,
        p_action: resolution,
        p_actor: admin.username,
        p_notes: body.notes || null,
      }) });
    }
    if (action === "sync_shopee") {
      return json({ success: true, data: await rpc("finance_admin_sync_shopee") });
    }
    return json({ success: false, error: `Unknown Finance action: ${action}` }, 404);
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : "Finance server error" }, 500);
  }
});
