import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const allowedRpc = new Set([
  "icetak_admin_pickup_ready_queue",
  "icetak_admin_pickup_customer_search",
  "icetak_admin_pickup_customer_overview",
  "icetak_admin_pickup_latest_paid_checkout",
  "icetak_admin_create_pickup_checkout",
  "icetak_admin_create_pickup_checkout_attributed",
  "icetak_admin_pickup_checkout_status",
  "icetak_admin_void_pickup_payment",
  "icetak_admin_confirm_pickup_receipt",
  "icetak_admin_pickup_handover",
  "icetak_admin_create_pickup_access",
  "icetak_admin_set_pickup_payment_whatsapp",
]);

const allowedFunctions = new Set(["pickup-receipt", "whatsapp-send"]);

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok:false, error:"method_not_allowed" }), { status:405, headers:cors });

  try {
    const body = await req.json().catch(() => ({}));
    const key = String(body?.key || "").trim();
    const kind = String(body?.kind || "rpc");
    const name = String(body?.name || "");
    const args = body?.args && typeof body.args === "object" ? body.args : {};
    if (!key) return new Response(JSON.stringify({ ok:false, error:"kiosk_key_required" }), { status:401, headers:cors });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession:false, autoRefreshToken:false },
      global: { headers: { "x-icetak-source":"pickup-kiosk" } },
    });

    const keyHash = await sha256(key);
    const { data:keyRow, error:keyError } = await supabase
      .from("pickup_kiosk_keys")
      .select("id,name,active")
      .eq("key_hash", keyHash)
      .eq("active", true)
      .maybeSingle();

    if (keyError || !keyRow) {
      return new Response(JSON.stringify({ ok:false, error:"invalid_kiosk_key" }), { status:403, headers:cors });
    }

    void supabase.from("pickup_kiosk_keys").update({ last_used_at:new Date().toISOString() }).eq("id", keyRow.id);

    if (kind === "rpc") {
      if (!allowedRpc.has(name)) return new Response(JSON.stringify({ ok:false, error:"rpc_not_allowed" }), { status:403, headers:cors });
      const { data, error } = await supabase.rpc(name, args);
      if (error) return new Response(JSON.stringify({ ok:false, error:error.message, code:error.code }), { status:400, headers:cors });
      return new Response(JSON.stringify({ ok:true, data }), { headers:cors });
    }

    if (kind === "function") {
      if (!allowedFunctions.has(name)) return new Response(JSON.stringify({ ok:false, error:"function_not_allowed" }), { status:403, headers:cors });
      const { data, error } = await supabase.functions.invoke(name, { body:args });
      if (error) return new Response(JSON.stringify({ ok:false, error:error.message }), { status:400, headers:cors });
      return new Response(JSON.stringify({ ok:true, data }), { headers:cors });
    }

    return new Response(JSON.stringify({ ok:false, error:"invalid_kind" }), { status:400, headers:cors });
  } catch (error) {
    return new Response(JSON.stringify({ ok:false, error:error instanceof Error ? error.message : String(error) }), { status:500, headers:cors });
  }
});
