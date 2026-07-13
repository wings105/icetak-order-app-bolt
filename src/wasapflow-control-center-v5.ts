import { supabase } from './appdeploy-client';

type AnyRow = Record<string, any>;
type Blueprint = {
  name: string;
  label: string;
  event_type: string;
  category: string;
  body: string;
  params: string[];
};

const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const FIELDS = [
  'customer_name','phone','order_id','order_token','order_total','date_need','order_link',
  'payment_link','review_link','tracking_number','courier','tracking_link','pickup_location',
  'otp','otp_code','magic_link','expiry_minutes','support_phone'
];
const SAMPLE: AnyRow = {
  customer_name:'Zaim', phone:'60129554732', order_id:'IC260707-3904', order_token:'o_demo',
  order_total:'RM35', date_need:'25/07/2027', order_link:'https://icetak.bolt.host/?order=o_demo',
  payment_link:'https://icetak.bolt.host/?order=o_demo&page=payment',
  review_link:'https://icetak.bolt.host/?order=o_demo', tracking_number:'MY123456789', courier:'SPX',
  tracking_link:'https://spx.co/track/MY123456789', pickup_location:'Bandar Baru Pasir Puteh',
  otp:'123456', otp_code:'123456', magic_link:'https://icetak.bolt.host/?magic_token=demo',
  expiry_minutes:'10', support_phone:'60179860656'
};
const BLUEPRINTS: Blueprint[] = [
  {name:'order_created_notice',label:'Order Created',event_type:'order_created',category:'UTILITY',body:'Hi {{1}}, order DecoCake anda telah diterima.\n\nOrder ID: {{2}}\nJumlah: {{3}}\nTarikh perlu: {{4}}\n\nSemak order di sini:\n{{5}}\n\nTerima kasih.',params:['customer_name','order_id','order_total','date_need','order_link']},
  {name:'payment_pending_notice',label:'Payment Pending',event_type:'payment_pending',category:'UTILITY',body:'Hi {{1}}, bayaran untuk order {{2}} masih belum diterima.\n\nJumlah: {{3}}\n\nBayar atau upload resit di sini:\n{{4}}\n\nAbaikan mesej ini jika bayaran sudah dibuat.',params:['customer_name','order_id','order_total','payment_link']},
  {name:'order_paid_notice',label:'Payment Received',event_type:'payment_received',category:'UTILITY',body:'Hi {{1}}, bayaran untuk order {{2}} telah diterima.\n\nJumlah: {{3}}\n\nOrder anda akan diproses mengikut tarikh diperlukan. Terima kasih.',params:['customer_name','order_id','order_total']},
  {name:'review_ready_notice',label:'Design Review Ready',event_type:'review_ready',category:'UTILITY',body:'Hi {{1}}, design untuk order {{2}} sudah sedia untuk semakan.\n\nSemak design di sini:\n{{3}}\n\nSila beri keputusan melalui halaman tersebut.',params:['customer_name','order_id','review_link']},
  {name:'production_started_notice',label:'Production Started',event_type:'production_started',category:'UTILITY',body:'Hi {{1}}, order {{2}} telah masuk proses production.\n\nKami akan update apabila order siap atau dihantar. Terima kasih.',params:['customer_name','order_id']},
  {name:'order_ready_pickup_notice',label:'Ready For Pickup',event_type:'order_ready_pickup',category:'UTILITY',body:'Hi {{1}}, order {{2}} sudah siap untuk pickup.\n\nLokasi pickup:\n{{3}}\n\nSila maklumkan sebelum datang.',params:['customer_name','order_id','pickup_location']},
  {name:'order_shipped_notice',label:'Order Shipped',event_type:'order_shipped',category:'UTILITY',body:'Hi {{1}}, order {{2}} telah dihantar melalui {{3}}.\n\nTracking No: {{4}}\nTrack parcel:\n{{5}}\n\nTerima kasih.',params:['customer_name','order_id','courier','tracking_number','tracking_link']},
  {name:'order_delivered_notice',label:'Order Delivered',event_type:'order_delivered',category:'UTILITY',body:'Hi {{1}}, parcel untuk order {{2}} telah delivered.\n\nTerima kasih kerana order dengan DecoCake.',params:['customer_name','order_id']},
  {name:'order_cancelled_notice',label:'Order Cancelled',event_type:'order_cancelled',category:'UTILITY',body:'Hi {{1}}, order {{2}} telah dibatalkan.\n\nJika ada pertanyaan, boleh hubungi kami semula. Terima kasih.',params:['customer_name','order_id']},
  {name:'magic_login_link',label:'Magic Login Link',event_type:'customer_login',category:'UTILITY',body:'Hi {{1}}, ini link login My Orders DecoCake anda:\n\n{{2}}\n\nLink sah selama 10 minit. Jangan kongsi link ini.',params:['customer_name','magic_link']},
  {name:'customer_login_otp',label:'Customer Login OTP',event_type:'customer_login_otp',category:'AUTHENTICATION',body:'Kod login DecoCake anda ialah {{1}}.\n\nKod ini sah selama 10 minit. Jangan kongsi kod ini.',params:['otp_code']}
];

