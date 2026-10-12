import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { extractRows, normalize, stable } from "./normalize.ts";

const URL_ROOT = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TOKEN_SHA256 = "75fd74cb1209bed495723a18684cecc442914c06da46f445c4c5016793f842e5";
const MAX_BYTES = 2 * 1024 * 1024;
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: HEADERS }); }
async function hash(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((n) => n.toString(16).padStart(2, "0")).join("");
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (request) => {
  if (request.method === "GET" || request.method === "HEAD") {
    return request.method === "HEAD" ? new Response(null, { status: 204, headers: HEADERS })
      : json({ ok: true, service: "shopee-finance-ingest", method: "POST", version: 1 });
  }
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const url = new URL(request.url);
  const token = request.headers.get("x-webhook-token") || url.searchParams.get("token") || "";
  if (!token || !equal(await hash(token), TOKEN_SHA256)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!URL_ROOT || !SERVICE_KEY) return json({ ok: false, error: "server_not_configured" }, 500);
  try {
    if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) return json({ ok: false, error: "payload_too_large" }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BYTES) return json({ ok: false, error: "payload_too_large" }, 413);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
    let rows;
    try { rows = extractRows(payload); } catch (error) { return json({ ok: false, error: "invalid_rows", detail: String(error) }, 400); }
    if (!rows.length || rows.length > 100) return json({ ok: false, error: "send_1_to_100_orders_per_request" }, 400);
    const events = await Promise.all(rows.map(async (row) => {
      const event = normalize(row);
      return { ...event, payload_hash: await hash(stable(event)) };
    }));
    const dryRun = url.searchParams.get("dry_run") === "true";
    const response = await fetch(`${URL_ROOT}/rest/v1/rpc/ingest_shopee_finance`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ p_events: events, p_dry_run: dryRun }),
    });
    if (!response.ok) {
      console.error("shopee-finance-ingest database failure", response.status);
      return json({ ok: false, error: "storage_failed", retryable: true }, 503);
    }
    const result = await response.json();
    return json(result, result.pending_order || result.needs_mapping ? 202 : 200);
  } catch (error) {
    console.error("shopee-finance-ingest request failure", error instanceof Error ? error.name : "unknown");
    return json({ ok: false, error: "ingest_failed", retryable: true }, 503);
  }
});
