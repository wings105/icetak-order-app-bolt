import { supabase } from './appdeploy-client';

const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const WF_WEBHOOK_URL = `${supabaseUrl}/functions/v1/wasapflow-webhook`;

type Any = Record<string, any>;
function token() { return sessionStorage.getItem('admin_access_token') || sessionStorage.getItem('admin_session') || ''; }
function adminOnPage() { return Boolean(token()) && /Order Control Tower|iCetak ERP|WhatsApp Templates|Integrations/i.test(document.body.textContent || ''); }
async function edge(fn: string, path = '', init: RequestInit = {}) {
  const res = await fetch(`${supabaseUrl}/functions/v1/${fn}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed ${res.status}`);
  return data;
}
function toast(msg: string, bad = false) {
  let el = document.querySelector<HTMLElement>('#wfToast');
  if (!el) { el = document.createElement('div'); el.id = 'wfToast'; document.body.append(el); }
  el.textContent = msg;
  Object.assign(el.style, { position: 'fixed', zIndex: '99999', left: '50%', bottom: '24px', transform: 'translateX(-50%)', background: bad ? '#b91c1c' : '#166534', color: '#fff', padding: '12px 16px', borderRadius: '12px', fontWeight: '800', boxShadow: '0 16px 48px rgba(0,0,0,.22)' });
  setTimeout(() => el?.remove(), 4200);
}
function esc(v: unknown) { return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Any)[c]); }
function copy(v: string) { return navigator.clipboard.writeText(v).then(() => toast('Copied')); }

