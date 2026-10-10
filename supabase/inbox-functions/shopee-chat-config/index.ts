import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { checkConnection, publicConfig, sha256 } from '../_shared/shopee-direct.ts';
const out = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return out({ ok: false, error: 'POST required' }, 405);
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: rows, error: bridgeError } = await db.from('private_runtime_settings').select('setting_value').eq('setting_key', 'admin_window_bridge_token').limit(1);
    const expected = rows?.[0]?.setting_value;
    if (bridgeError || !expected || req.headers.get('x-admin-window-token') !== expected) return out({ ok: false, error: 'Unauthorized' }, 401);
    const b = await req.json();
    const actor = String(b.actor || 'admin').slice(0, 80);
    if (!['get', 'save', 'check', 'rotate_webhook'].includes(b.action)) return out({ ok: false, error: 'Invalid action' }, 400);
    if (b.action === 'save' && (String(b.partner_key || '').length > 4096 || String(b.access_token || '').length > 8192)) return out({ ok: false, error: 'Credential terlalu panjang.' }, 400);
    let secret: string | undefined;
    const body = b.action === 'rotate_webhook' ? { key_hash: await sha256(secret = `icetak_shopee_${crypto.randomUUID()}${crypto.randomUUID()}`), actor } : { ...b, actor };
    const { data, error } = await db.rpc('icetak_shopee_chat_config', { p_action: b.action === 'check' ? 'get' : b.action, p_body: body });
    if (error) return out({ ok: false, error: 'Semak App ID, Shop ID, environment dan masa expiry sebelum Save.' }, 400);
    const config = b.action === 'check' ? await checkConnection(db, data, actor) : data;
    return out({ ok: true, config: publicConfig(config), ...(secret ? { rotation_key: secret } : {}), rotation_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/shopee-token-rotate` });
  } catch { return out({ ok: false, error: 'Konfigurasi Shopee tidak dapat diproses.' }, 500); }
});
