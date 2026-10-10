import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { checkConnection, publicConfig, sha256 } from '../_shared/shopee-direct.ts';
const out = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return out({ ok: false, error: 'POST required' }, 405);
  try {
    // This dedicated key can only rotate this shop's token. It cannot send messages or administer settings.
    const key = req.headers.get('x-icetak-shopee-key') || '';
    if (key.length < 40 || key.length > 200) return out({ ok: false, error: 'Unauthorized' }, 401);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: c, error: readError } = await db.rpc('icetak_shopee_chat_config', { p_action: 'get', p_body: {} });
    const hash = await sha256(key);
    if (readError || !c?.webhook_key_hash || c.webhook_key_hash !== hash) return out({ ok: false, error: 'Unauthorized' }, 401);
    const raw = await req.text();
    if (raw.length > 12000) return out({ ok: false, error: 'Payload terlalu besar.' }, 413);
    let b: any;
    try { b = JSON.parse(raw); } catch { return out({ ok: false, error: 'JSON diperlukan.' }, 400); }
    if (!b || typeof b !== 'object' || String(b.access_token || '').length > 8192) return out({ ok: false, error: 'Payload tidak sah.' }, 400);
    const { data, error } = await db.rpc('icetak_shopee_chat_config', { p_action: 'rotate_token', p_body: { partner_id: String(b.partner_id || ''), shop_id: String(b.shop_id || ''), access_token: b.access_token, rotated_at: b.rotated_at, expires_at: b.expires_at, webhook_key_hash: hash, actor: 'token-automation' } });
    if (error) {
      const code = ['STALE_ROTATION', 'ROTATION_CONFLICT', 'IDENTITY_MISMATCH', 'UNAUTHORIZED_ROTATION'].find(x => String(error.message).includes(x));
      return out({ ok: false, error: code || 'INVALID_TOKEN_UPDATE' }, code === 'UNAUTHORIZED_ROTATION' ? 401 : code ? 409 : 400);
    }
    const checked = data.check_ok && data.checked_credential_version === data.credential_version ? data : await checkConnection(db, data, 'token-automation');
    return out({ ok: true, applied: !data.duplicate, duplicate: !!data.duplicate, config: publicConfig(checked) });
  } catch { return out({ ok: false, error: 'Token update tidak dapat diproses. Retry payload yang sama.' }, 500); }
});