function ensureButton() {
  if (!adminOnPage() || document.querySelector('#wfOpenBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'wfOpenBtn';
  btn.textContent = '⚡ WasapFlow Control';
  btn.onclick = () => void openPanel();
  document.body.append(btn);
}

async function loadAll() {
  const [status, rules, templates, outbox] = await Promise.all([
    edge('whatsapp-admin', '/status').catch((e) => ({ ok: false, error: e.message, configured: {} })),
    edge('whatsapp-admin', '/rules').catch(() => ({ rules: [] })),
    edge('whatsapp-admin', '/templates').catch(() => ({ templates: [] })),
    edge('whatsapp-admin', '/outbox').catch(() => ({ outbox: [] })),
  ]);
  return { status, rules: rules.rules || [], templates: templates.templates || [], outbox: outbox.outbox || [] };
}

function templateBadge(templates: Any[], name: string) {
  const found = templates.find((t) => String(t.name).toLowerCase() === name.toLowerCase());
  if (!found) return '<span class="wf-badge warn">not synced</span>';
  const st = String(found.status || '').toUpperCase();
  return `<span class="wf-badge ${st === 'APPROVED' ? 'ok' : 'warn'}">${esc(st || 'synced')}</span>`;
}

async function openPanel() {
  let wrap = document.querySelector<HTMLElement>('#wfPanelWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'wfPanelWrap';
    document.body.append(wrap);
  }
  wrap.innerHTML = `<div class="wf-panel"><header><div><small>Native WhatsApp API</small><h2>WasapFlow Control Center</h2></div><button id="wfClose">×</button></header><main><div class="wf-loading">Loading…</div></main></div>`;
  wrap.querySelector<HTMLButtonElement>('#wfClose')!.onclick = () => wrap?.remove();
  try { renderPanel(wrap, await loadAll()); } catch (e: any) { wrap.querySelector('main')!.innerHTML = `<p class="wf-error">${esc(e.message)}</p>`; }
}

function renderPanel(wrap: HTMLElement, data: Any) {
  const cfg = data.status.configured || {};
  const connected = !!cfg.partner_key && !!cfg.waba_id;
  const ruleNames = ['magic_login_link','order_created_notice','payment_pending_notice','order_paid_notice','review_ready_notice','order_shipped_notice','order_delivered_notice'];
  wrap.querySelector('main')!.innerHTML = `
    <section class="wf-grid wf-status-row">
      <article><b>${connected ? 'Connected Ready' : 'Credential Needed'}</b><span>${connected ? 'Partner key + WABA ID stored' : 'Isi Partner Key + WABA ID dulu'}</span></article>
      <article><b>${data.templates.length}</b><span>Synced Meta templates</span></article>
      <article><b>${data.rules.length}</b><span>Notification rules</span></article>
      <article><b>${data.outbox.length}</b><span>Recent outbox logs</span></article>
    </section>
    <section class="wf-card">
      <h3>1. Connection Settings</h3>
      <p>Key disimpan di Supabase. Field password boleh dikosongkan kalau tak mahu tukar key lama.</p>
      <form id="wfSettings" class="wf-form">
        <label>Enable notification<select name="enabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
        <label>WF Base URL<input name="base_url" value="${esc(data.status.base_url || 'https://officialapi.wasapflow.com/bridge/v1')}"></label>
        <label>Partner Key <small>${cfg.partner_key ? 'configured ✅' : 'missing ⚠️'}</small><input name="partner_key" type="password" placeholder="wf_xxx"></label>
        <label>WABA ID <small>${cfg.waba_id ? 'configured ✅' : 'missing ⚠️'}</small><input name="waba_id" placeholder="123456789"></label>
        <label>Webhook Secret <small>${cfg.webhook_secret ? 'configured ✅' : 'missing ⚠️'}</small><input name="webhook_secret" type="password" placeholder="secret from WasapFlow"></label>
        <label>Language<input name="default_language" value="ms"></label>
        <label>Customer App URL<input name="customer_app_base_url" value="${location.origin}"></label>
        <label>Webhook URL<input readonly value="${esc(WF_WEBHOOK_URL)}"></label>
        <div class="wf-actions"><button>Save Settings</button><button type="button" id="wfCopyWebhook">Copy Webhook URL</button><button type="button" id="wfSync">Test + Sync Templates</button></div>
      </form>
    </section>
    <section class="wf-card">
      <h3>2. Required Templates</h3>
      <div class="wf-template-list">${ruleNames.map((n) => `<div><code>${n}</code>${templateBadge(data.templates, n)}</div>`).join('')}</div>
      <p class="wf-note">Template mesti approved di Meta/WasapFlow. Tekan sync selepas create/approve template.</p>
    </section>
    <section class="wf-card">
      <h3>3. Send Test</h3>
      <form id="wfSendTest" class="wf-form compact">
        <label>Phone<input name="phone" placeholder="0129554732" required></label>
        <label>Mode<select name="mode"><option value="text">Free-form text</option><option value="template">Template</option></select></label>
        <label>Text / Template Name<textarea name="body" rows="3">Test mesej dari iCetak ERP</textarea></label>
        <label>Template params comma separated<input name="params" placeholder="Zaim, IC260707-1234, RM24, https://..."></label>
        <button>Send Test</button>
      </form>
    </section>
    <section class="wf-card">
      <h3>4. Notification Rules</h3>
      <div class="wf-rules">${data.rules.map((r: Any) => `<div><b>${esc(r.event_type)}</b><span>${esc(r.template_name || '-')} / ${esc(r.template_language || 'ms')}</span><em>${r.enabled ? 'enabled' : 'disabled'}</em></div>`).join('')}</div>
    </section>
    <section class="wf-card">
      <h3>5. Recent Logs</h3>
      <div class="wf-log">${data.outbox.slice(0, 12).map((o: Any) => `<div><b>${esc(o.status)}</b><span>${esc(o.phone)} ${esc(o.message_type)} ${esc(o.template_name || o.body || '')}</span><small>${esc(o.created_at || '')}</small></div>`).join('') || '<p>No logs yet.</p>'}</div>
    </section>`;

  wrap.querySelector<HTMLButtonElement>('#wfCopyWebhook')!.onclick = () => void copy(WF_WEBHOOK_URL);
  wrap.querySelector<HTMLButtonElement>('#wfSync')!.onclick = async () => {
    try { toast('Syncing templates…'); const r = await edge('whatsapp-admin', '/templates/sync', { method: 'POST', body: '{}' }); toast(`Template synced: ${r.synced || 0}`); renderPanel(wrap, await loadAll()); }
    catch (e: any) { toast(e.message || 'Sync failed', true); }
  };
  wrap.querySelector<HTMLFormElement>('#wfSettings')!.onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget); const body: Any = {};
    ['enabled','base_url','waba_id','default_language','customer_app_base_url'].forEach((k) => body[k] = String(f.get(k) || ''));
    ['partner_key','webhook_secret'].forEach((k) => { const v = String(f.get(k) || '').trim(); if (v) body[k] = v; });
    try { await edge('whatsapp-admin', '/settings', { method: 'POST', body: JSON.stringify(body) }); toast('WasapFlow settings saved'); renderPanel(wrap, await loadAll()); }
    catch (e: any) { toast(e.message || 'Save failed', true); }
  };
  wrap.querySelector<HTMLFormElement>('#wfSendTest')!.onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget), mode = String(f.get('mode'));
    const payload: Any = { phone: String(f.get('phone') || ''), mode };
    if (mode === 'template') { payload.template_name = String(f.get('body') || 'order_created_notice').trim(); payload.template_params = String(f.get('params') || '').split(',').map((x) => x.trim()).filter(Boolean); }
    else payload.text = String(f.get('body') || 'Test mesej dari iCetak ERP');
    try { const r = await edge('whatsapp-send', '', { method: 'POST', body: JSON.stringify(payload) }); toast(`Sent: ${r.message_id || 'ok'}`); renderPanel(wrap, await loadAll()); }
    catch (e: any) { toast(e.message || 'Send failed', true); }
  };
}

