import { createClient } from '@supabase/supabase-js';

const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const supabaseKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseKey);

async function paymentSession(path: string, body?: any) {
  const token = decodeURIComponent(path.split('/')[3] || '');
  const force = Boolean(body?.force_new);
  const { data, error } = await supabase.rpc('icetak_prepare_payment', { p_order_token: token, p_force_new: force });
  if (error) throw new Error(error.message);
  return { data: { payment: data }, status: 200 };
}

async function markPendingReview(path: string) {
  const token = decodeURIComponent(path.split('/')[3] || '');
  const { error } = await supabase.rpc('icetak_mark_pending_review', { p_order_token: token });
  if (error) throw new Error(error.message);
  const { data } = await supabase.rpc('icetak_prepare_payment', { p_order_token: token, p_force_new: false });
  return { data: { payment: data }, status: 200 };
}

async function request(method: string, path: string, body?: unknown) {
  if (method === 'POST' && path.includes('/payment-session')) return paymentSession(path, body);
  if (method === 'POST' && path.includes('/payment-receipt')) return markPendingReview(path);

  const res = await fetch(`${supabaseUrl}/functions/v1/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `Request failed (${res.status})`);
  return { data, status: res.status };
}

export const api = {
  get: (path: string) => request('GET', path),
  post: (path: string, body?: unknown) => request('POST', path, body),
  put: (path: string, body?: unknown) => request('PUT', path, body),
  patch: (path: string, body?: unknown) => request('PATCH', path, body),
  delete: (path: string) => request('DELETE', path),
};

export const ws = {
  connect(channel = 'icetak', handler?: (msg: any) => void) {
    const ch = supabase.channel(channel);
    if (handler) ch.on('broadcast', { event: 'message' }, (payload: any) => handler(payload));
    ch.subscribe();
    return {
      ready: Promise.resolve(),
      connectionId: channel,
      onMessage(cb: (msg: any) => void) {
        ch.on('broadcast', { event: 'message' }, (payload: any) => cb(payload));
      },
      send(event: string, payload: unknown) {
        ch.send({ type: 'broadcast', event, payload });
      },
      close() {
        supabase.removeChannel(ch);
      },
    };
  },
};

async function showPaymentIdOnOrderDetail() {
  const app = document.querySelector('#app');
  if (!app) return;
  const text = app.textContent || '';
  if (!text.includes('Order Detail')) return;
  if (document.querySelector('[data-payment-id-box]')) return;

  const orderMatch = text.match(/ICT-\d{8}-[A-Z0-9]+/);
  const token = new URLSearchParams(location.search).get('order');
  if (!orderMatch && !token) return;

  let orderQuery = supabase.from('orders').select('id,order_no,payment_status,status,tab,public_token').limit(1);
  const { data: orders } = token ? await orderQuery.eq('public_token', token) : await orderQuery.eq('order_no', orderMatch![0]);
  const order = orders?.[0];
  if (!order) return;

  const paid = order.payment_status === 'paid' || order.status === 'payment_received';
  if (!paid) return;

  const { data: sessions } = await supabase
    .from('payment_sessions')
    .select('id,transaction_id,status,matched_at,expected_amount')
    .eq('order_id', order.id)
    .order('created_at', { ascending: false })
    .limit(5);

  const matched = (sessions || []).find((row: any) => row.status === 'matched') || sessions?.[0];

  document.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    const label = (button.textContent || '').toLowerCase();
    if (label.includes('pay') || label.includes('upload receipt')) {
      button.disabled = true;
      button.textContent = 'Payment Received';
      button.style.display = 'none';
    }
  });

  const target = document.querySelector('.order-detail-actions') || document.querySelector('.order-detail-page') || app;
  const box = document.createElement('section');
  box.setAttribute('data-payment-id-box', '1');
  box.className = 'payment-box paid';
  box.innerHTML = `<b>Payment: Paid ✅</b><p>Bayaran telah diterima. Order sudah masuk proses seterusnya.</p>${matched?.transaction_id ? `<p><small>Payment ID</small><br><b>${matched.transaction_id}</b></p>` : ''}${matched?.id ? `<p><small>Payment Session</small><br><b>${matched.id}</b></p>` : ''}`;
  target.parentNode?.insertBefore(box, target);
}

if (typeof window !== 'undefined') {
  const observer = new MutationObserver(() => showPaymentIdOnOrderDetail().catch(() => undefined));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', () => showPaymentIdOnOrderDetail().catch(() => undefined));
}
