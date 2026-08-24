// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const H = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const out = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: H });
const text = (value: any, max = 500) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const digits = (value: any) => String(value ?? "").replace(/\D/g, "");

function phone(value: any) {
  let normalized = digits(value);
  if (normalized.startsWith("0")) normalized = `60${normalized.slice(1)}`;
  else if (normalized.startsWith("1")) normalized = `60${normalized}`;
  return /^601\d{8,9}$/.test(normalized) ? `+${normalized}` : "";
}

function state(value: any) {
  const raw = text(value, 100).replace(/[.,;:]+$/g, "");
  const normalized = raw.toLowerCase();
  const names: Record<string, string> = {
    johor: "Johor", kedah: "Kedah", kelantan: "Kelantan", melaka: "Melaka", malacca: "Melaka",
    "negeri sembilan": "Negeri Sembilan", pahang: "Pahang", perak: "Perak", perlis: "Perlis",
    "pulau pinang": "Pulau Pinang", penang: "Pulau Pinang", sabah: "Sabah", sarawak: "Sarawak",
    selangor: "Selangor", terengganu: "Terengganu", "kuala lumpur": "Kuala Lumpur",
    putrajaya: "Putrajaya", labuan: "Labuan",
  };
  return names[normalized] || raw;
}

function validAddress(value: any) {
  const address = text(value?.address_line1, 500);
  const city = text(value?.city, 100);
  const postcode = digits(value?.postcode);
  const region = state(value?.state);
  const bad = (item: string) => !item || item === "," || /^sila\s+isi$/i.test(item);
  return !bad(address) && !bad(city) && /^\d{5}$/.test(postcode) && postcode !== "00000" && !bad(region);
}

async function setting(key: string) {
  const { data, error } = await db.from("private_runtime_settings")
    .select("setting_value").eq("setting_key", key).limit(1).maybeSingle();
  if (error) throw error;
  return text(data?.setting_value, 1000);
}

