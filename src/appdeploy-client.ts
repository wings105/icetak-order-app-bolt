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

async function secureAdminRpc(path: string, body?: any) {
  const routes: Record<string, { name: string; args?: Record<string, unknown> }> = {
    '/api/admin/orders': { name: 'icetak_admin_create_order', args: { p_payload: body || {} } },
    '/api/admin/order-action': { name: 'icetak_admin_order_action', args: { p_payload: body || {} } },
    '/api/admin/order-update': { name: 'icetak_admin_order_update', args: { p_payload: body || {} } },
    '/api/admin/permissions': { name: 'icetak_admin_save_permissions', args: { p_payload: body || {} } },
    '/api/admin/export': { name: 'icetak_admin_export_data' },
  };
  const route = routes[path];
  if (!route) return null;
  const { data, error } = await supabase.rpc(route.name as any, route.args as any);
  if (error) throw new Error(error.message);
  return { data, status: 200 };
}

function functionForPath(path: string) {
  if (path.startsWith('/api/admin/dashboard')) return 'api-admin-secure';
  return 'api';
}

function functionPath(path: string, functionName: string) {
  if (functionName === 'api-admin-secure') return '/dashboard';
  if (functionName === 'api') return path.replace(/^\/api/, '');
  return path;
}

function normalizePublicOrders(data: any) {
  const normalize = (order: any) => {
    if (!order || typeof order !== 'object') return order;
    if (String(order.delivery || '').toLowerCase().includes('pickup')) order.delivery = 'Pickup';
    return order;
  };
  if (data?.order) data.order = normalize(data.order);
  if (Array.isArray(data?.orders)) data.orders = data.orders.map(normalize);
  return data;
}

async function request(method: string, path: string, body?: unknown) {
  if (method === 'POST' && path.includes('/payment-session')) return paymentSession(path, body);
  if (method === 'POST' && path.includes('/payment-receipt')) return markPendingReview(path);
  if (method === 'POST' && path.startsWith('/api/admin/')) {
    const direct = await secureAdminRpc(path, body);
    if (direct) return direct;
  }

  const functionName = functionForPath(path);
  const token = sessionStorage.getItem('admin_access_token') || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (functionName === 'api-admin-secure' && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}${functionPath(path, functionName)}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `Request failed (${res.status})`);

  if (functionName === 'api') normalizePublicOrders(data);
  if (functionName === 'api-admin-secure' && path.startsWith('/api/admin/dashboard')) {
    const { data: shaped, error } = await supabase.rpc('icetak_admin_dashboard_for_current_user');
    if (!error && shaped?.orders) (data as any).orders = shaped.orders;
  }

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
