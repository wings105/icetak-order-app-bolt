const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const UNIFIED_24H_URL = 'https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/check-24h-window';
const DRAFT_KEY = 'wf_control_draft_v2';
const TAB_KEY = 'wf_control_active_tab_v2';

type Any = Record<string, any>;
type Blueprint = { name: string; label: string; event_type: string; category: string; body: string; params: string[] };

const BLUEPRINTS: Blueprint[] = [
  { name:'order_created_notice', label:'Order Created', event_type:'order_created', category:'UTILITY', body:'Hi {{1}}, order iCetak anda telah diterima.\n\nOrder ID: {{2}}\nJumlah: {{3}}\nTarikh perlu: {{4}}\n\nSemak order:\n{{5}}', params:['customer_name','order_id','order_total','date_need','order_link'] },
  { name:'payment_pending_notice', label:'Payment Pending', event_type:'payment_pending', category:'UTILITY', body:'Hi {{1}}, bayaran untuk order {{2}} masih belum diterima.\n\nJumlah: {{3}}\n\nBayar / upload resit di sini:\n{{4}}', params:['customer_name','order_id','order_total','payment_link'] },
  { name:'order_paid_notice', label:'Payment Received', event_type:'payment_received', category:'UTILITY', body:'Hi {{1}}, bayaran untuk order {{2}} telah diterima.\n\nJumlah: {{3}}\n\nOrder anda akan diproses mengikut tarikh diperlukan.', params:['customer_name','order_id','order_total'] },
  { name:'review_ready_notice', label:'Design Review Ready', event_type:'review_ready', category:'UTILITY', body:'Hi {{1}}, design untuk order {{2}} sudah ready untuk semakan.\n\nSila review di sini:\n{{3}}', params:['customer_name','order_id','review_link'] },
  { name:'production_started_notice', label:'Production Started', event_type:'production_started', category:'UTILITY', body:'Hi {{1}}, order {{2}} telah masuk proses production.\n\nKami akan update bila order siap / shipped.', params:['customer_name','order_id'] },
  { name:'order_ready_pickup_notice', label:'Ready For Pickup', event_type:'order_ready_pickup', category:'UTILITY', body:'Hi {{1}}, order {{2}} sudah siap untuk pickup.\n\nLokasi pickup:\n{{3}}\n\nSila maklumkan sebelum datang.', params:['customer_name','order_id','pickup_location'] },
  { name:'order_shipped_notice', label:'Order Shipped', event_type:'order_shipped', category:'UTILITY', body:'Hi {{1}}, order {{2}} telah dihantar melalui {{3}}.\n\nTracking No: {{4}}\n\nTrack parcel:\n{{5}}', params:['customer_name','order_id','courier','tracking_number','tracking_link'] },
  { name:'order_delivered_notice', label:'Order Delivered', event_type:'order_delivered', category:'UTILITY', body:'Hi {{1}}, parcel untuk order {{2}} telah delivered.\n\nTerima kasih kerana order dengan iCetak.', params:['customer_name','order_id'] },
  { name:'order_cancelled_notice', label:'Order Cancelled', event_type:'order_cancelled', category:'UTILITY', body:'Hi {{1}}, order {{2}} telah dibatalkan.\n\nJika ada pertanyaan, boleh hubungi kami semula.', params:['customer_name','order_id'] },
  { name:'magic_login_link', label:'Magic Login Link', event_type:'customer_login', category:'UTILITY', body:'Hi {{1}}, ini link login My Orders iCetak anda:\n\n{{2}}\n\nLink sah {{3}} minit dan hanya boleh digunakan sekali.', params:['customer_name','magic_link','expiry_minutes'] },
  { name:'customer_login_otp', label:'Customer Login OTP', event_type:'customer_login_otp', category:'AUTHENTICATION', body:'Kod login iCetak anda ialah {{1}}.\n\nKod sah selama {{2}} minit.', params:['otp_code','expiry_minutes'] },
];

