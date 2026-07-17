import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CAPTURE_TOKEN_SHA256 = "bf0045cafee30af53fc7cd3ffb060556ee6ce930c809e8b59f165eea8eb72e48";
const UNIFIED_INBOX_CHAT_URL =
  "https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-chat-ingest";
const MAX_BODY_BYTES = 1024 * 1024;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

type JsonRecord = Record<string, unknown>;

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

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function deepFind(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, keys, depth + 1);
      if (found !== undefined && found !== null && found !== "") return found;
    }
    return undefined;
  }

  const record = value as JsonRecord;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  for (const child of Object.values(record)) {
    const found = deepFind(child, keys, depth + 1);
    if (found !== undefined && found !== null && found !== "") return found;
  }
  return undefined;
}

function stringValue(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value || null;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function eventCodeValue(value: unknown) {
  const text = stringValue(value);
  if (!text || !/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

function timestampValue(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    let number = Number(text);
    if (!Number.isFinite(number)) return null;
    if (number >= 1e15) number /= 1e6;
    else if (number >= 1e12) number /= 1e3;
    else number *= 1e3;
    const date = new Date(number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseBody(rawBody: string, contentType: string) {
  const trimmed = rawBody.trim();
  if (!trimmed) return { parsed: null as unknown, parseError: null as string | null, lineCode: null as number | null };

  try {
    return { parsed: JSON.parse(trimmed), parseError: null, lineCode: null };
  } catch (jsonError) {
    const tabMatch = trimmed.match(/^(\d+)\t([\s\S]+)$/);
    if (tabMatch) {
      try {
        return {
          parsed: JSON.parse(tabMatch[2]),
          parseError: null,
          lineCode: Number(tabMatch[1]),
        };
      } catch {
        // Preserve the original JSON error below.
      }
    }

    if (contentType.includes("application/x-www-form-urlencoded")) {
      try {
        const entries: JsonRecord = {};
        for (const [key, value] of new URLSearchParams(trimmed)) {
          try {
            entries[key] = JSON.parse(value);
          } catch {
            entries[key] = value;
          }
        }
        return { parsed: entries, parseError: null, lineCode: null };
      } catch {
        // Preserve the original JSON error below.
      }
    }

    return {
      parsed: null,
      parseError: jsonError instanceof Error ? jsonError.message.slice(0, 500) : "Invalid JSON",
      lineCode: null,
    };
  }
}

function safeHeaders(headers: Headers) {
  const result: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    const lowerName = name.toLowerCase();
    result[lowerName] = /authorization|cookie|(^|-)api-?key|(^|-)token|secret/.test(lowerName)
      ? "[REDACTED]"
      : value.slice(0, 4000);
  }
  return result;
}

function safeQuery(url: URL) {
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of url.searchParams.entries()) {
    if (name === "token") {
      result[name] = "[REDACTED]";
      continue;
    }
    const current = result[name];
    if (current === undefined) result[name] = value;
    else if (Array.isArray(current)) current.push(value);
    else result[name] = [current, value];
  }
  return result;
}

async function callCaptureRpc(payload: JsonRecord) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/capture_marketplace_webhook`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Capture RPC ${response.status}: ${responseText.slice(0, 500)}`);
  }
  return responseText ? JSON.parse(responseText) : [];
}

async function setProcessingStatus(eventId: string, status: "processed" | "failed", error?: unknown) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/marketplace_webhook_events?id=eq.${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({
        processing_status: status,
        processed_at: status === "processed" ? new Date().toISOString() : null,
        last_error: status === "failed"
          ? (error instanceof Error ? error.message : String(error)).slice(0, 1000)
          : null,
      }),
    },
  );
  if (!response.ok) {
    console.error("Unable to update marketplace event processing status", response.status);
  }
}

