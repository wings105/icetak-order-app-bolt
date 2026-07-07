import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function error(message: string, status = 400) {
  return json({ ok: false, error: message }, status);
}

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  return data;
}

async function setting(key: string) {
  const rows = await rest(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => []);
  const row = rows?.[0];
  return row?.secret_value || row?.text_value || row?.value?.url || "";
}

async function creds() {
  return {
    baseUrl: (await setting("base_url")) || "https://officialapi.wasapflow.com/bridge/v1",
    partnerKey: await setting("partner_key"),
    wabaId: await setting("waba_id"),
    webhookSecret: await setting("webhook_secret"),
  };
}

async function wasapflow(path: string, method = "GET") {
  const c = await creds();
  if (!c.partnerKey || !c.wabaId) throw new Error("WasapFlow partner_key atau waba_id belum diisi");
  const response = await fetch(`${c.baseUrl}${path}`, {
    method,
    headers: { "x-partner-key": c.partnerKey, "x-waba-id": c.wabaId },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data?.error?.message || `WasapFlow HTTP ${response.status}`);
  return data;
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return error("Supabase env missing", 500);

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/functions\/v1\/whatsapp-admin/, "").replace(/^\/whatsapp-admin/, "") || "/";

    if (req.method === "GET" && path === "/status") {
      const c = await creds();
      return json({ ok: true, configured: { partner_key: Boolean(c.partnerKey), waba_id: Boolean(c.wabaId), webhook_secret: Boolean(c.webhookSecret) }, base_url: c.baseUrl });
    }
    if (req.method === "GET" && path === "/rules") return json({ ok: true, rules: await rest("whatsapp_notification_rules?order=sort_order.asc") });
    if (req.method === "GET" && path === "/templates") return json({ ok: true, templates: await rest("whatsapp_templates?order=name.asc") });
    if (req.method === "GET" && path === "/outbox") return json({ ok: true, outbox: await rest("whatsapp_outbox?order=created_at.desc&limit=100") });

    const body = await req.json().catch(() => ({}));

    if (req.method === "POST" && path === "/settings") {
      for (const [key, value] of Object.entries(body || {})) {
        const isSecret = ["partner_key", "webhook_secret"].includes(key);
        await rest("whatsapp_settings", {
          method: "POST",
          headers: { prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify({
            provider: key === "customer_app_base_url" ? "icetak" : "wasapflow",
            key,
            text_value: isSecret ? null : String(value || ""),
            secret_value: isSecret ? String(value || "") : null,
            is_secret: isSecret,
            updated_at: new Date().toISOString(),
          }),
        });
      }
      return json({ ok: true });
    }

    if (req.method === "POST" && path === "/rules") {
      if (!body.event_type) return error("event_type required", 400);
      await rest(`whatsapp_notification_rules?event_type=eq.${encodeURIComponent(body.event_type)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return json({ ok: true });
    }

    if (req.method === "POST" && path === "/templates/sync") {
      const c = await creds();
      const data = await wasapflow("/templates", "GET");
      const list = data.templates || [];
      for (const template of list) {
        await rest("whatsapp_templates", {
          method: "POST",
          headers: { prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify({
            waba_id: c.wabaId,
            name: template.name,
            language: template.language || "ms",
            category: template.category || null,
            status: template.status || null,
            components: template.components || [],
            raw_payload: template,
            synced_at: new Date().toISOString(),
          }),
        });
      }
      return json({ ok: true, synced: list.length });
    }

    return error(`Not found: ${path}`, 404);
  } catch (err) {
    return error(err?.message || "Server error", 500);
  }
});
