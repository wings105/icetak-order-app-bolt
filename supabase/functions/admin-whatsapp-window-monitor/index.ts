// @ts-nocheck
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

async function auth(req: Request) {
  const token = req.headers.get('x-admin-window-token') || '';
  return Boolean(token && token === await secret('qrpay_ai_worker_token'));
}

async function fetchTimed(url: string, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function provider(path: string, payload: unknown) {
  const base = await setting('base_url') || 'https://officialapi.wasapflow.com/bridge/v1';
  const partner = await setting('partner_key');
  const waba = await setting('waba_id');
  if (!partner || !waba) throw new Error('WasapFlow credential belum lengkap');
  const response = await fetchTimed(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-partner-key': partner, 'x-waba-id': waba },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    throw new Error(json?.error?.message || json?.message || `WasapFlow ${response.status}`);
  }
  return json;
}

async function send(to: string, text: string) {
  return provider('/messages/send', { to: digits(to), text, preview_url: false });
}

async function sendWindowWarning(to: string, text: string) {
  const phone = digits(to);
  try {
    const result = await provider('/messages/interactive', {
      to: phone,
      interactive: {
        type: 'button',
        body: { text },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: {
                id: 'refresh_admin_window',
                title: 'Refresh 24 Jam',
              },
            },
          ],
        },
      },
    });
    return { ...result, delivery_mode: 'interactive' };
  } catch (error) {
    console.warn('Interactive admin window warning failed; falling back to text', error);
    const fallback = await send(phone, `${text}\n\nJika button tidak tersedia, reply apa sahaja pada chat ini untuk refresh 24 jam.`);
    return { ...fallback, delivery_mode: 'text_fallback' };
  }
}

function formatMY(iso: string) {
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

function warningText(level: '6h' | '2h' | '30m', expiresAt: string) {
  const expiry = formatMY(expiresAt);
  if (level === '6h') return [
    '⚠️ *WHATSAPP ADMIN WINDOW*',
    '',
    'Free-form tinggal kurang ±6 jam.',
    `Window dijangka tamat: *${expiry}*`,
    '',
    'Tekan *Refresh 24 Jam* untuk reset semula window admin.',
  ].join('\n');
  if (level === '2h') return [
    '🟠 *URGENT — WHATSAPP WINDOW*',
    '',
    'Free-form tinggal kurang ±2 jam.',
    `Window dijangka tamat: *${expiry}*`,
    '',
    'Tekan *Refresh 24 Jam* sekarang untuk reset semula window admin.',
  ].join('\n');
  return [
    '🔴 *CRITICAL — WHATSAPP WINDOW*',
    '',
    'Free-form tinggal kurang ±30 minit.',
    `Window dijangka tamat: *${expiry}*`,
    '',
    'Tekan *Refresh 24 Jam* sekarang.',
  ].join('\n');
}

async function recordInbound(phoneInput: unknown) {
  const admin = digits(await setting('admin_order_notify_phone') || '60129554732');
  const phone = digits(phoneInput);
  if (!phone || phone !== admin) return { updated: false, ignored: true, reason: 'not_admin_phone' };

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
    last_provider_message_id: null,
    updated_at: now.toISOString(),
  };
  const { error } = await db.from('admin_whatsapp_window_monitor').upsert(payload, { onConflict: 'admin_phone' });
  if (error) throw error;
  return { updated: true, admin_phone: admin, window_expires_at: expires.toISOString() };
}