const FIELD_HELP = ['customer_name','phone','order_id','order_total','date_need','order_link','payment_link','review_link','tracking_number','courier','tracking_link','pickup_location','otp_code','magic_link','expiry_minutes','support_phone'];
const SAMPLE: Any = { customer_name:'Zaim', phone:'60129554732', order_id:'IC260707-3904', order_total:'RM35', date_need:'25/07/2027', order_link:'https://icetak.bolt.host/?order=o_xxx', payment_link:'https://icetak.bolt.host/?order=o_xxx&page=payment', review_link:'https://icetak.bolt.host/review/demo', tracking_number:'MY123456789', courier:'SPX', tracking_link:'https://spx.co/track/MY123456789', pickup_location:'Bandar Baru Pasir Puteh', otp_code:'123456', magic_link:'https://icetak.bolt.host/?login=demo', expiry_minutes:'10', support_phone:'60179860656' };

let cachedData: Any | null = null;
let loading = false;

function activeTab(){ return sessionStorage.getItem(TAB_KEY) || 'connection'; }
function setActiveTab(tab:string){ sessionStorage.setItem(TAB_KEY, tab); }
function token(){ return sessionStorage.getItem('admin_access_token') || sessionStorage.getItem('admin_session') || ''; }
function isAdminPage(){ return Boolean(token()) && /Order Control Tower|iCetak ERP|WhatsApp Templates|Integrations|Orders|Payments/i.test(document.body.textContent || ''); }
function esc(v:unknown){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'} as Any)[c]); }
function arr(v:any){ return Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',').map(x => x.trim()).filter(Boolean) : []); }
function freeformFrom(b:Blueprint){ let t = b.body; b.params.forEach((p,i)=>{ t = t.replaceAll(`{{${i+1}}}`, `{${p}}`); }); return t; }
function renderText(text:string, vars:Any=SAMPLE){ return String(text || '').replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, (_,k) => String(vars[k] ?? '')); }
function draft(){ try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}'); } catch { return {}; } }
function saveDraftValue(name:string, value:string){ const d = draft(); d[name] = value; sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); }
function clearDraft(){ sessionStorage.removeItem(DRAFT_KEY); }
function draftVal(name:string, fallback=''){ const d = draft(); return d[name] ?? fallback; }
function toast(msg:string, bad=false){ let el=document.querySelector<HTMLElement>('#wfToast'); if(!el){ el=document.createElement('div'); el.id='wfToast'; document.body.append(el); } el.textContent=msg; Object.assign(el.style,{position:'fixed',zIndex:'999999',left:'50%',bottom:'24px',transform:'translateX(-50%)',background:bad?'#b91c1c':'#166534',color:'#fff',padding:'12px 16px',borderRadius:'12px',fontWeight:'900',boxShadow:'0 16px 48px rgba(0,0,0,.25)'}); setTimeout(()=>el?.remove(),4200); }
function copy(v:string){ void navigator.clipboard.writeText(v).then(()=>toast('Copied')); }

