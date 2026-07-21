import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function legacyShape(result: Record<string, unknown>, orderId: string) {
  const expiresMs = Number(result.expiresAt || 0);
  return {
    id: result.id,
    order_id: orderId,
    order_token: result.orderToken,
    expected_amount: Number(result.expectedAmount || 0),
    base_amount: Number(result.baseAmount || 0),
    discount: Number(result.discount || 0),
    status: result.status || "pending",
    expires_at: expiresMs ? new Date(expiresMs).toISOString() : null,
    transaction_id: result.transactionId || null,
    receipt_name: result.receiptName || null,
    submitted_at: Number(result.submittedAt || 0) ? new Date(Number(result.submittedAt)).toISOString() : null,
    matched_at: Number(result.matchedAt || 0) ? new Date(Number(result.matchedAt)).toISOString() : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/payment-sessions\/?/, "").split("/").filter(Boolean);
    const sessionId = parts[0] ?? null;

    if (req.method === "GET") {
      const orderId = url.searchParams.get("order_id");
      if (!orderId) return json({ error: "order_id query param required" }, 400);

      const { data, error } = await supabase
        .from("payment_sessions")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });

      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({})) as {
        order_id?: string;
        force_new?: boolean;
      };

      if (!body.order_id) return json({ error: "order_id is required" }, 400);

      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id,public_token,total")
        .eq("id", body.order_id)
        .maybeSingle();

      if (orderError) return json({ error: orderError.message }, 500);
      if (!order?.public_token) return json({ error: "Order not found" }, 404);

      const { data, error } = await supabase.rpc("icetak_prepare_payment", {
        p_order_token: order.public_token,
        p_force_new: Boolean(body.force_new),
      });

      if (error) {
        const status = error.message.includes("temporarily full") ? 409 : 500;
        return json({ error: error.message }, status);
      }

      return json(legacyShape(data as Record<string, unknown>, order.id), 201);
    }

    if (req.method === "PATCH") {
      if (!sessionId) return json({ error: "Session ID required in path" }, 400);

      const body = await req.json().catch(() => ({})) as {
        status?: string;
        transaction_id?: string;
        receipt_path?: string;
        receipt_name?: string;
      };

      const updates: Record<string, unknown> = {};
      if (body.status !== undefined) updates.status = body.status;
      if (body.transaction_id !== undefined) updates.transaction_id = body.transaction_id;
      if (body.receipt_path !== undefined) updates.receipt_path = body.receipt_path;
      if (body.receipt_name !== undefined) updates.receipt_name = body.receipt_name;
      if (body.status === "submitted") updates.submitted_at = new Date().toISOString();
      if (body.status === "matched") updates.matched_at = new Date().toISOString();

      const { data, error } = await supabase
        .from("payment_sessions")
        .update(updates)
        .eq("id", sessionId)
        .select()
        .single();

      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
