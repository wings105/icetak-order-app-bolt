import { supabase } from './supabase';

export async function linkManualOrder(conversationId: string, orderNo: string, isPrimary = true): Promise<void> {
  const clean = orderNo.trim();
  if (!clean) throw new Error('Masukkan nombor order.');
  const { error } = await supabase.rpc('link_conversation_order', {
    p_conversation_id: conversationId,
    p_source_project: 'icetak-order-system',
    p_order_no: clean,
    p_external_order_id: clean,
    p_order_system_order_id: null,
    p_is_primary: isPrimary,
    p_match_method: 'manual',
    p_match_confidence: 1,
    p_metadata: {},
  });
  if (error) throw new Error(error.message);
}

