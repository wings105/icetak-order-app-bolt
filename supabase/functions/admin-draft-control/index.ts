import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
};

type JsonObject = Record<string, unknown>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function rest(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error(data?.message || data?.error || `REST ${r.status}`);
  return data;
}

async function patch(path: string, body: JsonObject) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error(data?.message || data?.error || `PATCH ${r.status}`);
  return data;
}

async function rpc(name: string, body: JsonObject) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.message || data?.error || `RPC ${name} ${r.status}`);
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

function normalizePhone(value: unknown) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) digits = `6${digits}`;
  else if (digits.startsWith("1")) digits = `60${digits}`;
  return /^601\d{8,9}$/.test(digits) ? digits : "";
}

function validBsuid(value: unknown) {
  const bsuid = String(value || "").trim();
  return /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/i.test(bsuid) ? bsuid : "";
}

async function reviewAction(action: string, token: string, payload: JsonObject) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/qrpay-draft-review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, token, payload }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || data?.ok === false) throw new Error(data?.error || `Draft review ${r.status}`);
  return data;
}

async function enableOrderNotification(orderId: string, enabled: boolean) {
  if (!orderId || !enabled) return { enabled: false, queued: false };
  await patch(`orders?id=eq.${encodeURIComponent(orderId)}`, { whatsapp_opt_in: true, updated_at: new Date().toISOString() });
  try {
    const queueId = await rpc("icetak_enqueue_whatsapp_event", {
      p_event_type: "order_created",
      p_order_id: orderId,
      p_extra: { source: "admin_order_composer" },
      p_suffix: null,
      p_scheduled_at: new Date().toISOString(),
    });
    return { enabled: true, queued: Boolean(queueId) };
  } catch (error) {
    return { enabled: true, queued: false, error: error instanceof Error ? error.message : String(error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ success: false, error: "Runtime not configured" }, 500);

  try {
    const admin = await currentAdmin(req);
    if (!admin) return json({ success: false, error: "Admin authentication required" }, 401);
    const canCreate = admin.permissions.includes("create_order");
    const canCompose = canCreate || admin.permissions.includes("quick_arrange");
    const canEdit = admin.permissions.includes("edit_order") || admin.permissions.includes("approve_production");
    const body = await req.json().catch(() => ({})) as JsonObject;
    const action = String(body.action || "").trim();

    if (action === "compose_order") {
      if (!canCompose) return json({ success: false, error: "Create Order permission required" }, 403);
      const operation = String(body.operation || "").trim();
      if (!["save_draft", "send_customer", "confirm_pickup", "confirm_paid", "confirm_qrpay"].includes(operation)) {
        return json({ success: false, error: "Valid order action required" }, 400);
      }
      const verifiesPayment = operation === "confirm_paid" || operation === "confirm_qrpay";
      if (verifiesPayment && !admin.permissions.includes("verify_payments")) {
        return json({ success: false, error: "Verify Payments permission required" }, 403);
      }

      const requestId = String(body.request_id || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ success: false, error: "Valid request ID required" }, 400);
      const raw = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? structuredClone(body.payload) as JsonObject
        : null;
      if (!raw) return json({ success: false, error: "Order payload required" }, 400);

      const customer = raw.customer && typeof raw.customer === "object" && !Array.isArray(raw.customer)
        ? raw.customer as JsonObject
        : {};
      const identity = raw.whatsapp_identity && typeof raw.whatsapp_identity === "object" && !Array.isArray(raw.whatsapp_identity)
        ? raw.whatsapp_identity as JsonObject
        : {};
      const originalPhone = String(customer.phone || identity.phone || "").trim();
      const phone = normalizePhone(originalPhone);
      const bsuid = validBsuid(identity.bsuid);
      const username = String(identity.username || "").trim().replace(/^@+/, "").slice(0, 120);
      const name = String(customer.name || "").trim().slice(0, 200);
      const delivery = String(raw.delivery || "pickup").trim().toLowerCase();
      const paymentMode = String(raw.payment_mode || "prepaid").trim().toLowerCase();
      const dateNeed = String(raw.date_need || "").trim();
      const items = Array.isArray(raw.items) ? raw.items : [];

      if (originalPhone && !phone) return json({ success: false, error: "Valid Malaysia phone required" }, 400);
      if (identity.bsuid && !bsuid) return json({ success: false, error: "Valid WhatsApp user ID required" }, 400);
      if (!["pickup", "spx", "jnt", "ninja"].includes(delivery)) return json({ success: false, error: "Valid delivery required" }, 400);
      if (!["prepaid", "cash_counter"].includes(paymentMode)) return json({ success: false, error: "Valid payment flow required" }, 400);
      if (paymentMode === "cash_counter" && delivery !== "pickup") return json({ success: false, error: "Cash at Counter is only available for Pickup" }, 400);
      if (!items.length || items.length > 40) return json({ success: false, error: "Choose between 1 and 40 order items" }, 400);
      if (dateNeed && !/^\d{4}-\d{2}-\d{2}$/.test(dateNeed)) return json({ success: false, error: "Invalid Date Need" }, 400);
      if (operation !== "save_draft" && (!name || (!phone && !bsuid) || !dateNeed)) {
        return json({ success: false, error: "Customer name, WhatsApp identity and Date Need are required" }, 400);
      }
      if (operation === "confirm_pickup" && paymentMode !== "cash_counter") return json({ success: false, error: "Pickup Cash Counter flow required" }, 400);
      if (operation !== "confirm_pickup" && operation !== "save_draft" && paymentMode !== "prepaid") {
        return json({ success: false, error: "Prepaid payment flow required" }, 400);
      }

      let masterId: string | null = null;
      if (bsuid) {
        const synced = await rpc("icetak_ensure_whatsapp_customer_master", {
          p_bsuid: bsuid,
          p_username: username || null,
          p_phone: phone || null,
          p_display_name: name || null,
          p_scope: "waba:939302461880264",
        });
        masterId = String(synced?.customer_master_id || "").trim() || null;
      }

      const whatsappIdentity = {
        phone: phone || null,
        bsuid: bsuid || null,
        username: username || null,
        customer_master_id: masterId,
        scope: "waba:939302461880264",
      };
      const sourceEvidence = raw.evidence && typeof raw.evidence === "object" && !Array.isArray(raw.evidence)
        ? raw.evidence as JsonObject
        : {};
      const payload: JsonObject = {
        ...raw,
        customer: { ...customer, name, phone },
        whatsapp_identity: whatsappIdentity,
        source_type: "admin_manual",
        payment_mode: paymentMode,
        delivery,
        evidence: { ...sourceEvidence, source: "admin_order_composer", manual_order: true, actor: admin.username, whatsapp_identity: whatsappIdentity },
      };
      const requestKey = `admin-compose:${requestId}`;
      let draft = await rpc("icetak_create_generic_order_draft", {
        p_source_type: "admin_manual",
        p_conversation_id: null,
        p_customer_phone: phone || null,
        p_customer_name: name || null,
        p_payload: payload,
        p_request_key: requestKey,
        p_cutoff_at: new Date().toISOString(),
        p_trigger_message_id: null,
        p_payment_mode: paymentMode,
        p_actor: admin.username,
      });

      if (draft?.status === "confirmed" && draft?.order_id) {
        return json({ success: true, action: operation, duplicate: true, draft_id: draft.id, review_token: draft.review_token, order_db_id: draft.order_id, order_id: draft.order_no, order_no: draft.order_no });
      }

      const token = String(draft?.review_token || "");
      if (!/^qrd_[a-f0-9]{32}$/i.test(token)) throw new Error("Draft token was not created");
      if (String(draft?.payment_mode || "").toLowerCase() !== paymentMode) {
        draft = await rpc("icetak_admin_set_draft_flow", {
          p_review_token: token,
          p_delivery: delivery,
          p_payment_mode: paymentMode,
          p_actor: admin.username,
        });
      }
      draft = await rpc("icetak_save_qrpay_order_draft", {
        p_review_token: token,
        p_payload: payload,
        p_actor: admin.username,
      });
      await patch(`qrpay_order_drafts?id=eq.${encodeURIComponent(String(draft.id))}`, {
        ai_draft: draft.working_draft,
        evidence: payload.evidence,
        customer_phone: phone || null,
        customer_name: name || null,
        updated_at: new Date().toISOString(),
      });

      const reviewLink = `https://shop.decocake.my/qrpay-draft.html?token=${encodeURIComponent(token)}`;
      if (operation === "save_draft") {
        return json({ success: true, action: operation, draft_id: draft.id, review_token: token, review_link: reviewLink, draft_total: Number(draft.draft_total || 0) });
      }
      if (Number(draft.draft_total || 0) <= 0) return json({ success: false, error: "Order total must be more than RM0", draft_id: draft.id }, 400);

      if (operation === "send_customer") {
        const approved = await reviewAction("approve_customer", token, payload);
        return json({ success: true, action: operation, draft_id: draft.id, review_token: token, review_link: reviewLink, customer_sent: Boolean(approved?.customer?.sent), customer_link: approved?.customer?.link || null });
      }

      let result: JsonObject;
      if (operation === "confirm_pickup") {
        try {
          const confirmed = await reviewAction("confirm", token, payload);
          result = (confirmed?.result || {}) as JsonObject;
        } catch (confirmError) {
          // Confirmation creates the order transactionally before optional follow-up work.
          // Recover that durable success so a harmless downstream failure cannot invite a
          // second submit with a new request ID and create a duplicate real order.
          const recoveredRows = await rest(`qrpay_order_drafts?id=eq.${encodeURIComponent(String(draft.id))}&select=status,order_id,order_no&limit=1`);
          const recovered = recoveredRows?.[0] || {};
          if (recovered.status !== "confirmed" || !recovered.order_id || !recovered.order_no) throw confirmError;
          result = {
            success: true,
            recovered_after_confirm: true,
            order_db_id: recovered.order_id,
            order_id: recovered.order_no,
            order_no: recovered.order_no,
          };
        }
      } else if (operation === "confirm_paid") {
        const method = String(body.payment_method || "").trim();
        const reference = String(body.payment_reference || "").trim();
        if (!["bank_transfer", "card", "other", "qr_pay_manual"].includes(method)) return json({ success: false, error: "Valid payment method required" }, 400);
        if (reference.length > 180) return json({ success: false, error: "Payment reference is too long" }, 400);
        result = await rpc("icetak_admin_confirm_paid_draft", {
          p_review_token: token,
          p_payment_method: method,
          p_reference: reference || null,
          p_actor: admin.username,
        });
      } else {
        const transactionId = String(body.transaction_id || "").trim();
        if (!transactionId || transactionId.length > 180) return json({ success: false, error: "Valid QRPay transaction required" }, 400);
        const matched = await rpc("icetak_admin_link_payment_to_draft_and_finalize", {
          p_transaction_id: transactionId,
          p_draft_id: draft.id,
          p_actor: admin.username,
          p_confirm_mismatch: body.confirm_mismatch === true,
        });
        if (matched?.success === false) {
          return json({ success: false, requires_confirmation: Boolean(matched.requires_confirmation), requires_mismatch_confirmation: Boolean(matched.requires_mismatch_confirmation), error: "QRPay confirmation required", draft_id: draft.id, review_token: token });
        }
        result = matched as JsonObject;
      }

      const nestedOrder = result.order && typeof result.order === "object" && !Array.isArray(result.order)
        ? result.order as JsonObject
        : {};
      const refreshedDrafts = await rest(`qrpay_order_drafts?id=eq.${encodeURIComponent(String(draft.id))}&select=order_id,order_no&limit=1`);
      const refreshedDraft = refreshedDrafts?.[0] || {};
      const orderDbId = String(result.order_db_id || nestedOrder.order_db_id || refreshedDraft.order_id || "").trim();
      const orderUuid = /^[0-9a-f-]{36}$/i.test(orderDbId) ? orderDbId : "";
      const orderNo = String(result.order_no || nestedOrder.order_no || nestedOrder.order_id || refreshedDraft.order_no || result.order_id || "").trim();
      const notification = await enableOrderNotification(orderUuid, body.notify_whatsapp === true);
      return json({ success: true, action: operation, ...result, draft_id: draft.id, review_token: token, review_link: reviewLink, order_db_id: orderUuid || null, order_id: orderNo, order_no: orderNo, notification });
    }

    if (action === "create_manual") {
      if (!canCreate) return json({ success: false, error: "Create Order permission required" }, 403);
      const customerName = String(body.customer_name || "").trim();
      const customerPhone = String(body.customer_phone || "").trim();
      const dateNeed = String(body.date_need || "").trim();
      const delivery = String(body.delivery || "unknown").trim().toLowerCase();
      const paymentMode = String(body.payment_mode || "prepaid").trim().toLowerCase();
      if (customerName.length > 200 || customerPhone.length > 30) return json({ success: false, error: "Customer details are too long" }, 400);
      if (dateNeed && !/^\d{4}-\d{2}-\d{2}$/.test(dateNeed)) return json({ success: false, error: "Invalid Date Need" }, 400);
      if (!["unknown","pickup","spx","jnt","ninja"].includes(delivery)) return json({ success: false, error: "Invalid delivery" }, 400);
      if (!["prepaid","cash_counter"].includes(paymentMode)) return json({ success: false, error: "Invalid payment flow" }, 400);
      if (paymentMode === "cash_counter" && !["pickup","unknown"].includes(delivery)) return json({ success: false, error: "Cash at Counter is only available for Pickup" }, 400);
      const data = await rpc("icetak_admin_create_manual_order_draft", {
        p_customer_name: customerName || null,
        p_customer_phone: customerPhone || null,
        p_date_need: dateNeed || null,
        p_delivery: delivery,
        p_payment_mode: paymentMode,
        p_actor: admin.username,
      });
      return json({ success: true, data });
    }

    if (action === "set_flow") {
      if (!canEdit) return json({ success: false, error: "Edit Order permission required" }, 403);
      const reviewToken = String(body.review_token || "").trim();
      const delivery = String(body.delivery || "").trim().toLowerCase();
      const paymentMode = String(body.payment_mode || "").trim().toLowerCase();
      if (!/^qrd_[a-f0-9]{32}$/i.test(reviewToken)) return json({ success: false, error: "Valid draft is required" }, 400);
      if (!["pickup","spx","jnt","ninja"].includes(delivery)) return json({ success: false, error: "Shipping / Pickup required" }, 400);
      if (!["prepaid","cash_counter"].includes(paymentMode)) return json({ success: false, error: "Invalid payment flow" }, 400);
      const data = await rpc("icetak_admin_set_draft_flow", {
        p_review_token: reviewToken,
        p_delivery: delivery,
        p_payment_mode: paymentMode,
        p_actor: admin.username,
      });
      return json({ success: true, data });
    }

    return json({ success: false, error: "Unknown action" }, 400);
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
