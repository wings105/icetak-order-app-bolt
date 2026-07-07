const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';

function edge(functionName: string, path: string, init: RequestInit = {}) {
  return fetch(`${supabaseUrl}/functions/v1/${functionName}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  });
}

function isAdminScreen() {
  return Boolean(sessionStorage.getItem('admin_session')) || /Admin|Dashboard|Create Customer Order|Payment Webhook/i.test(document.body.textContent || '');
}

function showWhatsAppManager() {
  if (!isAdminScreen() || document.querySelector('#waManagerCard')) return;
  const card = document.createElement('section');
  card.id = 'waManagerCard';
  card.innerHTML = `
    <style>
      #waManagerCard{position:fixed;right:14px;bottom:84px;z-index:80;width:min(380px,calc(100vw - 28px));max-height:72vh;overflow:auto;background:#fff;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 18px 60px rgba(15,23,42,.18);font-family:inherit}
      #waManagerCard.collapsed{width:auto;overflow:hidden}
      #waManagerCard.collapsed .wa-body{display:none}
      #waManagerCard header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid #f1f5f9;background:#f8fafc;border-radius:18px 18px 0 0}
      #waManagerCard header b{font-size:14px}#waManagerCard header small{display:block;color:#64748b;font-size:11px}
      #waManagerCard button{border:0;border-radius:10px;padding:9px 11px;background:#0f172a;color:#fff;font-weight:700;cursor:pointer}
      #waManagerCard button.secondary{background:#e2e8f0;color:#0f172a}#waManagerCard button.mini{padding:6px 8px;font-size:12px}
      #waManagerCard input,#waManagerCard textarea,#waManagerCard select{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:9px;margin-top:4px;font:inherit}
      #waManagerCard label{display:block;font-size:12px;color:#334155;margin:9px 0}#waManagerCard .wa-body{padding:12px 14px}
      #waManagerCard .wa-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}#waManagerCard .wa-status{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
      #waManagerCard .wa-status span{background:#f1f5f9;border-radius:999px;padding:5px 8px;font-size:11px;color:#334155}
      #waManagerCard .wa-log{font-size:12px;white-space:pre-wrap;background:#0f172a;color:#e2e8f0;border-radius:12px;padding:10px;margin-top:10px;max-height:150px;overflow:auto}
    </style>
    <header><div><b>WhatsApp Management</b><small>WasapFlow native, no AP/Make</small></div><button id="waCollapse" class="mini secondary">Hide</button></header>
    <div class="wa-body">
      <div class="wa-status" id="waStatus"><span>Loading status…</span></div>
      <div class="wa-grid">
        <button id="waLoadRules" class="secondary">Rules</button>
        <button id="waSyncTemplates" class="secondary">Sync Templates</button>
      </div>
      <label>Partner Key<input id="waPartnerKey" placeholder="wf_xxx" autocomplete="off"></label>
      <label>WABA ID<input id="waWabaId" placeholder="123456789"></label>
      <label>Webhook Secret<input id="waWebhookSecret" placeholder="WasapFlow webhook secret" autocomplete="off"></label>
      <label>Customer App Base URL<input id="waBaseUrl" value="https://decocake.my"></label>
      <button id="waSaveSettings">Save Settings</button>
      <hr>
      <label>Send Test To<input id="waTestPhone" placeholder="0129554732"></label>
      <label>Mode<select id="waTestMode"><option value="text">Free Form Text</option><option value="template">Template</option></select></label>
      <label>Message / Template Name<textarea id="waTestBody" rows="3" placeholder="Hi {{customer_name}}, order {{order_no}}..."></textarea></label>
      <button id="waSendTest">Send Test</button>
      <div class="wa-log" id="waLog">Ready.</div>
    </div>`;
  document.body.append(card);

  const log = (text: string) => { const el = card.querySelector<HTMLElement>('#waLog')!; el.textContent = `${new Date().toLocaleTimeString()} ${text}\n${el.textContent}`.slice(0, 2500); };
  const refreshStatus = async () => {
    try {
      const s = await edge('whatsapp-admin', '/status');
      card.querySelector<HTMLElement>('#waStatus')!.innerHTML = [
        `Partner ${s.configured.partner_key ? '✅' : '⚠️'}`,
        `WABA ${s.configured.waba_id ? '✅' : '⚠️'}`,
        `Webhook ${s.configured.webhook_secret ? '✅' : '⚠️'}`,
      ].map((x) => `<span>${x}</span>`).join('');
    } catch (err: any) { log(`Status error: ${err.message}`); }
  };

  card.querySelector<HTMLButtonElement>('#waCollapse')!.onclick = () => {
    card.classList.toggle('collapsed');
    card.querySelector<HTMLButtonElement>('#waCollapse')!.textContent = card.classList.contains('collapsed') ? 'Show' : 'Hide';
  };
  card.querySelector<HTMLButtonElement>('#waSaveSettings')!.onclick = async () => {
    try {
      await edge('whatsapp-admin', '/settings', { method: 'POST', body: JSON.stringify({
        partner_key: (card.querySelector<HTMLInputElement>('#waPartnerKey')!.value || '').trim(),
        waba_id: (card.querySelector<HTMLInputElement>('#waWabaId')!.value || '').trim(),
        webhook_secret: (card.querySelector<HTMLInputElement>('#waWebhookSecret')!.value || '').trim(),
        customer_app_base_url: (card.querySelector<HTMLInputElement>('#waBaseUrl')!.value || '').trim(),
      }) });
      log('Settings saved.');
      await refreshStatus();
    } catch (err: any) { log(`Save error: ${err.message}`); }
  };
  card.querySelector<HTMLButtonElement>('#waSyncTemplates')!.onclick = async () => {
    try { const r = await edge('whatsapp-admin', '/templates/sync', { method: 'POST', body: '{}' }); log(`Templates synced: ${r.synced}`); }
    catch (err: any) { log(`Sync error: ${err.message}`); }
  };
  card.querySelector<HTMLButtonElement>('#waLoadRules')!.onclick = async () => {
    try { const r = await edge('whatsapp-admin', '/rules'); log(`Rules: ${(r.rules || []).map((x: any) => x.event_type).join(', ')}`); }
    catch (err: any) { log(`Rules error: ${err.message}`); }
  };
  card.querySelector<HTMLButtonElement>('#waSendTest')!.onclick = async () => {
    try {
      const mode = card.querySelector<HTMLSelectElement>('#waTestMode')!.value;
      const phone = card.querySelector<HTMLInputElement>('#waTestPhone')!.value;
      const body = card.querySelector<HTMLTextAreaElement>('#waTestBody')!.value;
      const payload = mode === 'template' ? { phone, mode, template_name: body || 'customer_login' } : { phone, mode, text: body || 'Test mesej dari DecoCake.my' };
      const r = await edge('whatsapp-send', '', { method: 'POST', body: JSON.stringify(payload) });
      log(`Send test: ${JSON.stringify(r)}`);
    } catch (err: any) { log(`Send error: ${err.message}`); }
  };
  refreshStatus();
}

const observer = new MutationObserver(showWhatsAppManager);
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(showWhatsAppManager, 800);
