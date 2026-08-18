import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
};

type JsonObject = Record<string, unknown>;
type FinanceAdmin = { username: string; role: string; permissions: string[] };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

function malaysiaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
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
    headers: { "content-type": "application/json", apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
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

    if (action === "snapshot") return json({ success: true, data: await rpc("finance_admin_snapshot") });
    if (action === "transactions") return json({ success: true, data: await rpc("finance_admin_transactions", {
      p_limit: Math.min(Math.max(Number(body.limit) || 100, 1), 500), p_offset: Math.max(Number(body.offset) || 0, 0),
      p_status: body.status || null, p_direction: body.direction || null, p_query: body.query || null, p_from: body.from || null, p_to: body.to || null,
    }) });
    if (action === "qrpay_daily") {
      const date = String(body.date || "");
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ success: false, error: "Valid QRPay summary date is required" }, 400);
      return json({ success: true, data: await rpc("finance_admin_qrpay_daily", { p_date: date || null }) });
    }
    if (action === "qrpay_range") {
      const from = String(body.from || ""), to = String(body.to || "");
      const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
      if ((from && !validDate(from)) || !validDate(to) || (from && from > to) || to > malaysiaToday()) return json({ success: false, error: "Valid QRPay date range is required" }, 400);
      const summary = await rpc("finance_admin_qrpay_range_with_progress", { p_from: from || null, p_to: to });
      const rows = Array.isArray(summary?.rows) ? summary.rows : [];
      const transactionIds = [...new Set(rows.map((row: JsonObject) => String(row.transaction_id || "")).filter(Boolean))];
      const linkedDrafts = transactionIds.length ? await rpc("finance_admin_qrpay_linked_drafts", { p_transaction_ids: transactionIds }) : {};
      return json({ success: true, data: {
        ...summary,
        rows: rows.map((row: JsonObject) => {
          const linked = linkedDrafts?.[String(row.transaction_id || "")];
          return linked ? { ...row, draft_id: linked.draft_id, draft_status: linked.draft_status, draft_payment_status: linked.payment_status } : row;
        }),
      } });
    }
    if (action === "qrpay_match_candidates") {
      const transactionId = String(body.transaction_id || "").trim();
      if (!transactionId) return json({ success: false, error: "QRPay transaction is required" }, 400);
      const args = { p_transaction_id: transactionId, p_query: String(body.query || "").trim() || null };
      const [orders, drafts] = await Promise.all([
        rpc("finance_admin_qrpay_match_candidates", args),
        rpc("finance_admin_qrpay_draft_candidates", args),
      ]);
      const draftCandidates = Array.isArray(drafts?.candidates) ? drafts.candidates : [];
      const orderCandidates = Array.isArray(orders?.candidates) ? orders.candidates : [];
      return json({ success: true, data: { ...orders, transaction: orders?.transaction || drafts?.transaction, candidates: [...draftCandidates, ...orderCandidates] } });
    }
    if (action === "draft_orders") return json({ success: true, data: await rpc("finance_admin_draft_orders", {
      p_query: String(body.query || "").trim() || null,
      p_status: String(body.status || "").trim() || null,
      p_limit: Math.min(Math.max(Number(body.limit) || 100, 1), 300),
    }) });
    if (action === "report") {
      const from = String(body.from || ""), to = String(body.to || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return json({ success: false, error: "Valid report dates are required" }, 400);
      return json({ success: true, data: await rpc("finance_admin_report", { p_from: from, p_to: to }) });
    }
    if (!admin.permissions.includes("manage_finance")) return json({ success: false, error: "Manage Finance permission required" }, 403);

    if (action === "qrpay_review_action") {
      const transactionId = String(body.transaction_id || "").trim();
      const reviewAction = String(body.review_action || "").trim();
      const remark = String(body.remark || "").trim();
      const category = String(body.category || "").trim() || null;
      if (!transactionId || !["save_remark", "ignore", "reopen"].includes(reviewAction)) return json({ success: false, error: "Valid QRPay review action is required" }, 400);
      if (remark.length > 2000) return json({ success: false, error: "Remark cannot exceed 2000 characters" }, 400);
      if (reviewAction === "ignore" && (!remark || !category)) return json({ success: false, error: "Category and remark are required before ignoring a payment" }, 400);
      return json({ success: true, data: await rpc("finance_admin_qrpay_review_action", { p_transaction_id: transactionId, p_action: reviewAction, p_remark: remark || null, p_category: category, p_actor: admin.username }) });
    }
    if (action === "draft_detach_payment") {
      const draftId = String(body.draft_id || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(draftId)) return json({ success: false, error: "Valid draft is required" }, 400);
      return json({ success: true, data: await rpc("finance_admin_detach_qrpay_from_draft", {
        p_draft_id: draftId, p_actor: admin.username,
      }) });
    }
    if (action === "draft_link_payment") {
      const draftId = String(body.draft_id || "").trim();
      const transactionId = String(body.transaction_id || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(draftId) || !transactionId) return json({ success: false, error: "Draft and QRPay transaction are required" }, 400);
      const data = await rpc("icetak_admin_link_payment_to_draft_and_finalize", {
        p_transaction_id: transactionId, p_draft_id: draftId, p_actor: admin.username,
        p_confirm_mismatch: body.confirm_mismatch === true,
      });
      return json({ success: data?.success !== false, data, error: data?.success === false ? "Confirmation required before linking draft" : undefined });
    }
    if (action === "qrpay_identity_update") {
      const transactionId = String(body.transaction_id || "").trim(), name = String(body.name || "").trim(), phone = String(body.phone || "").trim();
      if (!transactionId || !name || !phone) return json({ success: false, error: "Transaction, customer name and phone are required" }, 400);
      if (name.length > 200 || phone.length > 30) return json({ success: false, error: "Customer contact is too long" }, 400);
      return json({ success: true, data: await rpc("finance_admin_qrpay_identity_update", { p_transaction_id: transactionId, p_name: name, p_phone: phone, p_update_order: body.update_order === true, p_actor: admin.username }) });
    }
    if (action === "qrpay_manual_match") {
      const transactionId = String(body.transaction_id || "").trim();
      const orderNo = String(body.order_no || "").trim();
      if (!transactionId || !orderNo) return json({ success: false, error: "QRPay transaction and order/draft are required" }, 400);
      if (/^DRAFT:[0-9a-f-]{36}$/i.test(orderNo)) {
        const draftId = orderNo.slice(6);
        const data = await rpc("icetak_admin_link_payment_to_draft_and_finalize", {
          p_transaction_id: transactionId,
          p_draft_id: draftId,
          p_actor: admin.username,
          p_confirm_mismatch: body.confirm_mismatch === true,
        });
        return json({ success: data?.success !== false, data, error: data?.success === false ? "Confirmation required before linking draft" : undefined });
      }
      const data = await rpc("finance_admin_manual_match_qrpay", {
        p_transaction_id: transactionId, p_order_no: orderNo, p_actor: admin.username, p_confirm_mismatch: body.confirm_mismatch === true,
      });
      return json({ success: data?.success !== false, data, error: data?.success === false ? "Confirmation required before matching" : undefined });
    }
    if (action === "qrpay_correct_match") {
      const transactionId = String(body.transaction_id || "").trim();
      const correctionAction = String(body.correction_action || "").trim();
      if (!transactionId || !["unmatch", "unmatch_create", "relink"].includes(correctionAction)) return json({ success: false, error: "Valid QRPay correction action is required" }, 400);
      if (correctionAction === "relink" && !String(body.target_order_no || "").trim()) return json({ success: false, error: "Target order is required for relink" }, 400);
      const data = await rpc("finance_admin_correct_qrpay_match", {
        p_transaction_id: transactionId, p_action: correctionAction, p_target_order_no: String(body.target_order_no || "").trim() || null,
        p_actor: admin.username, p_confirm_processed: body.confirm_processed === true, p_confirm_mismatch: body.confirm_mismatch === true,
        p_cancel_source: body.cancel_source === true,
      });
      return json({ success: data?.success !== false, data, error: data?.success === false ? "Confirmation required before correcting this match" : undefined });
    }
    if (action === "classify") {
      const transactionId = Number(body.transaction_id), accountCode = String(body.account_code || "");
      if (!Number.isInteger(transactionId) || !accountCode) return json({ success: false, error: "Transaction and account are required" }, 400);
      return json({ success: true, data: await rpc("finance_admin_classify_transaction", { p_transaction_id: transactionId, p_account_code: accountCode, p_actor: admin.username }) });
    }
    if (action === "resolve") {
      const caseId = Number(body.case_id), resolution = String(body.resolution || "");
      if (!Number.isInteger(caseId) || !["confirm_same", "keep_separate", "ignore"].includes(resolution)) return json({ success: false, error: "Valid reconciliation action is required" }, 400);
      return json({ success: true, data: await rpc("finance_admin_resolve_reconciliation", { p_case_id: caseId, p_action: resolution, p_actor: admin.username, p_notes: body.notes || null }) });
    }
    if (action === "sync_shopee") return json({ success: true, data: await rpc("finance_admin_sync_shopee") });
    return json({ success: false, error: `Unknown Finance action: ${action}` }, 404);
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : "Finance server error" }, 500);
  }
});