async function forwardShopeeChat(
  eventId: string,
  payload: unknown,
  suppliedToken: string,
  sourceReceivedAt: string,
) {
  try {
    const response = await fetch(UNIFIED_INBOX_CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-token": suppliedToken,
      },
      body: JSON.stringify({
        source_event_id: eventId,
        source_received_at: sourceReceivedAt,
        payload,
        is_history: false,
      }),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Unified Inbox ${response.status}: ${responseText.slice(0, 500)}`);
    }
    await setProcessingStatus(eventId, "processed");
  } catch (error) {
    console.error("Shopee chat forwarding failed", error);
    await setProcessingStatus(eventId, "failed", error);
  }
}

Deno.serve(async (request) => {
  try {
    if (request.method === "GET" || request.method === "HEAD") {
      return request.method === "HEAD"
        ? new Response(null, { status: 204, headers: JSON_HEADERS })
        : json({ ok: true, service: "shopee-webhook", mode: "capture-and-route" });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    const url = new URL(request.url);
    const suppliedToken = url.searchParams.get("token") || request.headers.get("x-webhook-token") || "";
    const suppliedHash = await sha256Hex(suppliedToken);
    if (!constantTimeEqual(suppliedHash, CAPTURE_TOKEN_SHA256)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ ok: false, error: "server_not_configured" }, 500);
    }

    const rawBody = await request.text();
    const requestSizeBytes = new TextEncoder().encode(rawBody).length;
    if (requestSizeBytes > MAX_BODY_BYTES) {
      return json({ ok: false, error: "payload_too_large" }, 413);
    }

    const contentType = request.headers.get("content-type") || "";
    const { parsed, parseError, lineCode } = parseBody(rawBody, contentType);
    const record = asRecord(parsed);
    const eventCode = lineCode ?? eventCodeValue(
      record?.code ?? record?.event_code ?? record?.notification_type ??
        deepFind(parsed, ["event_code", "notification_type"]),
    );
    const region = stringValue(record?.region ?? deepFind(parsed, ["region"]))?.toUpperCase() ?? null;
    const shopId = stringValue(record?.shop_id ?? deepFind(parsed, ["shop_id", "to_shop_id"])) ;
    const orderSn = stringValue(deepFind(parsed, ["order_sn", "ordersn", "orderno"]));
    const packageNumber = stringValue(deepFind(parsed, ["package_number"]));
    const conversationId = stringValue(deepFind(parsed, ["conversation_id"]));
    const messageId = stringValue(deepFind(parsed, ["message_id", "msg_id"]));
    const occurredAt = timestampValue(
      record?.timestamp ?? deepFind(parsed, ["update_time", "created_timestamp", "timestamp"]),
    );

    const query = safeQuery(url);
    const eventKey = await sha256Hex(JSON.stringify({
      provider: "shopee",
      method: request.method,
      query,
      rawBody,
    }));

    const result = await callCaptureRpc({
      p_provider: "shopee",
      p_event_key: eventKey,
      p_http_method: request.method,
      p_content_type: contentType || null,
      p_event_code: eventCode,
      p_region: region,
      p_shop_id: shopId,
      p_order_sn: orderSn,
      p_package_number: packageNumber,
      p_conversation_id: conversationId,
      p_message_id: messageId,
      p_occurred_at: occurredAt,
      p_request_headers: safeHeaders(request.headers),
      p_request_query: query,
      p_raw_body: rawBody,
      p_parsed_payload: parsed,
      p_parse_error: parseError,
      p_request_size_bytes: requestSizeBytes,
    });

    const capture = Array.isArray(result) ? result[0] : result;
    if (eventCode === 10 && capture?.event_id && parsed !== null) {
      EdgeRuntime.waitUntil(forwardShopeeChat(
        String(capture.event_id),
        parsed,
        suppliedToken,
        new Date().toISOString(),
      ));
    }
    return json({
      ok: true,
      captured: true,
      duplicate: Boolean(capture?.is_duplicate),
      event_code: eventCode,
    });
  } catch (error) {
    console.error("shopee-webhook capture failed", error);
    return json({
      ok: false,
      error: "capture_failed",
      detail: error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
    }, 500);
  }
});
