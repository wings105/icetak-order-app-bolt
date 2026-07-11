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