async function bootstrapState(admin: string) {
  const { data: contact } = await db.from('whatsapp_contacts')
    .select('last_inbound_at,window_expires_at,window_status')
    .eq('normalized_phone', admin)
    .maybeSingle();
  if (!contact?.last_inbound_at) return null;

  const expiresAt = contact.window_expires_at || new Date(new Date(contact.last_inbound_at).getTime() + 86400000).toISOString();
  const row = {
    admin_phone: admin,
    last_inbound_at: contact.last_inbound_at,
    window_expires_at: expiresAt,
    window_status: new Date(expiresAt).getTime() > Date.now() ? 'open' : 'expired',
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('admin_whatsapp_window_monitor').upsert(row, { onConflict: 'admin_phone' });
  if (error) throw error;
  return row;
}

async function checkWindow() {
  const admin = digits(await setting('admin_order_notify_phone') || '60129554732');
  let { data: state, error } = await db.from('admin_whatsapp_window_monitor').select('*').eq('admin_phone', admin).maybeSingle();
  if (error) throw error;
  if (!state) {
    state = await bootstrapState(admin);
    if (!state) return { checked: true, initialized: false, reason: 'no_admin_inbound_seen_yet' };
  }

  const nowMs = Date.now();
  const expiryMs = new Date(state.window_expires_at).getTime();
  const remainingMs = expiryMs - nowMs;
  if (!Number.isFinite(remainingMs)) throw new Error('Invalid window_expires_at');

  if (remainingMs <= 0) {
    await db.from('admin_whatsapp_window_monitor').update({ window_status: 'expired', updated_at: new Date().toISOString() }).eq('admin_phone', admin);
    return { checked: true, status: 'expired', remaining_minutes: Math.floor(remainingMs / 60000) };
  }

  let level: '6h' | '2h' | '30m' | null = null;
  let sentColumn: string | null = null;
  if (remainingMs <= 30 * 60 * 1000 && !state.warn_30m_sent_at) {
    level = '30m'; sentColumn = 'warn_30m_sent_at';
  } else if (remainingMs <= 2 * 60 * 60 * 1000 && !state.warn_2h_sent_at) {
    level = '2h'; sentColumn = 'warn_2h_sent_at';
  } else if (remainingMs <= 6 * 60 * 60 * 1000 && !state.warn_6h_sent_at) {
    level = '6h'; sentColumn = 'warn_6h_sent_at';
  }

  if (!level || !sentColumn) {
    await db.from('admin_whatsapp_window_monitor').update({ window_status: 'open', updated_at: new Date().toISOString() }).eq('admin_phone', admin);
    return { checked: true, status: 'open', warning_sent: false, remaining_minutes: Math.ceil(remainingMs / 60000) };
  }

  const message = warningText(level, state.window_expires_at);
  const result = await sendWindowWarning(admin, message);
  const sentAt = new Date().toISOString();
  const providerMessageId = result?.message_id || result?.id || null;

  const patch: Record<string, unknown> = {
    [sentColumn]: sentAt,
    last_warning_level: level,
    last_provider_message_id: providerMessageId,
    window_status: 'open',
    updated_at: sentAt,
  };
  const { error: updateError } = await db.from('admin_whatsapp_window_monitor').update(patch).eq('admin_phone', admin);
  if (updateError) throw updateError;

  await db.from('admin_whatsapp_window_warning_log').insert({
    admin_phone: admin,
    warning_level: level,
    window_expires_at: state.window_expires_at,
    provider_message_id: providerMessageId,
    sent_at: sentAt,
  }).catch(() => null);

  return {
    checked: true,
    status: 'open',
    warning_sent: true,
    warning_level: level,
    delivery_mode: result?.delivery_mode || null,
    remaining_minutes: Math.ceil(remainingMs / 60000),
    window_expires_at: state.window_expires_at,
  };
}

async function status() {
  const admin = digits(await setting('admin_order_notify_phone') || '60129554732');
  const { data, error } = await db.from('admin_whatsapp_window_monitor').select('*').eq('admin_phone', admin).maybeSingle();
  if (error) throw error;
  if (!data) return { initialized: false, admin_phone: admin };
  return {
    initialized: true,
    ...data,
    remaining_minutes: Math.ceil((new Date(data.window_expires_at).getTime() - Date.now()) / 60000),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'POST') return out({ ok: false, error: 'POST required' }, 405);
  if (!await auth(req)) return out({ ok: false, error: 'Unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'incoming') return out({ ok: true, result: await recordInbound(body.phone) });
    if (body.action === 'check') return out({ ok: true, result: await checkWindow() });
    if (body.action === 'status') return out({ ok: true, result: await status() });
    return out({ ok: false, error: 'unsupported action' }, 400);
  } catch (error) {
    console.error(error);
    return out({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
