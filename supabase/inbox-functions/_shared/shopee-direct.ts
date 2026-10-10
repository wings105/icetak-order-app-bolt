export type ShopeeConfig = Record<string, any>;
const str = (value: unknown) => String(value ?? '').trim();
export async function sha256(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join('');
}
export function readiness(c: ShopeeConfig, shop?: string) {
  if (!c.shop_id) return 'NOT_CONFIGURED';
  if (shop && str(c.shop_id) !== shop) return 'SHOP_MISMATCH';
  if (!c.enabled) return 'DISABLED';
  if (!c.partner_key || !c.access_token) return 'CREDENTIALS_REQUIRED';
  if (!Number.isFinite(Date.parse(c.token_expires_at)) || Date.parse(c.token_expires_at) <= Date.now()) return 'TOKEN_EXPIRED';
  if (!c.check_ok || c.checked_credential_version !== c.credential_version) return 'CHECK_REQUIRED';
  return 'READY';
}
export function publicConfig(c: ShopeeConfig) {
  return {
    partner_id: c.partner_id || '', shop_id: c.shop_id || '', environment: c.environment || 'production', enabled: !!c.enabled,
    partner_key_present: !!c.partner_key, access_token_present: !!c.access_token, rotation_key_present: !!c.webhook_key_hash,
    token_expires_at: c.token_expires_at || null, token_rotated_at: c.token_rotated_at || null,
    last_check_at: c.last_check_at || null, last_check_code: c.last_check_code || null,
    readiness: readiness(c), updated_at: c.updated_at || null, events: (c.events || []).slice(0, 10),
  };
}
// Official v2 shop-level signing. Host and paths are fixed, never supplied by admin/webhook input.
export async function shopeeRequest(c: ShopeeConfig, path: '/api/v2/sellerchat/send_message' | '/api/v2/sellerchat/get_one_conversation', payload: Record<string, unknown>, method: 'GET' | 'POST', fetcher = fetch) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(c.partner_key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${c.partner_id}${path}${timestamp}${c.access_token}${c.shop_id}`));
  const sign = Array.from(new Uint8Array(signature), x => x.toString(16).padStart(2, '0')).join('');
  const host = c.environment === 'sandbox' ? 'https://partner.test-stable.shopeemobile.com' : 'https://partner.shopeemobile.com';
  const url = new URL(path, host);
  for (const [name, value] of Object.entries({ partner_id: c.partner_id, timestamp, access_token: c.access_token, shop_id: c.shop_id, sign })) url.searchParams.set(name, str(value));
  if (method === 'GET') for (const [name, value] of Object.entries(payload)) url.searchParams.set(name, str(value));
  return await fetcher(url, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(20000), redirect: 'error' });
}
export async function checkConnection(db: any, c: ShopeeConfig, actor: string, fetcher = fetch) {
  let code = 'CREDENTIALS_REQUIRED', ok = false;
  if (c.partner_key && c.access_token && Date.parse(c.token_expires_at) > Date.now()) {
    const { data, error } = await db.from('conversations').select('external_conversation_id,metadata').eq('channel', 'shopee').order('last_message_at', { ascending: false }).limit(200);
    const conversation = (data || []).find((row: any) => str(row.metadata?.shop_id) === str(c.shop_id) && row.external_conversation_id);
    if (error) code = 'INBOX_READ_FAILED';
    else if (!conversation) code = 'NO_CONVERSATION_FOR_SHOP';
    else try {
      const response = await shopeeRequest(c, '/api/v2/sellerchat/get_one_conversation', { conversation_id: conversation.external_conversation_id }, 'GET', fetcher);
      const body = await response.json().catch(() => ({}));
      const actual = body.response?.conversation_id || body.response?.conversation?.conversation_id;
      ok = response.ok && !body.error && str(actual) === str(conversation.external_conversation_id);
      // Never reflect raw Shopee messages, URLs or credential strings back to the browser.
      code = ok ? 'CHAT_READ_VERIFIED' : (typeof body.error === 'string' && /^[a-zA-Z0-9_.-]{1,60}$/.test(body.error) ? `SHOPEE_${body.error}` : `SHOPEE_HTTP_${response.status}`);
    } catch { code = 'SHOPEE_CONNECTION_UNKNOWN'; }
  } else if (c.access_token) code = 'TOKEN_EXPIRED';
  const { data, error } = await db.rpc('icetak_shopee_chat_config', { p_action: 'record_check', p_body: { credential_version: c.credential_version, ok, code, actor } });
  if (error) throw new Error('CHECK_RECORD_FAILED');
  return data as ShopeeConfig;
}