function injectStyles() {
  if (document.querySelector('#wfControlStyles')) return;
  const s = document.createElement('style'); s.id = 'wfControlStyles'; s.textContent = `
#wfOpenBtn{position:fixed;right:18px;bottom:18px;z-index:9998;background:#16a34a;color:#fff;border:0;border-radius:999px;padding:14px 18px;font-weight:900;box-shadow:0 18px 50px rgba(22,163,74,.34);cursor:pointer}
#wfPanelWrap{position:fixed;inset:0;z-index:99998;background:rgba(15,23,42,.58);overflow:auto;padding:22px}.wf-panel{max-width:1120px;margin:auto;background:#f8fafc;border-radius:22px;box-shadow:0 32px 90px rgba(0,0,0,.28);overflow:hidden}.wf-panel header{display:flex;align-items:center;justify-content:space-between;background:#0f172a;color:white;padding:22px 26px}.wf-panel header h2{margin:0;font-size:28px}.wf-panel header small{letter-spacing:.16em;text-transform:uppercase;color:#93c5fd}.wf-panel header button{border:0;background:#334155;color:white;border-radius:999px;width:42px;height:42px;font-size:28px}.wf-panel main{padding:20px}.wf-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.wf-status-row article,.wf-card{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:18px;box-shadow:0 12px 36px rgba(15,23,42,.06)}.wf-status-row b{display:block;font-size:24px}.wf-status-row span,.wf-card p,.wf-note{color:#64748b}.wf-card{margin-top:16px}.wf-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.wf-form.compact{grid-template-columns:1fr 1fr}.wf-form label{font-weight:800;color:#0f172a}.wf-form small{font-weight:700;color:#64748b}.wf-form input,.wf-form textarea,.wf-form select{width:100%;box-sizing:border-box;margin-top:6px;padding:12px;border:1px solid #cbd5e1;border-radius:12px;font:inherit}.wf-actions{grid-column:1/-1;display:flex;gap:10px;flex-wrap:wrap}.wf-actions button,.wf-form button{border:0;border-radius:12px;background:#2563eb;color:#fff;font-weight:900;padding:12px 16px;cursor:pointer}.wf-actions button:nth-child(2){background:#0f172a}.wf-actions button:nth-child(3){background:#16a34a}.wf-template-list,.wf-rules,.wf-log{display:grid;gap:8px}.wf-template-list div,.wf-rules div,.wf-log div{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px}.wf-badge{border-radius:999px;padding:5px 9px;font-size:12px;font-weight:900}.wf-badge.ok{background:#dcfce7;color:#166534}.wf-badge.warn{background:#fef3c7;color:#92400e}.wf-error{background:#fee2e2;color:#991b1b;padding:16px;border-radius:12px}@media(max-width:760px){.wf-grid,.wf-form,.wf-form.compact{grid-template-columns:1fr}.wf-panel header h2{font-size:22px}}`;
  document.head.append(s);
}

injectStyles();
const mo = new MutationObserver(ensureButton); mo.observe(document.body, { childList: true, subtree: true });
setInterval(ensureButton, 2000);
ensureButton();
