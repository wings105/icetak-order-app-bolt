import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-webhook-key,authorization,apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: "Supabase env is not configured" }, 500);

  const rawWebhookKey = req.headers.get("x-webhook-key") || "";
  if (!rawWebhookKey) return json({ success: false, error: "Unauthorized" }, 401);

  let authorized = false;
  const envWebhookKey = Deno.env.get("PAYMENT_WEBHOOK_KEY") || Deno.env.get("WEBHOOK_KEY") || "";
  if (envWebhookKey && rawWebhookKey === envWebhookKey) authorized = true;

  if (!authorized) {
    const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/integration_settings?key=eq.payment_webhook&select=key_hash&limit=1`, {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    const settings = await settingsResponse.json().catch(() => []);
    authorized = Boolean(settings?.[0]?.key_hash) && (await sha256(rawWebhookKey)) === settings[0].key_hash;
  }

  if (!authorized) return json({ success: false, error: "Unauthorized" }, 401);

  const payload = await req.json().catch(() => ({}));
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/icetak_payment_webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ p_payload: payload }),
  });

  const data = await response.json().catch(() => ({ success: false, error: "Bad RPC response" }));
  return json(data, response.ok ? 200 : 400);
});
