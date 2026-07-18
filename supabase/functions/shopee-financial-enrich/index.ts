import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BROKER_URL = Deno.env.get("SHOPEE_FINANCIAL_BROKER_URL") || "";
const BROKER_TOKEN = Deno.env.get("SHOPEE_FINANCIAL_BROKER_TOKEN") || "";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

type JsonRecord = Record<string, unknown>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function isObject(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function rpc(name: string, parameters: JsonRecord) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(parameters),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${name} ${response.status}: ${body.slice(0, 400)}`);
  return body ? JSON.parse(body) : null;
}

async function requestFinancialDetail(job: JsonRecord) {
  const response = await fetch(BROKER_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${BROKER_TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": String(job.job_id),
      "user-agent": "icetak-marketplace-financial-enricher/1.0",
    },
    body: JSON.stringify({
      provider: "shopee",
      action: "get_financial_release",
      order_sn: job.order_sn,
      shop_id: job.shop_id,
      region: job.region,
      currency: job.currency,
      requested_fields: [
        "escrow_amount",
        "released_amount",
        "commission_fee",
        "service_fee",
        "transaction_fee",
        "other_fees",
        "settlement_status",
        "released_at",
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`broker ${response.status}: ${text.slice(0, 500)}`);
  }
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("broker returned invalid JSON");
  }
  if (!isObject(payload)) throw new Error("broker response must be a JSON object");
  return payload;
}

Deno.serve(async (request) => {
  if (request.method === "GET") {
    return json({
      ok: true,
      service: "shopee-financial-enrich",
      configured: Boolean(BROKER_URL && BROKER_TOKEN),
      mode: "secure-broker",
    });
  }
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "server_not_configured" }, 500);

  if (!BROKER_URL || !BROKER_TOKEN) {
    return json({
      ok: true,
      configured: false,
      processed: 0,
      message: "Set SHOPEE_FINANCIAL_BROKER_URL and SHOPEE_FINANCIAL_BROKER_TOKEN.",
    });
  }

  let limit = 10;
  try {
    const requestBody = await request.json();
    if (isObject(requestBody) && typeof requestBody.limit === "number") {
      limit = Math.max(1, Math.min(50, Math.trunc(requestBody.limit)));
    }
  } catch {
    // Empty body uses the default batch size.
  }

  let jobs: JsonRecord[] = [];
  try {
    const claimed = await rpc("claim_marketplace_enrichment_jobs", { p_limit: limit });
    jobs = Array.isArray(claimed) ? claimed.filter(isObject) : [];
  } catch (error) {
    console.error("Unable to claim financial jobs", error);
    return json({ ok: false, error: "claim_failed" }, 500);
  }

  const results: JsonRecord[] = [];
  for (const job of jobs) {
    try {
      const payload = await requestFinancialDetail(job);
      await rpc("complete_marketplace_financial_enrichment", {
        p_job_id: job.job_id,
        p_payload: payload,
      });
      results.push({ job_id: job.job_id, order_sn: job.order_sn, status: "completed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Financial enrichment failed", job.job_id, message);
      await rpc("fail_marketplace_enrichment_job", {
        p_job_id: job.job_id,
        p_error: message,
      });
      results.push({ job_id: job.job_id, order_sn: job.order_sn, status: "failed" });
    }
  }

  return json({
    ok: true,
    configured: true,
    claimed: jobs.length,
    completed: results.filter((item) => item.status === "completed").length,
    failed: results.filter((item) => item.status === "failed").length,
    results,
  });
});