let activeTab = sessionStorage.getItem('wf_v5_tab') || 'overview';
let cached: AnyRow | null = null;
let showLegacy = false;

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
} as Record<string,string>)[char]);
const asArray = (value: any) => Array.isArray(value)
  ? value
  : typeof value === 'string'
    ? value.split(',').map(item => item.trim()).filter(Boolean)
    : [];
const renderText = (text: string, vars: AnyRow = SAMPLE) => String(text || '')
  .replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, (_match, key) => String(vars[key] ?? ''));

function toast(message: string, bad = false) {
  let element = document.querySelector<HTMLElement>('#wf5Toast');
  if (!element) {
    element = document.createElement('div');
    element.id = 'wf5Toast';
    document.body.append(element);
  }
  element.textContent = message;
  element.className = bad ? 'bad' : 'good';
  window.setTimeout(() => element?.remove(), 6000);
}

async function validAdminToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session?.access_token) {
    sessionStorage.removeItem('admin_access_token');
    sessionStorage.removeItem('admin_session');
    throw new Error('Session admin tamat. Tutup panel ini dan login semula.');
  }
  sessionStorage.setItem('admin_access_token', session.access_token);
  sessionStorage.setItem('admin_refresh_token', session.refresh_token || '');
  sessionStorage.setItem('admin_session', session.access_token);
  return session.access_token;
}

