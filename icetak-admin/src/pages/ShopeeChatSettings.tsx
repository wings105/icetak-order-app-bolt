import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Config = {
  partner_id: string; shop_id: string; environment: string; enabled: boolean;
  partner_key_present: boolean; access_token_present: boolean; rotation_key_present: boolean;
  token_expires_at: string | null; token_rotated_at: string | null; readiness: string;
  last_check_at: string | null; last_check_code: string | null;
  events: Array<{ action: string; at: string; actor: string }>;
};
const states: Record<string, string> = {
  NOT_CONFIGURED: 'Belum dikonfigurasi', DISABLED: 'Penghantaran direct OFF', CREDENTIALS_REQUIRED: 'Credential belum lengkap',
  TOKEN_EXPIRED: 'Token tamat tempoh', CHECK_REQUIRED: 'Perlu semak sambungan', READY: 'API read disahkan — sedia untuk reply manual',
};
const date = (value: string | null) => value ? new Date(value).toLocaleString('ms-MY', { timeZone: 'Asia/Kuala_Lumpur' }) : 'Belum ada';

export default function ShopeeChatSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [partnerId, setPartnerId] = useState('');
  const [shopId, setShopId] = useState('');
  const [environment, setEnvironment] = useState('production');
  const [enabled, setEnabled] = useState(false);
  const [partnerKey, setPartnerKey] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [expiry, setExpiry] = useState('');
  const [rotationUrl, setRotationUrl] = useState('');
  const [rotationKey, setRotationKey] = useState('');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [dirty, setDirty] = useState(false);
  async function call(action: string, fields: Record<string, unknown> = {}) {
    const { data, error: failure } = await supabase.functions.invoke('shopee-chat-settings', { body: { action, ...fields } });
    if (failure || !data?.ok) {
      let message = data?.error || failure?.message || 'Tetapan Shopee gagal diproses.';
      if (failure?.context instanceof Response) {
        const detail = await failure.context.json().catch(() => null);
        message = detail?.error || message;
      }
      throw new Error(message);
    }
    return data as { ok: boolean; config: Config; rotation_url: string; rotation_key?: string };
  }
  function apply(data: { config: Config; rotation_url: string }) {
    const c = data.config;
    setConfig(c); setPartnerId(c.partner_id); setShopId(c.shop_id); setEnvironment(c.environment); setEnabled(c.enabled);
    setRotationUrl(data.rotation_url); setDirty(false);
  }
  useEffect(() => {
    let active = true;
    setBusy(true); setLoaded(false); setError('');
    void call('get').then(data => { if (active) { apply(data); setLoaded(true); } })
      .catch(failure => { if (active) setError(failure.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [reload]);
  async function act(action: 'save' | 'check' | 'rotate_webhook') {
    if (busy || !loaded || (action !== 'save' && dirty)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const fields = action === 'save' ? {
        partner_id: partnerId.trim(), shop_id: shopId.trim(), environment, enabled,
        partner_key: partnerKey.trim(), access_token: accessToken.trim(),
        token_expires_at: accessToken.trim() && expiry ? new Date(expiry).toISOString() : null,
      } : {};
      const data = await call(action, fields);
      apply(data);
      if (action === 'save') { setPartnerKey(''); setAccessToken(''); setExpiry(''); setRotationKey(''); }
      if (data.rotation_key) setRotationKey(data.rotation_key);
      setNotice(action === 'save' ? 'Tetapan disimpan. Semak sambungan selepas token tersedia.' : action === 'rotate_webhook' ? 'Key baharu dijana. Salin sekarang; key lama sudah dibatalkan.' : `Semakan: ${data.config.last_check_code || 'Belum disahkan'}. Tiada mesej customer dihantar.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Tetapan gagal diproses.'); }
    finally { setBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice('Disalin.'); }
    catch { setError('Clipboard tidak tersedia. Pilih dan salin teks secara manual.'); }
  }
  const change = () => { setDirty(true); setNotice(''); };
  const sample = JSON.stringify({ partner_id: partnerId || '<APP_ID>', shop_id: shopId || '<SHOP_ID>', access_token: '<TOKEN_BARU_DARI_AUTOMATION>', rotated_at: '<MASA_TOKEN_DIJANA_ISO8601>', expires_at: '<MASA_TOKEN_EXPIRE_ISO8601>' }, null, 2);
  return <section className="panel" id="shopee-chat-settings" aria-label="Shopee Chat Direct API" style={{ gridColumn: '1 / -1' }}>
    <div className="panel-header"><div><div className="panel-title">Shopee Chat — Direct API</div><div className="panel-subtitle">Chat dihantar terus dari iCetak. Automation sedia ada kekal mengurus token refresh.</div></div></div>
    <div style={{ padding: 20, display: 'grid', gap: 14 }}>
      {error && <div role="alert" style={{ color: '#b42318' }}>{error}</div>}
      {notice && <div role="status" style={{ color: '#027a48' }}>{notice}</div>}
      {!loaded && !busy && <button className="btn btn-outline" onClick={() => setReload(x => x + 1)}>Cuba muat semula</button>}
      {config && <div className="cell-sub"><b>{states[config.readiness] || config.readiness}</b> · Token expire: {date(config.token_expires_at)} MYT · Update token: {date(config.token_rotated_at)} MYT</div>}
      <div className="grid-2">
        <label className="form-field"><span>Partner / App ID</span><input inputMode="numeric" value={partnerId} disabled={busy || !loaded} onChange={e => { setPartnerId(e.target.value); change(); }} /></label>
        <label className="form-field"><span>Shop ID</span><input inputMode="numeric" value={shopId} disabled={busy || !loaded} onChange={e => { setShopId(e.target.value); change(); }} /></label>
        <label className="form-field"><span>Environment</span><select value={environment} disabled={busy || !loaded} onChange={e => { setEnvironment(e.target.value); change(); }}><option value="production">Production</option><option value="sandbox">Sandbox / test-stable</option></select></label>
        <label className="form-field"><span>Partner Key {config?.partner_key_present ? '— sudah disimpan' : ''}</span><input type="password" autoComplete="new-password" value={partnerKey} placeholder={config?.partner_key_present ? 'Kosongkan untuk kekalkan key' : 'Isi Partner Key'} disabled={busy || !loaded} onChange={e => { setPartnerKey(e.target.value); change(); }} /></label>
        <label className="form-field"><span>Access Token awal — pilihan {config?.access_token_present ? '(sudah disimpan)' : ''}</span><input type="password" autoComplete="new-password" value={accessToken} placeholder="Boleh tunggu token dipush oleh automation" disabled={busy || !loaded} onChange={e => { setAccessToken(e.target.value); change(); }} /></label>
        <label className="form-field"><span>Expiry token awal — masa tempatan peranti</span><input type="datetime-local" value={expiry} disabled={busy || !loaded || !accessToken} onChange={e => { setExpiry(e.target.value); change(); }} /></label>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={enabled} disabled={busy || !loaded} onChange={e => { setEnabled(e.target.checked); change(); }} />Aktifkan penghantaran direct selepas semakan sambungan lulus</label>
      <div className="cell-sub">Partner Key dan Access Token yang disimpan tidak dipaparkan semula. Tukar App/Shop/environment memerlukan credential dan rotation key baharu.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy || !loaded || !partnerId || !shopId || (!!accessToken && !expiry)} onClick={() => void act('save')}>Save Shopee Settings</button>
        <button className="btn btn-outline" disabled={busy || !loaded || dirty || !config?.access_token_present} onClick={() => void act('check')}>Semak sambungan tanpa hantar chat</button>
        <button className="btn btn-outline" disabled={busy || !loaded || dirty} onClick={() => setReload(x => x + 1)}>Refresh status</button>
      </div>
      {dirty && <div className="cell-sub">Save perubahan dahulu sebelum semak sambungan atau jana rotation key.</div>}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'grid', gap: 10 }}>
        <b>Token rotation dari automation / ClickUp</b>
        <div className="cell-sub">Selepas automation refresh token dan update task ClickUp, tambah HTTP POST ke URL ini. Guna masa token asal untuk rotated_at dan expiry sebenar. Retry mesti menggunakan payload yang sama.</div>
        <label className="form-field"><span>Token Rotation Webhook URL</span><input value={rotationUrl} readOnly /></label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn btn-outline" disabled={!rotationUrl} onClick={() => void copy(rotationUrl)}>Copy URL</button><button className="btn btn-outline" disabled={busy || !loaded || dirty || !config?.shop_id} onClick={() => void act('rotate_webhook')}>{config?.rotation_key_present ? 'Ganti rotation key (batalkan key lama)' : 'Jana rotation key'}</button></div>
        {rotationKey && <><label className="form-field"><span>Rotation key — salin sekarang</span><input type="password" autoComplete="off" value={rotationKey} readOnly /></label><div style={{ display: 'flex', gap: 8 }}><button className="btn btn-outline" onClick={() => void copy(rotationKey)}>Copy rotation key</button><button className="btn btn-outline" onClick={() => setRotationKey('')}>Sembunyikan key</button></div></>}
        <div className="cell-sub">Header: <code>Content-Type: application/json</code> dan <code>x-icetak-shopee-key: ROTATION_KEY</code>. Key ini hanya boleh update token bagi App/Shop yang disimpan.</div>
        <pre style={{ margin: 0, padding: 14, borderRadius: 8, background: 'var(--bg)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{sample}</pre>
        <div className="cell-sub">AP tidak diperlukan untuk penghantaran chat. Kekalkan satu automation refresh sahaja; iCetak tidak refresh token secara berasingan. Semakan ini menguji akses baca Chat API; send sebenar perlu diuji selepas konfigurasi lengkap.</div>
      </div>
      {!!config?.events.length && <details><summary>Aktiviti konfigurasi terbaru</summary><ul>{config.events.map((event, i) => <li key={`${event.at}-${i}`}>{date(event.at)} MYT · {event.action} · {event.actor}</li>)}</ul></details>}
    </div>
  </section>;
}