async function edge(fn:string, path='', init:RequestInit={}){
  const res = await fetch(`${supabaseUrl}/functions/v1/${fn}${path}`, { ...init, headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token()}`, ...(init.headers || {}) }});
  const data = await res.json().catch(()=>({}));
  if(!res.ok || data.ok === false) throw new Error(data.error || `Request failed ${res.status}`);
  return data;
}

async function loadAll(force=false){
  if(cachedData && !force) return cachedData;
  if(loading && cachedData) return cachedData;
  loading = true;
  try {
    const [status, rules, templates, outbox] = await Promise.all([
      edge('whatsapp-admin','/status').catch((e)=>({configured:{}, error:e.message})),
      edge('whatsapp-admin','/rules').catch(()=>({rules:[]})),
      edge('whatsapp-admin','/templates').catch(()=>({templates:[]})),
      edge('whatsapp-admin','/outbox').catch(()=>({outbox:[]})),
    ]);
    const ruleList = (rules.rules || []).map((r:Any)=>normalizeRule(r));
    for(const b of BLUEPRINTS){
      if(!ruleList.find((r:Any)=>r.event_type === b.event_type)) {
        ruleList.push(normalizeRule({ event_type:b.event_type, label:b.label, enabled:true, freeform_enabled:true, template_enabled:true, freeform_text:freeformFrom(b), template_name:b.name, template_language:'ms', template_params:b.params, available_fields:b.params }));
      }
    }
    cachedData = { status, rules:ruleList, templates:templates.templates || [], outbox:outbox.outbox || [] };
    return cachedData;
  } finally { loading = false; }
}
function normalizeRule(r:Any){ const b = BLUEPRINTS.find(x=>x.event_type===r.event_type) || BLUEPRINTS.find(x=>x.name===r.template_name); return { ...r, label:r.label || b?.label || r.event_type, enabled:r.enabled !== false, freeform_enabled:r.freeform_enabled !== false, template_enabled:r.template_enabled !== false, freeform_text:r.freeform_text || (b ? freeformFrom(b) : ''), template_name:r.template_name || b?.name || '', template_language:r.template_language || 'ms', template_params:arr(r.template_params?.value || r.template_params || b?.params), available_fields:arr(r.available_fields || b?.params) }; }
function badge(templates:Any[], name:string){ const t = templates.find(x=>String(x.name).toLowerCase() === String(name).toLowerCase()); if(!t) return '<span class="wf-badge warn">not synced</span>'; const s = String(t.status || 'SYNCED').toUpperCase(); return `<span class="wf-badge ${s==='APPROVED'?'ok':'warn'}">${esc(s)}</span>`; }
function templateOptions(templates:Any[], selected:string){ const names = Array.from(new Set([...BLUEPRINTS.map(b=>b.name), ...templates.map(t=>t.name)])); return names.map(n=>`<option value="${esc(n)}" ${n===selected?'selected':''}>${esc(n)}</option>`).join(''); }

async function openPanel(){
  let wrap = document.querySelector<HTMLElement>('#wfPanelWrap');
  if(!wrap){ wrap = document.createElement('div'); wrap.id='wfPanelWrap'; document.body.append(wrap); }
  wrap.innerHTML = `<div class="wf-shell"><aside><b>WhatsApp Control</b><small>Order notification OS</small><button data-wf-tab="connection">⚙️ Connection</button><button data-wf-tab="rules">✉️ Notification Rules</button><button data-wf-tab="templates">📋 Meta Templates</button><button data-wf-tab="test">🧪 Send Test</button><button data-wf-tab="logs">📜 Logs</button></aside><section class="wf-main"><header><div><small>UNIFIED INBOX + WASAPFLOW</small><h2>WhatsApp Notification Control Center</h2></div><button id="wfClose">×</button></header><main><div class="wf-loading">Loading…</div></main></section></div>`;
  wrap.querySelector<HTMLButtonElement>('#wfClose')!.onclick = () => wrap?.remove();
  try { renderPanel(wrap, await loadAll()); } catch(e:any){ wrap.querySelector('main')!.innerHTML = `<p class="wf-error">${esc(e.message)}</p>`; }
}

function renderPanel(wrap:HTMLElement, data:Any){
  wrap.querySelectorAll<HTMLButtonElement>('[data-wf-tab]').forEach(b => { b.classList.toggle('active', b.dataset.wfTab === activeTab()); b.onclick = () => { setActiveTab(b.dataset.wfTab!); renderPanel(wrap, data); }; });
  const main = wrap.querySelector('main')!;
  const tab = activeTab();
  if(tab === 'connection') main.innerHTML = connectionHtml(data);
  if(tab === 'rules') main.innerHTML = rulesHtml(data);
  if(tab === 'templates') main.innerHTML = templatesHtml(data);
  if(tab === 'test') main.innerHTML = testHtml(data);
  if(tab === 'logs') main.innerHTML = logsHtml(data);
  bindPanel(wrap, data);
}

function connectionHtml(d:Any){
  const cfg = d.status.configured || {}; const connected = !!cfg.partner_key && !!cfg.waba_id;
  return `<section class="wf-metrics"><article><b>${connected?'Connected':'Credential Needed'}</b><span>WasapFlow</span></article><article><b>${d.templates.length}</b><span>Synced templates</span></article><article><b>${d.rules.length}</b><span>Rules</span></article><article><b>${d.outbox.length}</b><span>Logs</span></article></section><section class="wf-card"><h3>Connection Settings</h3><p>Webhook inbound utama kekal di Unified Inbox. Project order ini check 24H dan send notification.</p><form id="wfSettings" class="wf-form"><label>Enable notification<select name="enabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></label><label>WF Base URL<input name="base_url" value="${esc(draftVal('base_url', d.status.base_url || 'https://officialapi.wasapflow.com/bridge/v1'))}"></label><label>Partner Key <small>${cfg.partner_key?'configured ✅':'missing ⚠️'}</small><input name="partner_key" type="password" value="${esc(draftVal('partner_key'))}" placeholder="wf_xxx"></label><label>WABA ID <small>${cfg.waba_id?'configured ✅':'missing ⚠️'}</small><input name="waba_id" value="${esc(draftVal('waba_id'))}" placeholder="123456789"></label><label>Webhook Secret <small>${cfg.webhook_secret?'configured ✅':'missing ⚠️'}</small><input name="webhook_secret" type="password" value="${esc(draftVal('webhook_secret'))}" placeholder="WasapFlow webhook secret"></label><label>Language<input name="default_language" value="${esc(draftVal('default_language','ms'))}"></label><label>Unified Inbox 24H URL<input name="unified_inbox_24h_url" value="${esc(draftVal('unified_inbox_24h_url',UNIFIED_24H_URL))}"></label><label>Unified Inbox 24H Key <small>secret</small><input name="unified_inbox_24h_key" type="password" value="${esc(draftVal('unified_inbox_24h_key'))}" placeholder="Bearer key"></label><label>Customer App URL<input name="customer_app_base_url" value="${esc(draftVal('customer_app_base_url',location.origin))}"></label><label>Order Project Webhook URL <small>optional log only</small><input readonly value="${esc(supabaseUrl + '/functions/v1/wasapflow-webhook')}"></label><div class="wf-actions"><button type="submit">Save Settings</button><button type="button" id="wfCopyWebhook">Copy Order Webhook</button><button type="button" id="wfSync">Sync Meta Templates</button></div></form></section><section class="wf-card wf-info"><h3>Correct Architecture</h3><p><b>WasapFlow inbound webhook utama → Unified Inbox.</b> Order system → check Unified Inbox 24H endpoint → send free-form atau template.</p></section>`;
}
function rulesHtml(d:Any){ return `<section class="wf-card"><h3>Notification Rules</h3><p>Setiap event ada free-form wording untuk 24H window open dan Meta template untuk selepas 24H.</p><div class="wf-fieldchips">${FIELD_HELP.map(f=>`<code>{${f}}</code>`).join('')}</div></section>${d.rules.map((r:Any)=>ruleCard(r,d.templates)).join('')}`; }
function ruleCard(r:Any, templates:Any[]){ const params=arr(r.template_params).join(', '), fields=arr(r.available_fields).join(', '); return `<section class="wf-card wf-rule" data-event="${esc(r.event_type)}"><h3>${esc(r.label || r.event_type)} <small>${esc(r.event_type)}</small></h3><form class="wf-rule-form"><input type="hidden" name="event_type" value="${esc(r.event_type)}"><label class="check"><input type="checkbox" name="enabled" ${r.enabled?'checked':''}> Enable notification</label><label class="check"><input type="checkbox" name="freeform_enabled" ${r.freeform_enabled?'checked':''}> Use free-form when 24H open</label><label class="check"><input type="checkbox" name="template_enabled" ${r.template_enabled?'checked':''}> Use template after 24H</label><label class="wide">Free-form message<textarea name="freeform_text" rows="5">${esc(r.freeform_text)}</textarea></label><label>Template<select name="template_name">${templateOptions(templates,r.template_name)}</select>${badge(templates,r.template_name)}</label><label>Language<input name="template_language" value="${esc(r.template_language || 'ms')}"></label><label>Template params order<input name="template_params" value="${esc(params)}"><small>Example: customer_name, order_id, order_total</small></label><label>Available fields<input name="available_fields" value="${esc(fields)}"></label><div class="wf-preview"><b>Free-form preview:</b><pre>${esc(renderText(r.freeform_text,SAMPLE))}</pre></div><div class="wf-actions"><button type="submit">Save Rule</button><button type="button" data-copy-rule="${esc(r.event_type)}">Copy Free-form</button></div></form></section>`; }
function templatesHtml(d:Any){ return `<section class="wf-card"><h3>Meta Template Guide</h3><p>Create manual dalam Meta/WasapFlow. Lepas approved, tekan Sync Meta Templates.</p><div class="wf-actions"><button type="button" id="wfSync2">Sync Meta Templates</button></div></section><section class="wf-template-grid">${BLUEPRINTS.map(b=>`<article class="wf-card"><h3>${esc(b.name)} ${badge(d.templates,b.name)}</h3><p><b>Category:</b> ${esc(b.category)}<br><b>Event:</b> ${esc(b.event_type)}</p><pre>${esc(b.body)}</pre><p><b>Params:</b> ${b.params.map((p,i)=>`{{${i+1}}}=${p}`).join(', ')}</p><div class="wf-actions"><button type="button" data-copy-template="${esc(b.name)}">Copy Body</button><button type="button" data-copy-json="${esc(b.name)}">Copy JSON</button></div></article>`).join('')}</section>`; }
function testHtml(d:Any){ return `<section class="wf-card"><h3>Send Test</h3><p>Mode auto akan check Unified Inbox 24H: free-form jika open, template jika expired.</p><form id="wfSendTest" class="wf-form"><label>Phone<input name="phone" value="${esc(draftVal('test_phone'))}" placeholder="0129554732" required></label><label>Event<select name="event_type">${d.rules.map((r:Any)=>`<option value="${esc(r.event_type)}">${esc(r.label || r.event_type)}</option>`).join('')}</select></label><label>Mode<select name="mode"><option value="auto">Auto 24H decision</option><option value="text">Force free-form</option><option value="template">Force template</option></select></label>${FIELD_HELP.map(k=>`<label>${k}<input name="var_${k}" value="${esc((SAMPLE as Any)[k] || '')}"></label>`).join('')}<div class="wf-actions"><button type="submit">Send Test</button></div></form></section>`; }
function logsHtml(d:Any){ return `<section class="wf-card"><h3>Recent WhatsApp Logs</h3><div class="wf-log">${d.outbox.slice(0,50).map((o:Any)=>`<div><b>${esc(o.status)}</b><span>${esc(o.event_type || '')} / ${esc(o.phone)} / ${esc(o.message_type || o.mode || '')}</span><small>${esc(o.template_name || o.body || '')}<br>${esc(o.error_message || o.created_at || '')}</small></div>`).join('') || '<p>No logs yet.</p>'}</div></section>`; }

function bindPanel(wrap:HTMLElement, data:Any){
  wrap.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('#wfSettings input,#wfSettings textarea,#wfSettings select,#wfSendTest input[name="phone"]').forEach(el => el.addEventListener('input', () => saveDraftValue(el.name === 'phone' ? 'test_phone' : el.name, el.value)));
  wrap.querySelector<HTMLButtonElement>('#wfCopyWebhook')?.addEventListener('click',()=>copy(supabaseUrl + '/functions/v1/wasapflow-webhook'));
  const sync = async()=>{ try{ toast('Syncing…'); const r = await edge('whatsapp-admin','/templates/sync',{method:'POST',body:'{}'}); toast(`Synced ${r.synced || 0}`); cachedData = null; renderPanel(wrap, await loadAll(true)); } catch(e:any){ toast(e.message || 'Sync failed', true); } };
  wrap.querySelector<HTMLButtonElement>('#wfSync')?.addEventListener('click',sync);
  wrap.querySelector<HTMLButtonElement>('#wfSync2')?.addEventListener('click',sync);
  wrap.querySelector<HTMLFormElement>('#wfSettings')?.addEventListener('submit',async ev=>{ ev.preventDefault(); const f = new FormData(ev.currentTarget); const body:Any = {}; ['enabled','base_url','waba_id','default_language','customer_app_base_url','unified_inbox_24h_url'].forEach(k=>body[k]=String(f.get(k)||'')); ['partner_key','webhook_secret','unified_inbox_24h_key'].forEach(k=>{ const v=String(f.get(k)||'').trim(); if(v) body[k]=v; }); try{ await edge('whatsapp-admin','/settings',{method:'POST',body:JSON.stringify(body)}); toast('Settings saved'); clearDraft(); cachedData=null; renderPanel(wrap, await loadAll(true)); } catch(e:any){ toast(e.message || 'Save failed', true); } });
  wrap.querySelectorAll<HTMLFormElement>('.wf-rule-form').forEach(form=>form.addEventListener('submit',async ev=>{ ev.preventDefault(); const f = new FormData(form); const body:Any = { event_type:String(f.get('event_type')), enabled:f.get('enabled')==='on', freeform_enabled:f.get('freeform_enabled')==='on', template_enabled:f.get('template_enabled')==='on', freeform_text:String(f.get('freeform_text')||''), template_name:String(f.get('template_name')||''), template_language:String(f.get('template_language')||'ms'), template_params:String(f.get('template_params')||'').split(',').map(x=>x.trim()).filter(Boolean), available_fields:String(f.get('available_fields')||'').split(',').map(x=>x.trim()).filter(Boolean) }; try{ await edge('whatsapp-admin','/rules',{method:'POST',body:JSON.stringify(body)}); toast('Rule saved'); cachedData=null; renderPanel(wrap, await loadAll(true)); } catch(e:any){ toast(e.message || 'Rule save failed', true); } }));
  wrap.querySelector<HTMLFormElement>('#wfSendTest')?.addEventListener('submit',async ev=>{ ev.preventDefault(); const f = new FormData(ev.currentTarget), vars:Any = {}; Object.keys(SAMPLE).forEach(k=>vars[k]=String(f.get('var_'+k)||SAMPLE[k])); const payload = { phone:String(f.get('phone')||''), event_type:String(f.get('event_type')||'order_created'), mode:String(f.get('mode')||'auto'), vars, source:'admin_test' }; saveDraftValue('test_phone', payload.phone); try{ const r = await edge('whatsapp-send','',{method:'POST',body:JSON.stringify(payload)}); toast(`Sent ${r.mode || ''}: ${r.message_id || 'ok'}`); cachedData=null; renderPanel(wrap, await loadAll(true)); } catch(e:any){ toast(e.message || 'Send failed', true); } });
  wrap.querySelectorAll<HTMLButtonElement>('[data-copy-rule]').forEach(btn=>btn.onclick=()=>{ const ev=btn.dataset.copyRule!, r=data.rules.find((x:Any)=>x.event_type===ev); copy(r?.freeform_text || ''); });
  wrap.querySelectorAll<HTMLButtonElement>('[data-copy-template]').forEach(btn=>btn.onclick=()=>{ const b=BLUEPRINTS.find(x=>x.name===btn.dataset.copyTemplate); if(b) copy(b.body); });
  wrap.querySelectorAll<HTMLButtonElement>('[data-copy-json]').forEach(btn=>btn.onclick=()=>{ const b=BLUEPRINTS.find(x=>x.name===btn.dataset.copyJson); if(!b)return; copy(JSON.stringify({ name:b.name, language:'ms', category:b.category, parameter_format:'POSITIONAL', components:[{ type:'BODY', text:b.body, example:{ body_text:[b.params.map(p=>SAMPLE[p] || p)] } }] }, null, 2)); });
}

function ensureButton(){
  const existing = document.querySelector('#wfOpenBtn');
  if(!isAdminPage()){ existing?.remove(); return; }
  if(existing) return;
  const btn = document.createElement('button');
  btn.id = 'wfOpenBtn';
  btn.textContent = '⚡ WhatsApp Control';
  btn.onclick = () => void openPanel();
  document.body.append(btn);
}
function injectStyles(){
  if(document.querySelector('#wfControlStyles')) return;
  const s=document.createElement('style'); s.id='wfControlStyles'; s.textContent = `#wfOpenBtn{position:fixed;right:18px;bottom:18px;z-index:9998;background:#16a34a;color:#fff;border:0;border-radius:999px;padding:14px 18px;font-weight:900;box-shadow:0 18px 50px rgba(22,163,74,.34);cursor:pointer}#wfPanelWrap{position:fixed;inset:0;z-index:99998;background:rgba(15,23,42,.62);overflow:auto}.wf-shell{min-height:100vh;display:grid;grid-template-columns:260px 1fr;background:#f3f6fb}.wf-shell aside{background:#0f172a;color:white;padding:24px;position:sticky;top:0;height:100vh}.wf-shell aside b{display:block;font-size:22px}.wf-shell aside small{display:block;color:#94a3b8;margin:6px 0 22px}.wf-shell aside button{display:block;width:100%;text-align:left;border:0;border-radius:14px;background:transparent;color:#e5e7eb;font-weight:900;padding:13px 14px;margin:7px 0;cursor:pointer}.wf-shell aside button.active,.wf-shell aside button:hover{background:#eaff3f;color:#0f172a}.wf-main header{display:flex;justify-content:space-between;align-items:center;background:#0f172a;color:white;padding:22px 28px}.wf-main header h2{margin:0;font-size:30px}.wf-main header small{letter-spacing:.15em;color:#93c5fd}.wf-main header button{border:0;background:#334155;color:white;border-radius:999px;width:44px;height:44px;font-size:28px}.wf-main main{padding:22px;max-width:1220px}.wf-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.wf-metrics article,.wf-card{background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:18px;box-shadow:0 14px 38px rgba(15,23,42,.06)}.wf-metrics b{font-size:25px;display:block}.wf-card{margin-top:16px}.wf-card h3{margin:0 0 8px}.wf-card p,.wf-card small,.wf-card label small{color:#64748b}.wf-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.wf-form label,.wf-rule label{font-weight:900;color:#0f172a}.wf-form input,.wf-form textarea,.wf-form select,.wf-rule input,.wf-rule textarea,.wf-rule select{width:100%;box-sizing:border-box;margin-top:7px;padding:12px;border:1px solid #cbd5e1;border-radius:13px;font:inherit}.wf-actions{grid-column:1/-1;display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}.wf-actions button,.wf-card button,.wf-form button{border:0;border-radius:13px;background:#2563eb;color:white;font-weight:900;padding:12px 16px;cursor:pointer}.wf-actions button:nth-child(2){background:#0f172a}.wf-actions button:nth-child(3),.wf-card button[data-copy-json]{background:#16a34a}.wf-fieldchips{display:flex;flex-wrap:wrap;gap:8px}.wf-fieldchips code{background:#eef2ff;color:#3730a3;border-radius:999px;padding:6px 9px}.wf-rule form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.wf-rule .wide,.wf-rule .wf-preview{grid-column:1/-1}.wf-rule .check{background:#f8fafc;border:1px solid #e2e8f0;border-radius:13px;padding:11px}.wf-preview pre,.wf-template-grid pre{white-space:pre-wrap;background:#0f172a;color:#e2e8f0;border-radius:14px;padding:14px;line-height:1.45}.wf-template-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.wf-badge{display:inline-block;border-radius:999px;padding:5px 9px;margin-left:8px;font-size:12px;font-weight:900}.wf-badge.ok{background:#dcfce7;color:#166534}.wf-badge.warn{background:#fef3c7;color:#92400e}.wf-log{display:grid;gap:9px}.wf-log div{display:grid;grid-template-columns:120px 1fr 1.2fr;gap:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px}.wf-error{background:#fee2e2;color:#991b1b;padding:16px;border-radius:12px}@media(max-width:900px){.wf-shell{grid-template-columns:1fr}.wf-shell aside{height:auto;position:relative}.wf-metrics,.wf-form,.wf-rule form,.wf-template-grid{grid-template-columns:1fr}.wf-log div{grid-template-columns:1fr}}`;
  document.head.append(s);
}

injectStyles();
ensureButton();
window.addEventListener('load', ensureButton);
window.addEventListener('focus', ensureButton);
setInterval(ensureButton, 3500);
