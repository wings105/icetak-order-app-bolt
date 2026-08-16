import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-icetak-address-key",
  "access-control-allow-methods": "POST,OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

function normalizePhone(value: unknown): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) digits = "60" + digits.slice(1);
  else if (digits.startsWith("1")) digits = "60" + digits;
  return digits;
}

function cleanText(value: unknown, max = 220): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function canonicalState(value: unknown): string {
  const raw = cleanText(value, 100).replace(/[.,;:]+$/g, "").trim();
  const key = raw.toLowerCase();
  const map: Record<string, string> = {
    johor: "Johor", kedah: "Kedah", kelantan: "Kelantan", melaka: "Melaka", malacca: "Melaka",
    "negeri sembilan": "Negeri Sembilan", pahang: "Pahang", perak: "Perak", perlis: "Perlis",
    "pulau pinang": "Pulau Pinang", penang: "Pulau Pinang", sabah: "Sabah", sarawak: "Sarawak",
    selangor: "Selangor", terengganu: "Terengganu", "kuala lumpur": "Kuala Lumpur",
    "wilayah persekutuan kuala lumpur": "Kuala Lumpur", labuan: "Labuan",
    "wilayah persekutuan labuan": "Labuan", putrajaya: "Putrajaya",
    "wilayah persekutuan putrajaya": "Putrajaya",
  };
  return map[key] ?? raw;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function safeEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function authorize(request: Request): Promise<boolean> {
  const supplied = request.headers.get("x-icetak-address-key") ?? "";
  if (!supplied) return false;
  const { data, error } = await sb.from("private_runtime_settings")
    .select("setting_value").eq("setting_key", "address_api_token").limit(1).maybeSingle();
  if (error) throw error;
  return safeEqual(supplied, String(data?.setting_value ?? ""));
}

async function findOrder(reference: string) {
  const ref = reference.trim();
  if (!ref) return null;

  const direct: Array<[string, string]> = [
    ["order_no", ref], ["order_id", ref], ["external_order_id", ref], ["clickup_order_task_id", ref],
  ];
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ref)) {
    direct.unshift(["id", ref]);
  }
  for (const [column, value] of direct) {
    const { data, error } = await sb.from("orders").select("*").eq(column, value).limit(1).maybeSingle();
    if (error && error.code !== "22P02") throw error;
    if (data) return data;
  }

  for (const table of ["production_components", "clickup_tasks"]) {
    const { data, error } = await sb.from(table).select("order_id").eq("clickup_task_id", ref).limit(1).maybeSingle();
    if (error) throw error;
    if (data?.order_id) {
      const { data: order, error: orderError } = await sb.from("orders").select("*").eq("id", data.order_id).single();
      if (orderError) throw orderError;
      return order;
    }
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "Server configuration missing" }, 500);

  try {
    if (!await authorize(request)) return json({ ok: false, error: "Unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const reference = cleanText(body.order_reference ?? body.order_id ?? body.order_no ?? body.clickup_task_id, 120);
    if (!reference) return json({ ok: false, error: "order_reference is required" }, 400);

    const order = await findOrder(reference);
    if (!order) return json({ ok: false, error: "Order not found" }, 404);
    if (String(order.delivery_method ?? order.delivery ?? "").toLowerCase().includes("pickup")) {
      return json({ ok: false, error: "Pickup order does not require shipping address" }, 422);
    }

    const input = body.customer ?? body.address ?? {};
    const recipientName = cleanText(input.name ?? input.recipient_name ?? input.recipientName ?? order.delivery_name, 120);
    const phone = normalizePhone(input.phone ?? order.delivery_phone);
    const line1 = cleanText(input.address_line1 ?? input.addressLine1 ?? input.line1, 220);
    const line2 = cleanText(input.address_line2 ?? input.addressLine2 ?? input.line2, 220);
    const city = cleanText(input.city, 100);
    const postcode = String(input.postcode ?? "").replace(/\D/g, "").slice(0, 5);
    const state = canonicalState(input.state);
    const country = cleanText(input.country ?? "Malaysia", 80) || "Malaysia";

    const missing = [
      ["recipient_name", recipientName], ["phone", phone], ["address_line1", line1],
      ["city", city], ["postcode", postcode], ["state", state],
    ].filter(([, value]) => !value).map(([field]) => field);
    if (missing.length) return json({ ok: false, error: "Address incomplete", missing }, 422);
    if (!/^601[0-9]{8,9}$/.test(phone)) return json({ ok: false, error: "Invalid Malaysia phone" }, 422);
    if (!/^[0-9]{5}$/.test(postcode) || postcode === "00000") return json({ ok: false, error: "Invalid postcode" }, 422);

    const normalized = {
      recipient_name: recipientName, phone, address_line1: line1, address_line2: line2 || null,
      city, postcode, state, country,
    };

    if (body.dry_run === true) {
      return json({ ok: true, dry_run: true, order: { order_db_id: order.id, order_no: order.order_no ?? order.order_id }, address: normalized });
    }

    const { data: customer, error: customerError } = await sb.from("customers")
      .select("id,customer_master_id").eq("id", order.customer_id).limit(1).maybeSingle();
    if (customerError) throw customerError;
    const masterId = customer?.customer_master_id ?? null;

    const { data: hash, error: hashError } = await sb.rpc("icetak_address_hash", {
      p_recipient_name: recipientName, p_phone: phone, p_address_line1: line1, p_address_line2: line2,
      p_city: city, p_postcode: postcode, p_state: state, p_country: country,
    });
    if (hashError) throw hashError;

    let existingQuery = sb.from("customer_addresses").select("*").is("archived_at", null).eq("address_hash", hash).limit(1);
    if (masterId) existingQuery = existingQuery.eq("customer_master_id", masterId);
    else existingQuery = existingQuery.eq("customer_id", order.customer_id);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) throw existingError;

    const now = new Date().toISOString();
    const sourceKey = cleanText(body.clickup_address_id ?? body.source_record_id ?? "", 160) || `clickup:${hash}`;
    let addressId: string;
    let reused = false;

    if (existing) {
      addressId = existing.id;
      reused = true;
      const metadata = { ...(existing.metadata ?? {}), last_import_source: "clickup_legacy", last_imported_at: now, source_record_id: sourceKey };
      const { error } = await sb.from("customer_addresses").update({
        recipient_name: recipientName, phone, address_line1: line1, address_line2: line2 || null,
        city, postcode, state, country, last_used_at: now, usage_count: Number(existing.usage_count ?? 0) + 1,
        metadata, updated_at: now,
      }).eq("id", addressId);
      if (error) throw error;
    } else {
      const rawAddress = [line1, line2, `${postcode} ${city}`, state, country].filter(Boolean).join(", ");
      const { data: inserted, error } = await sb.from("customer_addresses").insert({
        customer_id: order.customer_id,
        customer_master_id: masterId,
        label: "ClickUp Legacy",
        recipient_name: recipientName,
        phone,
        address_line1: line1,
        address_line2: line2 || null,
        city,
        postcode,
        state,
        country,
        is_default: false,
        source_provider: "clickup_legacy",
        source_order_id: order.id,
        source_order_sn: order.order_no ?? order.order_id,
        source_address_key: sourceKey,
        raw_address: rawAddress,
        address_hash: hash,
        parse_status: "imported",
        parse_confidence: 1,
        is_verified: false,
        customer_confirmed_at: null,
        last_used_at: now,
        usage_count: 1,
        metadata: { imported_by: "address-import", source: "clickup_legacy", source_record_id: sourceKey },
      }).select("id").single();
      if (error) throw error;
      addressId = inserted.id;
    }

    const { error: orderUpdateError } = await sb.from("orders").update({
      delivery_name: recipientName,
      delivery_phone: phone,
      delivery_address: line1,
      delivery_city: city,
      delivery_postcode: postcode,
      delivery_state: state,
      delivery_address_id: addressId,
      updated_at: now,
    }).eq("id", order.id);
    if (orderUpdateError) throw orderUpdateError;

    return json({
      ok: true,
      imported: true,
      reused_address: reused,
      source: "clickup_legacy",
      order: { order_db_id: order.id, order_no: order.order_no ?? order.order_id, customer_id: order.customer_id },
      address: { address_id: addressId, ...normalized, customer_confirmed: false },
    });
  } catch (error) {
    console.error("address-import", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Address import failed" }, 500);
  }
});
