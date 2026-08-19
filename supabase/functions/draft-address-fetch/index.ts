// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

type AdminUser = { username: string; permissions: string[] };

const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

const text = (value: unknown, max = 500) =>
  String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

function normalizePhone(value: unknown): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "60" + digits.slice(1);
  else if (digits.startsWith("1")) digits = "60" + digits;
  return /^601\d{8,9}$/.test(digits) ? "+" + digits : "";
}

function canonicalState(value: unknown): string {
  const raw = text(value, 100).replace(/[.,;:]+$/g, "");
  const states: Record<string, string> = {
    johor: "Johor", kedah: "Kedah", kelantan: "Kelantan", melaka: "Melaka", malacca: "Melaka",
    "negeri sembilan": "Negeri Sembilan", pahang: "Pahang", perak: "Perak", perlis: "Perlis",
    "pulau pinang": "Pulau Pinang", penang: "Pulau Pinang", sabah: "Sabah", sarawak: "Sarawak",
    selangor: "Selangor", terengganu: "Terengganu", "kuala lumpur": "Kuala Lumpur",
    putrajaya: "Putrajaya", labuan: "Labuan",
  };
  return states[raw.toLowerCase()] || raw;
}

async function setting(key: string): Promise<string> {
  const { data, error } = await db
    .from("private_runtime_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return text(data?.setting_value, 1000);
}

async function currentAdmin(request: Request): Promise<AdminUser | null> {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${token}` },
  });
  const user = await authResponse.json().catch(() => null);
  if (!authResponse.ok || !user?.id) return null;

  const { data: admin, error: adminError } = await db
    .from("admin_users")
    .select("username")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (adminError || !admin?.username) return null;

  const { data: permissionRow, error: permissionError } = await db
    .from("admin_permissions")
    .select("permissions")
    .eq("username", admin.username)
    .limit(1)
    .maybeSingle();
  if (permissionError) return null;

  return {
    username: String(admin.username),
    permissions: Array.isArray(permissionRow?.permissions)
      ? permissionRow.permissions.map(String)
      : [],
  };
}

async function fetchWebhookPayload(lookupPhone: string) {
  const webhookUrl = await setting("draft_address_make_webhook_url");
  if (!webhookUrl) throw new Error("Address webhook is not configured");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: lookupPhone }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: any = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error("Address webhook returned invalid JSON");
    }
    if (!response.ok) throw new Error(payload?.message || "Address webhook failed");
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchOrderAddress(request: Request, body: any) {
  const admin = await currentAdmin(request);
  if (!admin) return out({ ok: false, error: "Unauthorized" }, 401);
  if (!admin.permissions.includes("edit_order")) {
    return out({ ok: false, error: "Missing edit_order permission" }, 403);
  }

  const orderId = text(body.order_db_id, 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
    return out({ ok: false, error: "Invalid order ID" }, 422);
  }
  const { data: order, error: orderError } = await db
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .limit(1)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) return out({ ok: false, error: "Order not found" }, 404);

  const lookupPhone = normalizePhone(body.phone);
  if (!lookupPhone) return out({ ok: false, error: "Invalid Malaysia phone" }, 422);

  const payload = await fetchWebhookPayload(lookupPhone);
  const found = payload?.found === true || String(payload?.found || "").toLowerCase() === "true";
  if (!found) return out({ ok: true, found: false, phone: lookupPhone });

  const responsePhone = normalizePhone(payload?.phone);
  if (responsePhone && responsePhone !== lookupPhone) {
    return out({ ok: false, error: "ClickUp address phone does not match order lookup" }, 409);
  }

  const addressLine1 = text(payload?.address, 500);
  const city = text(payload?.bandar, 100);
  const postcode = String(payload?.poskod ?? "").replace(/\D/g, "");
  const state = canonicalState(payload?.negeri);
  const returnedName = text(payload?.nama, 120);
  const invalidPlaceholder = (value: string) => !value || value === "," || /^sila\s+isi$/i.test(value);
  if (
    invalidPlaceholder(addressLine1) ||
    invalidPlaceholder(city) ||
    !/^\d{5}$/.test(postcode) ||
    postcode === "00000" ||
    invalidPlaceholder(state)
  ) {
    return out({ ok: false, error: "ClickUp returned an incomplete address" }, 422);
  }

  return out({
    ok: true,
    found: true,
    customer: {
      name: invalidPlaceholder(returnedName) ? "" : returnedName,
      phone: responsePhone || lookupPhone,
    },
    address: { address_line1: addressLine1, city, postcode, state },
  });
}

async function fetchManualAddress(request: Request, body: any) {
  const admin = await currentAdmin(request);
  if (!admin) return out({ ok: false, error: "Unauthorized" }, 401);
  if (!admin.permissions.some((permission) =>
    ["create_order", "quick_arrange", "verify_payments"].includes(permission)
  )) {
    return out({ ok: false, error: "Missing manual order permission" }, 403);
  }

  const lookupPhone = normalizePhone(body.phone);
  if (!lookupPhone) return out({ ok: false, error: "Invalid Malaysia phone" }, 422);

  const payload = await fetchWebhookPayload(lookupPhone);
  const found = payload?.found === true || String(payload?.found || "").toLowerCase() === "true";
  if (!found) return out({ ok: true, found: false, phone: lookupPhone });

  const responsePhone = normalizePhone(payload?.phone);
  if (responsePhone && responsePhone !== lookupPhone) {
    return out({ ok: false, error: "ClickUp address phone does not match manual order lookup" }, 409);
  }

  const addressLine1 = text(payload?.address, 500);
  const city = text(payload?.bandar, 100);
  const postcode = String(payload?.poskod ?? "").replace(/\D/g, "");
  const state = canonicalState(payload?.negeri);
  const returnedName = text(payload?.nama, 120);
  const invalidPlaceholder = (value: string) => !value || value === "," || /^sila\s+isi$/i.test(value);
  if (
    invalidPlaceholder(addressLine1) ||
    invalidPlaceholder(city) ||
    !/^\d{5}$/.test(postcode) ||
    postcode === "00000" ||
    invalidPlaceholder(state)
  ) {
    return out({ ok: false, error: "ClickUp returned an incomplete address" }, 422);
  }

  return out({
    ok: true,
    found: true,
    customer: {
      name: invalidPlaceholder(returnedName) ? "" : returnedName,
      phone: responsePhone || lookupPhone,
    },
    address: { address_line1: addressLine1, city, postcode, state },
  });
}

async function event(
  draftId: string,
  eventType: string,
  beforeData: unknown,
  afterData: unknown,
  metadata: Record<string, unknown>,
) {
  const { error } = await db.from("qrpay_order_draft_events").insert({
    draft_id: draftId,
    event_type: eventType,
    actor: "draft-address-fetch",
    before_data: beforeData,
    after_data: afterData,
    metadata,
  });
  if (error) console.error("draft-address-event", error);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "POST") return out({ ok: false, error: "POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return out({ ok: false, error: "Server configuration missing" }, 500);

  try {
    const body = await request.json().catch(() => ({}));
    if (text(body.mode, 20).toLowerCase() === "manual") {
      return await fetchManualAddress(request, body);
    }
    if (text(body.mode, 20).toLowerCase() === "order") {
      return await fetchOrderAddress(request, body);
    }
    const token = text(body.token, 80);
    if (!/^qrd_[a-f0-9]{32}$/i.test(token)) return out({ ok: false, error: "Invalid draft token" }, 401);

    const { data: draft, error: draftError } = await db
      .from("qrpay_order_drafts")
      .select("id,status,version,working_draft,customer_name,customer_phone")
      .eq("review_token", token)
      .limit(1)
      .maybeSingle();
    if (draftError) throw draftError;
    if (!draft) return out({ ok: false, error: "Draft not found" }, 404);
    if (["confirmed", "rejected"].includes(String(draft.status || "").toLowerCase())) {
      return out({ ok: false, error: "Draft is locked" }, 409);
    }

    const lookupPhone = normalizePhone(
      body.phone || draft.working_draft?.customer?.phone || draft.customer_phone,
    );
    if (!lookupPhone) return out({ ok: false, error: "Invalid Malaysia phone" }, 422);

    const since = new Date(Date.now() - 5000).toISOString();
    const { data: recent } = await db
      .from("qrpay_order_draft_events")
      .select("id")
      .eq("draft_id", draft.id)
      .eq("event_type", "clickup_address_fetch_requested")
      .gte("created_at", since)
      .limit(1);
    if (recent?.length) return out({ ok: false, error: "Address lookup already running" }, 429);

    const webhookUrl = await setting("draft_address_make_webhook_url");
    if (!webhookUrl) return out({ ok: false, error: "Address webhook is not configured" }, 500);

    await event(draft.id, "clickup_address_fetch_requested", null, null, {
      lookup_phone: lookupPhone,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: lookupPhone }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const raw = await response.text();
    let payload: any = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      await event(draft.id, "clickup_address_fetch_failed", null, null, {
        lookup_phone: lookupPhone,
        error: "invalid_json",
        http_status: response.status,
      });
      return out({ ok: false, error: "Address webhook returned invalid JSON" }, 502);
    }

    if (!response.ok) {
      await event(draft.id, "clickup_address_fetch_failed", null, null, {
        lookup_phone: lookupPhone,
        error: "webhook_http_error",
        http_status: response.status,
      });
      return out({ ok: false, error: payload?.message || "Address webhook failed" }, 502);
    }

    const found = payload?.found === true || String(payload?.found || "").toLowerCase() === "true";
    if (!found) {
      await event(draft.id, "clickup_address_not_found", null, null, {
        lookup_phone: lookupPhone,
      });
      return out({ ok: true, found: false, phone: lookupPhone });
    }

    const responsePhone = normalizePhone(payload?.phone);
    if (responsePhone && responsePhone !== lookupPhone) {
      await event(draft.id, "clickup_address_fetch_failed", null, null, {
        lookup_phone: lookupPhone,
        response_phone: responsePhone,
        error: "phone_mismatch",
      });
      return out({ ok: false, error: "ClickUp address phone does not match draft" }, 409);
    }

    const addressLine1 = text(payload?.address, 500);
    const city = text(payload?.bandar, 100);
    const postcode = String(payload?.poskod ?? "").replace(/\D/g, "");
    const state = canonicalState(payload?.negeri);
    const returnedName = text(payload?.nama, 120);
    const invalidPlaceholder = (value: string) => !value || value === "," || /^sila\s+isi$/i.test(value);

    if (
      invalidPlaceholder(addressLine1) ||
      invalidPlaceholder(city) ||
      !/^\d{5}$/.test(postcode) ||
      postcode === "00000" ||
      invalidPlaceholder(state)
    ) {
      await event(draft.id, "clickup_address_fetch_failed", null, null, {
        lookup_phone: lookupPhone,
        error: "incomplete_address",
      });
      return out({ ok: false, error: "ClickUp returned an incomplete address" }, 422);
    }

    const before = draft.working_draft || {};
    const currentCustomer = before.customer || {};
    const customer = {
      ...currentCustomer,
      name: invalidPlaceholder(returnedName)
        ? text(currentCustomer.name || draft.customer_name, 120)
        : returnedName,
      phone: responsePhone || lookupPhone,
      address_line1: addressLine1,
      postcode,
      city,
      state,
    };
    const after = {
      ...before,
      customer,
      address_evidence: {
        ...(before.address_evidence && typeof before.address_evidence === "object"
          ? before.address_evidence
          : {}),
        source: "clickup_webhook",
        fetched_at: new Date().toISOString(),
        customer_confirmed: false,
      },
    };

    const { data: updated, error: updateError } = await db
      .from("qrpay_order_drafts")
      .update({
        working_draft: after,
        customer_name: customer.name || draft.customer_name,
        customer_phone: String(customer.phone || "").replace(/\D/g, "") || draft.customer_phone,
        version: Number(draft.version || 0) + 1,
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", draft.id)
      .eq("version", draft.version)
      .select("version")
      .limit(1)
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return out({ ok: false, error: "Draft changed while address was loading. Please try again." }, 409);

    await event(draft.id, "clickup_address_fetched", before, after, {
      lookup_phone: lookupPhone,
    });

    return out({
      ok: true,
      found: true,
      customer,
      address: {
        address_line1: addressLine1,
        city,
        postcode,
        state,
      },
      draft_version: updated.version,
    });
  } catch (error) {
    console.error("draft-address-fetch", error);
    if (error instanceof DOMException && error.name === "AbortError") {
      return out({ ok: false, error: "Address webhook timeout" }, 504);
    }
    return out({ ok: false, error: error instanceof Error ? error.message : "Address lookup failed" }, 500);
  }
});
