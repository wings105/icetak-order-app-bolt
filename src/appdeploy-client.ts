import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const supabaseKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseKey);

const fnBase = `${supabaseUrl}/functions/v1`;

function headers() {
  return {
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Apikey': supabaseKey,
  };
}

async function request(method: string, path: string, body?: unknown) {
  const url = `${fnBase}/api${path}`;
  const res = await fetch(url, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
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
  connect(channel: string, handler?: (msg: any) => void) {
    const ch = supabase.channel(channel);
    if (handler) ch.on('broadcast', { event: 'message' }, (payload: any) => handler(payload));
    ch.subscribe();
    return {
      send(event: string, payload: unknown) {
        ch.send({ type: 'broadcast', event, payload });
      },
      close() {
        supabase.removeChannel(ch);
      },
    };
  },
};
