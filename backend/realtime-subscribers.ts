import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

let channel: RealtimeChannel | null = null;

export function setupRealtimeSubscribers(supabase: SupabaseClient) {
  if (channel) {
    supabase.removeChannel(channel);
  }

  channel = supabase
    .channel('backend-orders')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      (payload) => {
        console.log('[realtime] new order:', payload.new);
        handleNewOrder(supabase, payload.new as { id: string; order_no: string });
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders' },
      (payload) => {
        console.log('[realtime] order updated:', payload.new);
      },
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'payment_sessions' },
      (payload) => {
        console.log('[realtime] payment session created:', payload.new);
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'payment_sessions' },
      async (payload) => {
        const session = payload.new as { id: string; order_id: string; status: string };
        console.log('[realtime] payment session updated:', session);
        if (session.status === 'matched') {
          await syncOrderPaymentStatus(supabase, session.order_id);
        }
      },
    )
    .subscribe();

  return channel;
}

async function handleNewOrder(supabase: SupabaseClient, order: { id: string; order_no: string }) {
  console.log(`[backend] processing new order ${order.order_no}`);
}

async function syncOrderPaymentStatus(supabase: SupabaseClient, orderId: string) {
  const { data: sessions, error } = await supabase
    .from('payment_sessions')
    .select('status, expected_amount')
    .eq('order_id', orderId);

  if (error) { console.error('[realtime] failed to fetch sessions:', error.message); return; }

  const allMatched = sessions?.every((s) => s.status === 'matched');
  const anyMatched = sessions?.some((s) => s.status === 'matched');
  const paymentStatus = allMatched ? 'paid' : anyMatched ? 'partial' : 'unpaid';

  await supabase.from('orders').update({ payment_status: paymentStatus }).eq('id', orderId);
  console.log(`[realtime] order ${orderId} payment_status → ${paymentStatus}`);
}