async function admin(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${token}` },
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) return null;
  const { data: adminUser } = await db.from("admin_users")
    .select("username").eq("auth_user_id", user.id).eq("is_active", true).limit(1).maybeSingle();
  if (!adminUser?.username) return null;
  const { data: permissions } = await db.from("admin_permissions")
    .select("permissions").eq("username", adminUser.username).limit(1).maybeSingle();
  return {
    username: String(adminUser.username),
    permissions: Array.isArray(permissions?.permissions) ? permissions.permissions.map(String) : [],
  };
}

async function crmLookup(lookupPhone: string) {
  const normalized = digits(lookupPhone);
  const variants = Array.from(new Set([lookupPhone, normalized, `0${normalized.slice(2)}`]));
  const { data: customers, error: customerError } = await db.from("customers")
    .select("id,customer_master_id,name,phone").in("phone", variants).limit(4);
  if (customerError) throw customerError;

  const customer = (customers || [])[0] || null;
  let masterId = customer?.customer_master_id || null;
  if (!masterId) {
    const { data: identifiers, error: identifierError } = await db.from("customer_identifiers_master")
      .select("customer_master_id,is_verified,last_seen_at")
      .eq("identifier_type", "phone").eq("normalized_value", normalized)
      .order("is_verified", { ascending: false })
      .order("last_seen_at", { ascending: false, nullsFirst: false }).limit(1);
    if (identifierError) throw identifierError;
    masterId = identifiers?.[0]?.customer_master_id || null;
  }
  if (!customer && !masterId) return null;

  let query: any = db.from("customer_addresses")
    .select("id,recipient_name,phone,address_line1,address_line2,city,postcode,state,is_default,is_verified,last_used_at,source_provider")
    .is("archived_at", null);
  if (customer && masterId) query = query.or(`customer_id.eq.${customer.id},customer_master_id.eq.${masterId}`);
  else if (masterId) query = query.eq("customer_master_id", masterId);
  else query = query.eq("customer_id", customer.id);

  const { data: addresses, error: addressError } = await query
    .order("is_default", { ascending: false }).order("is_verified", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false }).limit(8);
  if (addressError) throw addressError;

  const saved = (addresses || []).find(validAddress);
  if (!saved) return null;
  return {
    ok: true,
    found: true,
    source: "customer_crm",
    customer: {
      name: text(saved.recipient_name || customer?.name, 120),
      phone: phone(saved.phone) || lookupPhone,
    },
    address: {
      id: saved.id,
      address_line1: text(saved.address_line1, 500),
      address_line2: text(saved.address_line2, 500),
      city: text(saved.city, 100),
      postcode: digits(saved.postcode),
      state: state(saved.state),
      is_default: Boolean(saved.is_default),
      is_verified: Boolean(saved.is_verified),
      source_provider: text(saved.source_provider, 100),
    },
  };
}

async function makeLookup(lookupPhone: string) {
  const url = await setting("draft_address_make_webhook_url");
  if (!url) throw new Error("Address webhook is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: lookupPhone }), signal: controller.signal,
    });
    const raw = await response.text();
    let payload: any = {};
    try { payload = raw ? JSON.parse(raw) : {}; }
    catch { throw new Error("Address webhook returned invalid JSON"); }
    if (!response.ok) throw new Error(payload?.message || "Address webhook failed");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeClickUp(payload: any, lookupPhone: string) {
  const found = payload?.found === true || String(payload?.found || "").toLowerCase() === "true";
  if (!found) return { ok: true, found: false, source: "clickup" };
  const returnedPhone = phone(payload?.phone);
  if (returnedPhone && returnedPhone !== lookupPhone) {
    return { ok: false, status: 409, error: "ClickUp address phone does not match lookup" };
  }
  const address = {
    address_line1: text(payload?.address, 500), address_line2: "", city: text(payload?.bandar, 100),
    postcode: digits(payload?.poskod), state: state(payload?.negeri),
  };
  if (!validAddress(address)) return { ok: false, status: 422, error: "ClickUp returned an incomplete address" };
  const name = text(payload?.nama, 120);
  return {
    ok: true, found: true, source: "clickup",
    customer: { name: /^sila\s+isi$/i.test(name) ? "" : name, phone: returnedPhone || lookupPhone },
    address,
  };
}

async function resolveAddress(lookupPhone: string) {
  const saved = await crmLookup(lookupPhone);
  if (saved) return saved;
  return normalizeClickUp(await makeLookup(lookupPhone), lookupPhone);
}

async function event(draftId: string, type: string, before: any, after: any, metadata: any) {
  await db.from("qrpay_order_draft_events").insert({
    draft_id: draftId, event_type: type, actor: "draft-address-fetch",
    before_data: before, after_data: after, metadata,
  });
}

async function saveDraftAddress(draft: any, result: any, lookupPhone: string) {
  const before = draft.working_draft || {};
  const current = before.customer || {};
  const address = result.address || {};
  const customer = {
    ...current,
    name: result.customer?.name || text(current.name || draft.customer_name, 120),
    phone: result.customer?.phone || lookupPhone,
    address_line1: address.address_line1,
    address_line2: address.address_line2 || "",
    postcode: address.postcode,
    city: address.city,
    state: address.state,
    address_id: address.id || null,
  };
  const after = {
    ...before,
    customer,
    address_evidence: {
      ...(before.address_evidence && typeof before.address_evidence === "object" ? before.address_evidence : {}),
      source: result.source === "customer_crm" ? "customer_crm" : "clickup_webhook",
      address_id: address.id || null,
      fetched_at: new Date().toISOString(),
      saved_address_verified: Boolean(address.is_verified),
      customer_confirmed: false,
    },
  };
  const { data: updated, error } = await db.from("qrpay_order_drafts")
    .update({
      working_draft: after,
      customer_name: customer.name || draft.customer_name,
      customer_phone: digits(customer.phone) || draft.customer_phone,
      version: Number(draft.version || 0) + 1,
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", draft.id).eq("version", draft.version)
    .select("version").limit(1).maybeSingle();
  if (error) throw error;
  if (!updated) throw new Error("Draft changed while address was loading. Please try again.");
  await event(
    draft.id,
    result.source === "customer_crm" ? "crm_address_fetched" : "clickup_address_fetched",
    before,
    after,
    { lookup_phone: lookupPhone, address_id: address.id || null },
  );
  return { customer, version: updated.version };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  if (req.method !== "POST") return out({ ok: false, error: "POST required" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const mode = text(body.mode, 20).toLowerCase();

    if (mode === "manual" || mode === "order") {
      const currentAdmin = await admin(req);
      if (!currentAdmin) return out({ ok: false, error: "Unauthorized" }, 401);
      if (mode === "manual" && !currentAdmin.permissions.some((permission: string) => ["create_order", "quick_arrange", "verify_payments"].includes(permission))) {
        return out({ ok: false, error: "Missing manual order permission" }, 403);
      }
      if (mode === "order" && !currentAdmin.permissions.includes("edit_order")) {
        return out({ ok: false, error: "Missing edit_order permission" }, 403);
      }
      if (mode === "order") {
        const orderId = text(body.order_db_id, 80);
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) return out({ ok: false, error: "Invalid order ID" }, 422);
        const { data: order } = await db.from("orders").select("id").eq("id", orderId).limit(1).maybeSingle();
        if (!order) return out({ ok: false, error: "Order not found" }, 404);
      }
      const lookupPhone = phone(body.phone);
      if (!lookupPhone) return out({ ok: false, error: "Invalid Malaysia phone" }, 422);
      const result = await resolveAddress(lookupPhone);
      return out(result, result.status || 200);
    }

    const token = text(body.token, 80);
    if (!/^qrd_[a-f0-9]{32}$/i.test(token)) return out({ ok: false, error: "Invalid draft token" }, 401);
    const { data: draft, error } = await db.from("qrpay_order_drafts")
      .select("id,status,version,working_draft,customer_name,customer_phone")
      .eq("review_token", token).limit(1).maybeSingle();
    if (error) throw error;
    if (!draft) return out({ ok: false, error: "Draft not found" }, 404);
    if (["confirmed", "rejected"].includes(String(draft.status || "").toLowerCase())) {
      return out({ ok: false, error: "Draft is locked" }, 409);
    }

    const lookupPhone = phone(body.phone || draft.working_draft?.customer?.phone || draft.customer_phone);
    if (!lookupPhone) return out({ ok: false, error: "Invalid Malaysia phone" }, 422);
    const since = new Date(Date.now() - 5000).toISOString();
    const { data: recent } = await db.from("qrpay_order_draft_events")
      .select("id").eq("draft_id", draft.id)
      .in("event_type", ["address_fetch_requested", "clickup_address_fetch_requested"])
      .gte("created_at", since).limit(1);
    if (recent?.length) return out({ ok: false, error: "Address lookup already running" }, 429);

    await event(draft.id, "address_fetch_requested", null, null, {
      lookup_phone: lookupPhone, source_priority: ["customer_crm", "clickup"],
    });
    const result = await resolveAddress(lookupPhone);
    if (!result.ok) {
      await event(draft.id, "address_fetch_failed", null, null, { lookup_phone: lookupPhone, error: result.error });
      return out(result, result.status || 422);
    }
    if (!result.found) {
      await event(draft.id, "address_not_found", null, null, {
        lookup_phone: lookupPhone, sources: ["customer_crm", "clickup"],
      });
      return out(result);
    }

    const saved = await saveDraftAddress(draft, result, lookupPhone);
    return out({ ...result, customer: saved.customer, draft_version: saved.version });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return out({ ok: false, error: "Address webhook timeout" }, 504);
    }
    return out({ ok: false, error: error instanceof Error ? error.message : "Address lookup failed" }, 500);
  }
});
