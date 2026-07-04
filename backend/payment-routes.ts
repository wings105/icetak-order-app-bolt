import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './index';

export const paymentRouter = Router();

// POST /api/payments/:orderId/sessions — create a payment session
paymentRouter.post('/:orderId/sessions', async (req, res) => {
  const { orderId } = req.params;
  const { expected_amount, base_amount, discount } = req.body as {
    expected_amount: number;
    base_amount: number;
    discount?: number;
  };

  if (!expected_amount || !base_amount) {
    res.status(400).json({ error: 'expected_amount and base_amount are required' });
    return;
  }

  const { data, error } = await supabase
    .from('payment_sessions')
    .insert({
      order_id: orderId,
      expected_amount,
      base_amount,
      discount: discount ?? null,
      status: 'pending',
    })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// PATCH /api/payments/sessions/:id — update session status
paymentRouter.patch('/sessions/:id', async (req, res) => {
  const { id } = req.params;
  const { status, transaction_id, receipt_path, receipt_name } = req.body as {
    status?: string;
    transaction_id?: string;
    receipt_path?: string;
    receipt_name?: string;
  };

  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (transaction_id) updates.transaction_id = transaction_id;
  if (receipt_path) updates.receipt_path = receipt_path;
  if (receipt_name) updates.receipt_name = receipt_name;
  if (status === 'submitted') updates.submitted_at = new Date().toISOString();
  if (status === 'matched') updates.matched_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('payment_sessions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// GET /api/payments/:orderId/sessions
paymentRouter.get('/:orderId/sessions', async (req, res) => {
  const { orderId } = req.params;
  const { data, error } = await supabase
    .from('payment_sessions')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

export function createPaymentService(_client: SupabaseClient) {
  return { paymentRouter };
}
