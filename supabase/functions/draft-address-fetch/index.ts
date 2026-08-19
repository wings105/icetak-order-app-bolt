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
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

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
