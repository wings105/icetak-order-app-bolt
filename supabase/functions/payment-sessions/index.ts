import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    // Routes:
    //   GET  /payment-sessions?order_id=xxx          list sessions for an order
    //   POST /payment-sessions                        create a payment session
    //   PATCH /payment-sessions/:id                   update session (status, receipt, txn)

    const parts = url.pathname.replace(/^\/payment-sessions\/?/, "").split("/").filter(Boolean);
    const sessionId = parts[0] ?? null;

    // GET — list sessions for an order
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

    // POST — create a session
    if (req.method === "POST") {
      const body = await req.json() as {
        order_id: string;
        expected_amount: number;
        base_amount: number;
        discount?: number;
      };

      if (!body.order_id || !body.expected_amount || !body.base_amount) {
        return json({ error: "order_id, expected_amount, and base_amount are required" }, 400);
      }

      const { data, error } = await supabase
        .from("payment_sessions")
        .insert({
          order_id: body.order_id,
          expected_amount: body.expected_amount,
          base_amount: body.base_amount,
          discount: body.discount ?? null,
          status: "pending",
        })
        .select()
        .single();

      if (error) return json({ error: error.message }, 500);
      return json(data, 201);
    }

    // PATCH — update a session
    if (req.method === "PATCH") {
      if (!sessionId) return json({ error: "Session ID required in path" }, 400);

      const body = await req.json() as {
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
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