async function edge(functionName: string, path = '', init: RequestInit = {}) {
  const token = await validAdminToken();
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}${path}`, {
    ...init,
    headers: {
      'content-type':'application/json',
      authorization:`Bearer ${token}`,
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const message = data.error || data.message || `Request failed (${response.status})`;
    if (response.status === 401 || response.status === 403) throw new Error(`Akses admin gagal: ${message}. Login semula.`);
    throw new Error(message);
  }
  return data;
}

function normaliseRule(rule: AnyRow) {
  const blueprint = BLUEPRINTS.find(item => item.event_type === rule.event_type)
    || BLUEPRINTS.find(item => item.name === rule.template_name);
  return {
    ...rule,
    label: rule.label || blueprint?.label || rule.event_type,
    freeform_text: rule.freeform_text || '',
    template_params: asArray(rule.template_params?.value || rule.template_params || blueprint?.params),
    available_fields: asArray(rule.available_fields || blueprint?.params)
  };
}

async function loadData(force = false) {
  if (cached && !force) return cached;
  await validAdminToken();
  const snapshot = await edge('whatsapp-admin','/snapshot');
  const { data: summary, error } = await supabase.rpc('icetak_admin_notification_summary');
  if (error) throw new Error(error.message);
  cached = {
    status: snapshot.status || {},
    rules: (snapshot.rules || []).map(normaliseRule),
    templates: snapshot.templates || [],
    outbox: snapshot.outbox || [],
    summary: summary || {}
  };
  return cached;
}

const approvedTemplates = (data: AnyRow) => (data.templates || [])
  .filter((template: AnyRow) => String(template.status || '').toUpperCase() === 'APPROVED');

function templateOptions(data: AnyRow, current: string) {
  const templates = approvedTemplates(data);
  const currentExists = templates.some((template: AnyRow) => template.name === current);
  return [
    !templates.length ? '<option value="">No APPROVED template synced</option>' : '',
    current && !currentExists ? `<option value="${esc(current)}" selected>${esc(current)} — NOT APPROVED/SYNCED</option>` : '',
    ...templates.map((template: AnyRow) => `<option value="${esc(template.name)}" ${template.name === current ? 'selected' : ''}>${esc(template.name)} (${esc(template.language || 'ms')})</option>`)
  ].join('');
}

function shell() {
  const tabs = [
    ['overview','▦ Overview'],['connection','⚙ Connection'],['rules','✉ Notification Rules'],
    ['templates','▣ Meta Templates'],['test','🧪 Send Test'],['queue','↻ Queue & Logs']
  ];
  return `<div class="wf5-shell">
    <aside>
      <b>WhatsApp Control</b><small>Unified Inbox + WasapFlow</small>
      <nav>${tabs.map(([key,label]) => `<button data-tab="${key}" class="${activeTab === key ? 'active' : ''}">${label}</button>`).join('')}</nav>
    </aside>
    <section class="wf5-workspace">
      <header><div><small>ORDER NOTIFICATION OS</small><h2>WhatsApp Notification Control Center</h2></div><button id="wf5Close" aria-label="Close">×</button></header>
      <main id="wf5Main"><div class="wf5-loading">Loading secure WhatsApp settings…</div></main>
    </section>
  </div>`;
}

function metrics(data: AnyRow) {
  const connected = Boolean(data.status?.configured?.partner_key && data.status?.configured?.waba_id);
  return `<div class="wf5-metrics">
    <article><b>${connected ? 'Connected' : 'Credential Needed'}</b><span>WasapFlow</span></article>
    <article><b>${approvedTemplates(data).length}</b><span>Approved templates</span></article>
    <article><b>${Number(data.summary?.pending || 0) + Number(data.summary?.processing || 0)}</b><span>Pending queue</span></article>
    <article><b>${data.summary?.failed || 0}</b><span>Failed</span></article>
  </div>`;
}

function overview(data: AnyRow) {
  return `${metrics(data)}
    <section class="wf5-card">
      <h3>Architecture</h3>
      <div class="wf5-flow"><b>WasapFlow inbound</b><i>→</i><b>Unified Inbox 24H</b><i>→</i><b>Order event queue</b><i>→</i><b>Free-form / Meta template</b></div>
      <p>Event order disimpan dahulu dalam queue. Background dispatcher menghantar secara automatik dan membuat retry jika provider gagal.</p>
      <div class="wf5-actions"><button id="wf5Process">Process Queue Now</button><button id="wf5Sync">Sync Meta Templates</button></div>
    </section>`;
}

function connection(data: AnyRow) {
  const status = data.status || {};
  const configured = status.configured || {};
  return `${metrics(data)}
    <section class="wf5-card">
      <h3>Connection Settings</h3>
      <p>Webhook inbound kekal di Unified Inbox. Panel ini mengawal penghantaran notifikasi order.</p>
      <form id="wf5Settings" class="wf5-form">
        <label>Enable notification<select name="enabled"><option value="true" ${status.enabled !== false ? 'selected' : ''}>Enabled</option><option value="false" ${status.enabled === false ? 'selected' : ''}>Disabled</option></select></label>
        <label>WasapFlow Base URL<input name="base_url" value="${esc(status.base_url || 'https://officialapi.wasapflow.com/bridge/v1')}"></label>
        <label>Partner Key <small>${configured.partner_key ? 'configured ✅' : 'missing ⚠️'}</small><input name="partner_key" type="password" placeholder="Leave blank to keep existing"></label>
        <label>WABA ID <small>${configured.waba_id ? 'configured ✅' : 'missing ⚠️'}</small><input name="waba_id" value="${esc(status.waba_id || '')}" placeholder="Meta WABA ID"></label>
        <label>Language<input name="default_language" value="${esc(status.default_language || 'ms')}"></label>
        <label>Customer App URL<input name="customer_app_base_url" value="${esc(status.customer_app_base_url || location.origin)}"></label>
        <label class="wide">Unified Inbox 24H URL<input name="unified_inbox_24h_url" value="${esc(status.unified_inbox_24h_url || '')}"></label>
        <div class="wf5-actions wide"><button>Save Settings</button><button type="button" id="wf5Sync">Sync Meta Templates</button></div>
      </form>
    </section>`;
}

function rules(data: AnyRow) {
  const cards = (data.rules || []).map((rule: AnyRow) => `<details class="wf5-card wf5-rule">
    <summary><b>${esc(rule.label)}</b><span>${rule.enabled ? 'Enabled' : 'Disabled'} · ${esc(rule.template_name || 'No template')}</span></summary>
    <form>
      <input type="hidden" name="event_type" value="${esc(rule.event_type)}">
      <label class="check"><input type="checkbox" name="enabled" ${rule.enabled ? 'checked' : ''}> Enable notification</label>
      <label class="check"><input type="checkbox" name="freeform_enabled" ${rule.freeform_enabled ? 'checked' : ''}> Free-form when 24H open</label>
      <label class="check"><input type="checkbox" name="template_enabled" ${rule.template_enabled ? 'checked' : ''}> Template after 24H</label>
      <label class="wide">Free-form message<textarea name="freeform_text" rows="5">${esc(rule.freeform_text)}</textarea></label>
      <label>Approved template<select name="template_name">${templateOptions(data, rule.template_name || '')}</select></label>
      <label>Language<input name="template_language" value="${esc(rule.template_language || 'ms')}"></label>
      <label>Template parameter order<input name="template_params" value="${esc(asArray(rule.template_params).join(', '))}"><small>Susunan mesti sama dengan {{1}}, {{2}}, {{3}} dalam Meta.</small></label>
      <div class="wide wf5-preview"><b>Free-form preview</b><pre>${esc(renderText(rule.freeform_text))}</pre></div>
      <div class="wf5-actions wide"><button>Save Rule</button></div>
    </form>
  </details>`).join('');
  return `<section class="wf5-card"><h3>System Fields</h3><div class="wf5-chips">${FIELDS.map(field => `<code>{${field}}</code>`).join('')}</div></section>
    ${cards || '<section class="wf5-card wf5-error">Tiada rule diterima daripada backend. Cuba refresh atau login semula.</section>'}`;
}

function templates(data: AnyRow) {
  const synced = approvedTemplates(data);
  return `<section class="wf5-card">
      <div class="wf5-title"><div><h3>Synced APPROVED Templates</h3><p>Pilih template ini dalam Notification Rules.</p></div><button id="wf5Sync">Sync Meta Templates</button></div>
      <div class="wf5-list">${synced.map((template: AnyRow) => `<div><b>${esc(template.name)}</b><span>${esc(template.language || 'ms')} · ${esc(template.category || '')}</span><strong>APPROVED</strong></div>`).join('') || '<p>Belum ada approved template.</p>'}</div>
    </section>
    <section class="wf5-grid">${BLUEPRINTS.map(blueprint => `<article class="wf5-card"><h3>${esc(blueprint.name)}</h3><p>${esc(blueprint.category)} · ${esc(blueprint.event_type)}</p><pre>${esc(blueprint.body)}</pre><small>${blueprint.params.map((param,index) => `{{${index + 1}}}=${param}`).join(' · ')}</small><div class="wf5-actions"><button data-copy-body="${esc(blueprint.name)}">Copy Body</button><button data-copy-json="${esc(blueprint.name)}">Copy Meta JSON</button></div></article>`).join('')}</section>`;
}

function sendTest(data: AnyRow) {
  return `<section class="wf5-card"><h3>Send Test</h3><p>Auto: 24H open menggunakan free-form; selepas 24H menggunakan template APPROVED yang dipilih dalam rule.</p>
    <form id="wf5Test" class="wf5-form">
      <label>Phone<input name="phone" value="60129554732" required></label>
      <label>Event<select name="event_type">${(data.rules || []).map((rule: AnyRow) => `<option value="${esc(rule.event_type)}">${esc(rule.label)}</option>`).join('')}</select></label>
      <label>Mode<select name="mode"><option value="auto">Auto 24H decision</option><option value="text">Force free-form</option><option value="template">Force template</option></select></label>
      ${FIELDS.map(field => `<label>${field}<input name="var_${field}" value="${esc(SAMPLE[field] || '')}"></label>`).join('')}
      <div class="wf5-actions wide"><button>Send Test</button></div>
    </form>
  </section>`;
}

function queue(data: AnyRow) {
  const currentRows = data.summary?.recent_queue || [];
  const legacyRows = data.summary?.recent_skipped || [];
  const rows = showLegacy ? [...currentRows, ...legacyRows] : currentRows;
  return `${metrics(data)}
    <section class="wf5-card">
      <div class="wf5-title"><div><h3>Notification Queue</h3><p>${data.summary?.skipped || 0} legacy record disimpan untuk audit dan tidak dihantar.</p></div><div class="wf5-actions"><button id="wf5ToggleLegacy">${showLegacy ? 'Hide Legacy' : 'Show Legacy'}</button><button id="wf5Process">Process Now</button></div></div>
      <div class="wf5-log">${rows.map((row: AnyRow) => `<div><b class="status-${esc(row.status)}">${esc(row.status)}</b><span>${esc(row.event_type)}<br>${esc(row.phone || '')}</span><small>Attempts ${row.attempts || 0}<br>${esc(row.last_error || '')}</small>${row.status === 'failed' ? `<button data-retry="${esc(row.id)}">Retry</button>` : ''}</div>`).join('') || '<p>Tiada pending atau failed notification.</p>'}</div>
    </section>
    <section class="wf5-card"><h3>Recent Provider Logs</h3><div class="wf5-log">${(data.outbox || []).slice(0,30).map((row: AnyRow) => `<div><b class="status-${esc(row.status)}">${esc(row.status)}</b><span>${esc(row.event_type || '')}<br>${esc(row.phone || '')}</span><small>${esc(row.mode || '')} · ${esc(row.template_name || '')}<br>${esc(row.error_message || row.decision_reason || '')}</small></div>`).join('') || '<p>Belum ada provider log.</p>'}</div></section>`;
}

function contentForTab(data: AnyRow) {
  if (activeTab === 'connection') return connection(data);
  if (activeTab === 'rules') return rules(data);
  if (activeTab === 'templates') return templates(data);
  if (activeTab === 'test') return sendTest(data);
  if (activeTab === 'queue') return queue(data);
  return overview(data);
}

async function refresh(wrapper: HTMLElement) {
  cached = null;
  const main = wrapper.querySelector<HTMLElement>('#wf5Main')!;
  main.innerHTML = '<div class="wf5-loading">Refreshing secure data…</div>';
  const data = await loadData(true);
  render(wrapper, data);
}

function copy(value: string) {
  navigator.clipboard.writeText(value).then(() => toast('Copied'));
}

function bind(wrapper: HTMLElement, data: AnyRow) {
  wrapper.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === activeTab);
    button.onclick = () => {
      activeTab = button.dataset.tab || 'overview';
      sessionStorage.setItem('wf_v5_tab', activeTab);
      render(wrapper, data);
    };
  });

  const sync = async () => {
    try {
      toast('Syncing templates…');
      const result = await edge('whatsapp-admin','/templates/sync',{method:'POST',body:'{}'});
      toast(`Synced ${result.synced || 0} template`);
      await refresh(wrapper);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  };
  wrapper.querySelectorAll<HTMLButtonElement>('#wf5Sync').forEach(button => button.onclick = sync);
  wrapper.querySelectorAll<HTMLButtonElement>('#wf5Process').forEach(button => button.onclick = () => {
    window.dispatchEvent(new Event('wf:process-queue'));
    toast('Queue processing started');
    window.setTimeout(() => void refresh(wrapper).catch(error => toast(error.message, true)), 2500);
  });
  wrapper.querySelector<HTMLButtonElement>('#wf5ToggleLegacy')?.addEventListener('click', () => {
    showLegacy = !showLegacy;
    render(wrapper, data);
  });

  wrapper.querySelector<HTMLFormElement>('#wf5Settings')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: AnyRow = {};
    ['enabled','base_url','waba_id','default_language','customer_app_base_url','unified_inbox_24h_url']
      .forEach(key => body[key] = String(form.get(key) || ''));
    const partnerKey = String(form.get('partner_key') || '').trim();
    if (partnerKey) body.partner_key = partnerKey;
    try {
      await edge('whatsapp-admin','/settings',{method:'POST',body:JSON.stringify(body)});
      toast('Settings saved');
      await refresh(wrapper);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  });

  wrapper.querySelectorAll<HTMLFormElement>('.wf5-rule form').forEach(form => {
    form.onsubmit = async event => {
      event.preventDefault();
      const values = new FormData(form);
      const body = {
        event_type:String(values.get('event_type') || ''),
        enabled:values.get('enabled') === 'on',
        freeform_enabled:values.get('freeform_enabled') === 'on',
        template_enabled:values.get('template_enabled') === 'on',
        freeform_text:String(values.get('freeform_text') || ''),
        template_name:String(values.get('template_name') || ''),
        template_language:String(values.get('template_language') || 'ms'),
        template_params:String(values.get('template_params') || '').split(',').map(item => item.trim()).filter(Boolean),
        available_fields:FIELDS
      };
      try {
        await edge('whatsapp-admin','/rules',{method:'POST',body:JSON.stringify(body)});
        toast('Rule saved');
        await refresh(wrapper);
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), true);
      }
    };
  });

  wrapper.querySelector<HTMLFormElement>('#wf5Test')?.addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const vars: AnyRow = {};
    FIELDS.forEach(field => vars[field] = String(values.get(`var_${field}`) || ''));
    const eventType = String(values.get('event_type') || '');
    const mode = String(values.get('mode') || 'auto');
    const payload: AnyRow = {phone:String(values.get('phone') || ''),event_type:eventType,vars,source:'admin_test'};
    if (mode !== 'auto') payload.mode = mode;
    try {
      const result = await edge('whatsapp-send','',{method:'POST',body:JSON.stringify(payload)});
      toast(`Sent via ${result.mode}: ${result.message_id || 'accepted'}`);
      await refresh(wrapper);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  });

  wrapper.querySelectorAll<HTMLButtonElement>('[data-retry]').forEach(button => button.onclick = async () => {
    const { error } = await supabase.rpc('icetak_admin_retry_notification_job',{p_id:button.dataset.retry});
    if (error) return toast(error.message, true);
    window.dispatchEvent(new Event('wf:process-queue'));
    toast('Retry queued');
    window.setTimeout(() => void refresh(wrapper).catch(refreshError => toast(refreshError.message, true)), 2000);
  });

  wrapper.querySelectorAll<HTMLButtonElement>('[data-copy-body]').forEach(button => button.onclick = () => {
    const blueprint = BLUEPRINTS.find(item => item.name === button.dataset.copyBody);
    if (blueprint) copy(blueprint.body);
  });
  wrapper.querySelectorAll<HTMLButtonElement>('[data-copy-json]').forEach(button => button.onclick = () => {
    const blueprint = BLUEPRINTS.find(item => item.name === button.dataset.copyJson);
    if (!blueprint) return;
    copy(JSON.stringify({
      name:blueprint.name,
      language:'ms',
      category:blueprint.category,
      parameter_format:'POSITIONAL',
      components:[{type:'BODY',text:blueprint.body,example:{body_text:[blueprint.params.map(param => SAMPLE[param] || param)]}}]
    },null,2));
  });
}

function render(wrapper: HTMLElement, data: AnyRow) {
  const main = wrapper.querySelector<HTMLElement>('#wf5Main')!;
  main.innerHTML = contentForTab(data);
  bind(wrapper, data);
}

async function openControlCenter() {
  let wrapper = document.querySelector<HTMLElement>('#wf5Wrap');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = 'wf5Wrap';
    document.body.append(wrapper);
  }
  wrapper.innerHTML = shell();
  wrapper.querySelector<HTMLButtonElement>('#wf5Close')!.onclick = () => wrapper?.remove();
  try {
    const data = await loadData(true);
    render(wrapper, data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    wrapper.querySelector<HTMLElement>('#wf5Main')!.innerHTML = `<section class="wf5-card wf5-error"><h3>WhatsApp Control gagal dimuatkan</h3><p>${esc(message)}</p><button id="wf5RetryLoad">Retry</button></section>`;
    wrapper.querySelector<HTMLButtonElement>('#wf5RetryLoad')!.onclick = () => void refresh(wrapper!).catch(retryError => toast(retryError.message, true));
  }
}

async function ensureButton() {
  const oldV4 = document.querySelector('#wfOpenBtn');
  oldV4?.remove();
  const existing = document.querySelector('#wf5OpenBtn');
  const { data } = await supabase.auth.getSession();
  const isAdminPage = /Order Control Tower|iCetak ERP|Orders|Payments|Shipping/i.test(document.body.textContent || '');
  if (!data.session || !isAdminPage) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const button = document.createElement('button');
  button.id = 'wf5OpenBtn';
  button.textContent = '⚡ WhatsApp Control';
  button.onclick = () => void openControlCenter();
  document.body.append(button);
}

const style = document.createElement('style');
style.textContent = `
#workflowOpenBtn{display:none!important}
#wf5OpenBtn{position:fixed;right:18px;bottom:18px;z-index:9998;border:0;border-radius:999px;background:#16a34a;color:#fff;padding:14px 18px;font-weight:900;box-shadow:0 18px 50px #16a34a55}
#wf5Wrap{position:fixed;inset:0;z-index:99999;background:#f3f6fb;overflow:auto;overflow-x:hidden}
.wf5-shell{min-height:100vh;display:grid;grid-template-columns:240px minmax(0,1fr);width:100%;max-width:100vw}
.wf5-shell *{box-sizing:border-box}.wf5-shell aside{background:#0f172a;color:#fff;padding:22px;position:sticky;top:0;height:100vh;overflow:auto}
.wf5-shell aside>b{font-size:22px;display:block}.wf5-shell aside small{color:#93c5fd}.wf5-shell aside nav{margin-top:20px}
.wf5-shell aside button{display:block;width:100%;text-align:left;border:0;border-radius:13px;background:transparent;color:#e5e7eb;padding:13px;margin-top:8px;font-weight:800}
.wf5-shell aside button.active{background:#eaff3f;color:#0f172a}.wf5-workspace{min-width:0;width:100%;overflow:hidden}
.wf5-workspace>header{background:#0f172a;color:#fff;padding:20px 26px;display:flex;justify-content:space-between;align-items:center;gap:16px}
.wf5-workspace header h2{margin:2px 0 0;font-size:20px}.wf5-workspace header button{border:0;border-radius:999px;background:#334155;color:#fff;width:42px;height:42px;font-size:26px;flex:0 0 auto}
.wf5-workspace main{padding:22px;width:100%;max-width:1440px;margin:0 auto;overflow:hidden}.wf5-loading{padding:24px;font-weight:800}
.wf5-metrics,.wf5-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}.wf5-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.wf5-metrics article,.wf5-card{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:18px;box-shadow:0 12px 36px #0f172a0d;min-width:0}
.wf5-metrics b{display:block;font-size:24px}.wf5-metrics span,.wf5-card p,.wf5-card small{color:#64748b}.wf5-card{margin-bottom:14px}.wf5-card h3{margin:0 0 10px}
.wf5-flow{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.wf5-flow b{background:#eef2ff;padding:10px;border-radius:12px}.wf5-form,.wf5-rule form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.wf5-form label,.wf5-rule label{font-weight:800;min-width:0}.wf5-form input,.wf5-form select,.wf5-form textarea,.wf5-rule input,.wf5-rule select,.wf5-rule textarea{display:block;width:100%;min-width:0;margin-top:6px;padding:12px;border:1px solid #cbd5e1;border-radius:11px;font:inherit}
.wide{grid-column:1/-1}.check{background:#f8fafc;border:1px solid #e2e8f0;border-radius:11px;padding:10px}.check input{display:inline;width:auto;margin:0 8px 0 0}
.wf5-actions{display:flex;gap:9px;flex-wrap:wrap}.wf5-actions button,.wf5-title button,.wf5-log button,.wf5-error button{border:0;border-radius:11px;background:#2563eb;color:#fff;padding:11px 14px;font-weight:900}
.wf5-chips{display:flex;gap:7px;flex-wrap:wrap}.wf5-chips code{background:#eef2ff;color:#3730a3;padding:6px 9px;border-radius:999px}.wf5-rule summary{display:flex;justify-content:space-between;gap:12px;cursor:pointer}.wf5-rule form{margin-top:16px}
.wf5-preview pre,.wf5-grid pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0f172a;color:#e2e8f0;padding:13px;border-radius:12px;max-width:100%}
.wf5-list div,.wf5-log div{display:grid;grid-template-columns:minmax(110px,140px) minmax(160px,1fr) minmax(220px,1.5fr) auto;gap:10px;align-items:center;border:1px solid #e2e8f0;background:#f8fafc;padding:10px;border-radius:11px;margin-top:8px;min-width:0}
.wf5-list span,.wf5-log span,.wf5-log small{overflow-wrap:anywhere}.wf5-title{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.status-sent{color:#15803d}.status-failed{color:#b91c1c}.status-pending,.status-processing{color:#a16207}.status-skipped{color:#64748b}
.wf5-error{background:#fee2e2;color:#991b1b}#wf5Toast{position:fixed;z-index:1000000;left:50%;bottom:24px;transform:translateX(-50%);color:#fff;padding:12px 16px;border-radius:12px;font-weight:900;max-width:min(720px,90vw);overflow-wrap:anywhere}#wf5Toast.good{background:#166534}#wf5Toast.bad{background:#b91c1c}
@media(max-width:980px){.wf5-shell{grid-template-columns:210px minmax(0,1fr)}.wf5-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.wf5-form,.wf5-rule form{grid-template-columns:repeat(2,minmax(0,1fr))}.wf5-log div{grid-template-columns:1fr 1fr}.wf5-grid{grid-template-columns:1fr}}
@media(max-width:700px){.wf5-shell{grid-template-columns:1fr}.wf5-shell aside{position:relative;height:auto}.wf5-shell aside nav{display:flex;overflow:auto;gap:6px}.wf5-shell aside button{min-width:max-content;margin:0}.wf5-metrics,.wf5-form,.wf5-rule form{grid-template-columns:1fr}.wf5-log div{grid-template-columns:1fr}.wf5-workspace main{padding:12px}.wf5-workspace>header{padding:16px}.wf5-title{display:block}.wf5-title .wf5-actions{margin-top:10px}}
`;
document.head.append(style);

void ensureButton();
window.addEventListener('load', () => void ensureButton());
window.addEventListener('focus', () => { cached = null; void ensureButton(); });
window.addEventListener('wf:queue-updated', () => { cached = null; });
supabase.auth.onAuthStateChange(() => { cached = null; void ensureButton(); });
setInterval(() => void ensureButton(), 5000);
