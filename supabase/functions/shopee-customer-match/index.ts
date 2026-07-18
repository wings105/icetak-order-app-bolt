import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MATCH_TOKEN_SHA256 = "bf0045cafee30af53fc7cd3ffb060556ee6ce930c809e8b59f165eea8eb72e48";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

Deno.serve(async (request) => {
  try {
    if (request.method === "GET" || request.method === "HEAD") {
      return request.method === "HEAD"
        ? new Response(null, { status: 204, headers: JSON_HEADERS })
        : json({ ok: true, service: "shopee-customer-match", method: "username-region-exact" });
    }
    if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

    const suppliedToken = request.headers.get("x-webhook-token") || "";
    if (!constantTimeEqual(await sha256Hex(suppliedToken), MATCH_TOKEN_SHA256)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ ok: false, error: "server_not_configured" }, 500);
    }

    const body: unknown = await request.json();
    if (!isObject(body)) return json({ ok: false, error: "invalid_body" }, 400);

    const username = typeof body.username === "string" ? body.username.trim() : "";
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const buyerShopId = typeof body.buyer_shop_id === "string" ? body.buyer_shop_id.trim() : null;
    const region = typeof body.region === "string" ? body.region.toUpperCase() : "MY";
    const sourceEventId = typeof body.source_event_id === "string" ? body.source_event_id : null;
    const observedAt = typeof body.observed_at === "string" ? body.observed_at : new Date().toISOString();

    if (!username || !userId) return json({ ok: false, error: "username_and_user_id_required" }, 400);
    if (sourceEventId && !/^[0-9a-f-]{36}$/i.test(sourceEventId)) {
      return json({ ok: false, error: "invalid_source_event_id" }, 400);
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_marketplace_customer_identity`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_username: username,
        p_user_id: userId,
        p_buyer_shop_id: buyerShopId,
        p_region: region,
        p_source_event_id: sourceEventId,
        p_observed_at: observedAt,
      }),
    });
    const responseText = await response.text();
    if (!response.ok) {
      console.error("Customer match RPC failed", response.status, responseText.slice(0, 500));
      return json({ ok: false, error: "match_failed" }, 500);
    }

    const result = responseText ? JSON.parse(responseText) : [];
    const match = Array.isArray(result) ? result[0] : result;
    return json({
      ok: true,
      matched: true,
      method: "chat_username_exact",
      confidence: 0.85,
      customer_id: match?.customer_id || null,
      matched_orders: Number(match?.matched_orders || 0),
      conflicting_orders: Number(match?.conflicting_orders || 0),
    });
  } catch (error) {
    console.error("Shopee customer matching failed", error);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
