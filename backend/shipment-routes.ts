import { Router } from 'express';
import { supabase } from './index';

export const shipmentRouter = Router();

// POST /api/shipments/:orderId/events — record a shipment event
shipmentRouter.post('/:orderId/events', async (req, res) => {
  const { orderId } = req.params;
  const { event_key, tracking_no, courier, status, status_group, event_name, event_time } = req.body as {
    event_key?: string;
    tracking_no?: string;
    courier?: string;
    status?: string;
    status_group?: string;
    event_name?: string;
    event_time?: string;
  };

  const { data, error } = await supabase
    .from('shipment_events')
    .insert({
      order_id: orderId,
      event_key: event_key ?? null,
      tracking_no: tracking_no ?? null,
      courier: courier ?? null,
      status: status ?? null,
      status_group: status_group ?? null,
      event_name: event_name ?? null,
      event_time: event_time ?? new Date().toISOString(),
    })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// GET /api/shipments/:orderId/events
shipmentRouter.get('/:orderId/events', async (req, res) => {
  const { orderId } = req.params;
  const { data, error } = await supabase
    .from('shipment_events')
    .select('*')
    .eq('order_id', orderId)
    .order('event_time', { ascending: true });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// PATCH /api/shipments/events/:id — update a shipment event
shipmentRouter.patch('/events/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body as Record<string, unknown>;

  const { data, error } = await supabase
    .from('shipment_events')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});
