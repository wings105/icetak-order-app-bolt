import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-icetak-webhook-secret,x-webhook-key,x-request-id,webhook-id,webhook-timestamp",
};
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const CONNECTIONS = new Set(["qrpay-in", "cimb-out", "bank-statement"]);

type JsonObject = Record<string, unknown>;
type Normalized = {
  amount: number | null;
  direction: "in" | "out" | null;
  occurred_at: string;
  external_reference: string | null;
  bank_reference: string | null;
  description: string | null;
  counterparty: string | null;
  currency: string;
  confidence: number;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as JsonObject;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== "object") return value;
  const output: JsonObject = {};
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (/secret|password|api[_-]?key|access[_-]?token|authorization/i.test(key)) continue;
    output[key] = scrub(child);
  }
  return output;
}

function pick(row: JsonObject, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

function textValue(value: unknown) {
  const value_ = String(value ?? "").trim();
  return value_ || null;
}

function amountValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value);
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  const parsed = Number(raw.replace(/[(),\s]/g, "").replace(/^RM/i, "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.abs(negative ? -parsed : parsed);
}

function isoDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00+08:00`;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    return raw.replace(" ", "T") + "+08:00";
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function normalize(row: JsonObject, slug: string): Normalized {
  const explicitDirection = String(pick(row, ["direction", "flow", "debit_credit", "dr_cr", "transaction_direction"]) || "").toLowerCase();
  const type = String(pick(row, ["type", "transaction_type", "entry_type"]) || "").toLowerCase();
  const credit = amountValue(pick(row, ["credit", "credit_amount", "money_in", "deposit"]));
  const debit = amountValue(pick(row, ["debit", "debit_amount", "money_out", "withdrawal"]));
  const rawAmount = pick(row, ["amount", "transaction_amount", "paid_amount", "value", "net_amount"]);
  let direction: "in" | "out" | null = slug === "qrpay-in" ? "in" : slug === "cimb-out" ? "out" : null;
  if (/(^|\b)(out|debit|dr|withdrawal|expense|payment)(\b|$)/.test(explicitDirection || type)) direction = "out";
  if (/(^|\b)(in|credit|cr|deposit|income|receipt)(\b|$)/.test(explicitDirection || type)) direction = "in";
  if (!direction && credit) direction = "in";
  if (!direction && debit) direction = "out";
  if (!direction && typeof rawAmount === "number") direction = rawAmount < 0 ? "out" : "in";
  const amount = credit || debit || amountValue(rawAmount);
  const date = pick(row, ["occurred_at", "transaction_datetime", "transaction_date", "paid_at", "posted_at", "timestamp", "date", "created_at"]);
  return {
    amount,
    direction,
    occurred_at: isoDate(date),
    external_reference: textValue(pick(row, ["external_reference", "transaction_id", "transactionId", "event_id", "id", "reference_id", "reference"])),
    bank_reference: textValue(pick(row, ["bank_reference", "bank_ref", "reference_no", "ref_no", "rrn", "duitnow_reference", "recipient_reference"])),
    description: textValue(pick(row, ["description", "narrative", "details", "remark", "remarks", "memo", "transaction_description"])),
    counterparty: textValue(pick(row, ["counterparty", "sender_name", "recipient_name", "merchant_name", "payer_name", "payee_name", "beneficiary_name"])),
    currency: String(pick(row, ["currency", "currency_code"]) || "MYR").toUpperCase(),
    confidence: amount && direction ? 1 : amount || direction ? 0.65 : 0.25,
  };
}

async function rpc(name: string, body: JsonObject) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ error: `RPC ${name} returned invalid JSON` }));
  if (!response.ok) throw new Error(data?.message || data?.error || `RPC ${name} failed with HTTP ${response.status}`);
  return data;
}

async function processRow(row: JsonObject, slug: string, secretHash: string, safeHeaders: JsonObject, batchKey: string | null, rowIndex: number) {
  const clean = scrub(row) as JsonObject;
  const normalized = normalize(clean, slug);
  const payloadHash = await sha256(stable(clean));
  const externalId = normalized.external_reference;
  const idempotencyKey = externalId ? `external:${externalId}` : batchKey ? `batch:${batchKey}:${rowIndex}:${payloadHash}` : `payload:${payloadHash}`;
  let paymentMatch: JsonObject | null = null;

  if (slug === "qrpay-in" && normalized.amount) {
    paymentMatch = await rpc("icetak_payment_webhook", {
      p_payload: {
        ...clean,
        amount: normalized.amount,
        transaction_id: externalId || `finance_${payloadHash.slice(0, 24)}`,
        sender_name: normalized.counterparty || "",
        provider: String(pick(clean, ["provider", "source"]) || "finance-qrpay"),
      },
    });
  }

  return rpc("finance_ingest_event", {
    p_connection_slug: slug,
    p_secret_hash: secretHash,
    p_idempotency_key: idempotencyKey,
    p_external_event_id: externalId,
    p_payload_hash: payloadHash,
    p_headers: safeHeaders,
    p_payload: clean,
    p_normalized: normalized,
    p_payment_match: paymentMatch,
    p_import_batch_id: null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ success: false, error: "Finance runtime is not configured" }, 500);

  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const functionIndex = segments.lastIndexOf("finance-webhook");
  const slug = functionIndex >= 0 ? segments[functionIndex + 1] : null;
  if (!slug || !CONNECTIONS.has(slug)) return json({ success: false, error: "Unknown finance source" }, 404);

  const secret = req.headers.get("x-icetak-webhook-secret") || req.headers.get("x-webhook-key") || "";
  if (!secret) return json({ success: false, error: "Unauthorized" }, 401);
  const secretHash = await sha256(secret);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ success: false, error: "Payload too large" }, 413);
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ success: false, error: "Payload too large" }, 413);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  const envelope = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as JsonObject : {};
  const rowsCandidate = Array.isArray(payload) ? payload
    : Array.isArray(envelope.transactions) ? envelope.transactions
    : slug === "bank-statement" && Array.isArray(envelope.data) ? envelope.data
    : [payload];
  if (rowsCandidate.length > 5000) return json({ success: false, error: "Maximum 5000 transactions per request" }, 413);
  const rows = rowsCandidate.filter((row): row is JsonObject => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  if (!rows.length) return json({ success: false, error: "No transaction rows found" }, 400);

  const safeHeaders = {
    "user-agent": req.headers.get("user-agent"),
    "x-request-id": req.headers.get("x-request-id"),
    "webhook-id": req.headers.get("webhook-id"),
    "webhook-timestamp": req.headers.get("webhook-timestamp"),
  };
  const batchKey = textValue(pick(envelope, ["batch_id", "statement_id", "import_id", "file_id"]));
  const results: unknown[] = [];
  let errors = 0;
  for (let index = 0; index < rows.length; index += 1) {
    try {
      results.push(await processRow(rows[index], slug, secretHash, safeHeaders, batchKey, index));
    } catch (error) {
      errors += 1;
      results.push({ success: false, row: index, error: error instanceof Error ? error.message : "Unknown processing error" });
    }
  }

  return json({
    success: errors === 0,
    source: slug,
    received: rows.length,
    processed: rows.length - errors,
    errors,
    results,
  }, errors === rows.length ? 400 : 200);
});
