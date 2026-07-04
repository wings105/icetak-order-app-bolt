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
    //   GET  /shipment-events?order_id=xxx       list events for an order
    //   POST /shipment-events                     create a shipment event
    //   PATCH /shipment-events/:id                update a shipment event

    const parts = url.pathname.replace(/^\/shipment-events\/?/, "").split("/").filter(Boolean);
    const eventId = parts[0] ?? null;

    // GET — list events for an order
    if (req.method === "GET") {
      const orderId = url.searchParams.get("order_id");
      if (!orderId) return json({ error: "order_id query param required" }, 400);

      const { data, error } = await supabase
        .from("shipment_events")
        .select("*")
        .eq("order_id", orderId)
        .order("event_time", { ascending: true });

      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    // POST — create a shipment event
    if (req.method === "POST") {
      const body = await req.json() as {
        order_id: string;
        event_key?: string;
        tracking_no?: string;
        courier?: string;
        status?: string;
        status_group?: string;
        event_name?: string;
        event_time?: string;
      };

      if (!body.order_id) return json({ error: "order_id is required" }, 400);

      const { data, error } = await supabase
        .from("shipment_events")
        .insert({
          order_id: body.order_id,
          event_key: body.event_key ?? null,
          tracking_no: body.tracking_no ?? null,
          courier: body.courier ?? null,
          status: body.status ?? null,
          status_group: body.status_group ?? null,
          event_name: body.event_name ?? null,
          event_time: body.event_time ?? new Date().toISOString(),
        })
        .select()
        .single();

      if (error) return json({ error: error.message }, 500);
      return json(data, 201);
    }

    // PATCH — update a shipment event
    if (req.method === "PATCH") {
      if (!eventId) return json({ error: "Event ID required in path" }, 400);

      const body = await req.json() as Record<string, unknown>;
      const { data, error } = await supabase
        .from("shipment_events")
        .update(body)
        .eq("id", eventId)
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
