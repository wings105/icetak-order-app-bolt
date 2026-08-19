import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  { auth: { persistSession: false } },
);

const H = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
const out = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s, headers: H });
const t = (v: unknown) => v == null ? '' : String(v).trim();
const digits = (v: unknown) => {
  let d = t(v).replace(/\D/g, '');
  if (!d) return '';
  if (d[0] === '0') d = `60${d.slice(1)}`;
  else if (d[0] === '1') d = `60${d}`;
  else if (!d.startsWith('60')) d = `60${d}`;
  return d;
};

async function setting(key: string) {
  const { data } = await db.from('whatsapp_settings').select('text_value,secret_value').eq('key', key).maybeSingle();
  return t(data?.secret_value || data?.text_value);
}

async function secret(key: string) {
  const { data } = await db.from('private_runtime_settings').select('setting_value').eq('setting_key', key).maybeSingle();
  return t(data?.setting_value);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'POST') return out({ ok: false, error: 'POST required' }, 405);

  const supplied = req.headers.get('x-admin-window-token') || '';
  const expected = await secret('admin_window_bridge_token');
  if (!supplied || !expected || supplied !== expected) return out({ ok: false, error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const admin = digits(await setting('admin_order_notify_phone') || '60129554732');
  const phone = digits(body.phone);
  if (!phone || phone !== admin) {
    return out({ ok: true, result: { updated: false, ignored: true, reason: 'not_admin_phone' } });
  }

  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const payload = {
    admin_phone: admin,
    last_inbound_at: now.toISOString(),
    window_expires_at: expires.toISOString(),
    window_status: 'open',
    warn_6h_sent_at: null,
    warn_2h_sent_at: null,
    warn_30m_sent_at: null,
    last_warning_level: null,
    last_provider_message_id: body.provider_message_id || null,
    updated_at: now.toISOString(),
  };

  const { error } = await db.from('admin_whatsapp_window_monitor').upsert(payload, { onConflict: 'admin_phone' });
  if (error) return out({ ok: false, error: error.message }, 500);

  return out({
    ok: true,
    result: {
      updated: true,
      admin_phone: admin,
      window_expires_at: expires.toISOString(),
      source: body.source || 'unified_inbox',
      button_id: body.button_id || null,
      provider_message_id: body.provider_message_id || null,
    },
  });
});
