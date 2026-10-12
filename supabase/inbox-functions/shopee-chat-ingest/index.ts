import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BRIDGE_TOKEN_SHA256 = "bf0045cafee30af53fc7cd3ffb060556ee6ce930c809e8b59f165eea8eb72e48";
const ORDER_CUSTOMER_MATCH_URL =
  "https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/shopee-customer-match";
const MAX_BODY_BYTES = 512 * 1024;

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

function textValue(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function extractBuyerIdentity(payload: Record<string, unknown>) {
  const data = isObject(payload.data) ? payload.data : {};
  const message = isObject(data.content) ? data.content : {};
  const sellerShopId = textValue(payload.shop_id);
  const fromShopId = textValue(message.from_shop_id);
  const toShopId = textValue(message.to_shop_id);
  const chatStatus = (textValue(message.status) || "").toLowerCase();

  let username: string | null = null;
  let userId: string | null = null;
  let buyerShopId: string | null = null;

  if ((sellerShopId && toShopId === sellerShopId) || chatStatus === "user_chat") {
    username = textValue(message.from_user_name);
    userId = textValue(message.from_id);
    buyerShopId = fromShopId;
  } else if ((sellerShopId && fromShopId === sellerShopId) || chatStatus === "shop_chat") {
    username = textValue(message.to_user_name);
    userId = textValue(message.to_id);
    buyerShopId = toShopId;
  }

  if (!username || !userId) return null;
  const timestamp = Number(textValue(message.created_timestamp));
  return {
    username,
    user_id: userId,
    buyer_shop_id: buyerShopId,
    region: (sellerShopId === "1635364464" ? "SG" : sellerShopId === "188218638" ? "MY" : textValue(data.region) || "MY").toUpperCase(),
    observed_at: Number.isFinite(timestamp) && timestamp > 0
      ? new Date(timestamp * 1000).toISOString()
      : new Date().toISOString(),
  };
}

async function forwardBuyerIdentity(
  suppliedToken: string,
  sourceEventId: string,
  sourceReceivedAt: string,
  identity: Record<string, unknown>,
) {
  try {
    const response = await fetch(ORDER_CUSTOMER_MATCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-token": suppliedToken,
      },
      body: JSON.stringify({
        ...identity,
        source_event_id: sourceEventId,
        observed_at: identity.observed_at || sourceReceivedAt,
      }),
    });
    if (!response.ok) {
      console.error("Shopee buyer identity match failed", response.status);
    }
  } catch (error) {
    console.error("Shopee buyer identity match failed", error);
  }
}

async function callRpc(name: string, parameters: Record<string, unknown>) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(parameters),
  });
  const responseText = await response.text();
  if (!response.ok) {
    console.error("Shopee RPC failed", name, response.status, responseText.slice(0, 500));
    throw new Error(`${name} failed with ${response.status}`);
  }
  const result = responseText ? JSON.parse(responseText) : [];
  return Array.isArray(result) ? result[0] : result;
}

Deno.serve(async (request) => {
  try {
    if (request.method === "GET" || request.method === "HEAD") {
      return request.method === "HEAD"
        ? new Response(null, { status: 204, headers: JSON_HEADERS })
        : json({ ok: true, service: "shopee-chat-ingest", mode: "message-and-conversation-events" });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    const suppliedToken = request.headers.get("x-webhook-token") || "";
    const suppliedHash = await sha256Hex(suppliedToken);
    let authorized = constantTimeEqual(suppliedHash, BRIDGE_TOKEN_SHA256);
    const internalToken=request.headers.get('x-admin-window-token')||'';
    if(!authorized && internalToken){
      const r=await fetch(`${SUPABASE_URL}/rest/v1/private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1`,{headers:{apikey:SERVICE_KEY,authorization:`Bearer ${SERVICE_KEY}`},signal:AbortSignal.timeout(10000)});
      const rows=await r.json().catch(()=>[]);const expected=r.ok?rows?.[0]?.setting_value:null;
      authorized=!!expected&&constantTimeEqual(await sha256Hex(internalToken),await sha256Hex(expected));
    }
    if (!authorized) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ ok: false, error: "server_not_configured" }, 500);
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
      return json({ ok: false, error: "payload_too_large" }, 413);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    if (!isObject(body) || !isObject(body.payload)) {
      return json({ ok: false, error: "invalid_envelope" }, 400);
    }

    const sourceEventId = typeof body.source_event_id === "string" ? body.source_event_id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceEventId)) {
      return json({ ok: false, error: "invalid_source_event_id" }, 400);
    }
    if (String(body.payload.code || "") !== "10") {
      return json({ ok: false, error: "not_shopee_chat" }, 422);
    }

    const data = isObject(body.payload.data) ? body.payload.data : {};
    const eventClass = data.type === "notification"
      ? "conversation_event"
      : data.type === "message"
      ? "message"
      : "unsupported";

    if (eventClass === "unsupported") {
      return json({ ok: false, error: "unsupported_code_10_type", type: data.type || null }, 422);
    }

    const sourceReceivedAt =
      typeof body.source_received_at === "string" ? body.source_received_at : new Date().toISOString();

    if (eventClass === "conversation_event") {
      const ingestion = await callRpc("ingest_shopee_conversation_event", {
        p_source_event_id: sourceEventId,
        p_source_received_at: sourceReceivedAt,
        p_payload: body.payload,
      });
      return json({
        ok: true,
        ingested: true,
        classification: eventClass,
        inserted: Boolean(ingestion?.inserted),
        conversation_id: ingestion?.conversation_id || null,
        conversation_event_id: ingestion?.event_id || null,
        event_type: ingestion?.event_type || null,
      });
    }

    const ingestion = await callRpc("ingest_shopee_chat_event", {
      p_source_event_id: sourceEventId,
      p_source_received_at: sourceReceivedAt,
      p_payload: body.payload,
      p_is_history: body.is_history === true,
    });

    const buyerIdentity = extractBuyerIdentity(body.payload);
    if (buyerIdentity && body.is_history !== true && suppliedToken) {
      EdgeRuntime.waitUntil(forwardBuyerIdentity(
        suppliedToken,
        sourceEventId,
        sourceReceivedAt,
        buyerIdentity,
      ));
    }

    return json({
      ok: true,
      ingested: true,
      classification: eventClass,
      inserted: Boolean(ingestion?.inserted),
      conversation_id: ingestion?.conversation_id || null,
      message_id: ingestion?.message_id || null,
    });
  } catch (error) {
    console.error("Shopee chat ingestion failed", error);
    return json({ ok: false, error: "ingestion_failed" }, 500);
  }
});
