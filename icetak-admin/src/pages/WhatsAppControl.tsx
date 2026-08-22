import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconRefresh } from '../components/Icons';

type AnyRow = Record<string, any>;
type Snapshot = { status?: AnyRow; health?: AnyRow; rules?: AnyRow[]; templates?: AnyRow[]; outbox?: AnyRow[] };
type Summary = { pending?: number; processing?: number; failed?: number; sent?: number };
type RuleHealth = { code: 'ready'|'freeform'|'disabled'|'bad'; label: string; detail: string };

const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const PRODUCTION_CUSTOMER_APP_URL = 'https://icetak.bolt.host';
const MANAGED_GATEWAY = 'https://officialapi.wasapflow.com/bridge/v1';
const FIELDS = ['customer_name','phone','order_id','order_token','order_total','date_need','order_link','payment_link','review_link','items_summary','pickup_order_count','payment_status','delivery_method','tracking_number','courier','tracking_link','pickup_location','otp','otp_code','magic_link','expiry_minutes','support_phone'];

const asArray = (value: any): string[] => Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(',').map((x) => x.trim()).filter(Boolean) : [];
const badge = (s: unknown) => { const v = String(s || '').toLowerCase(); if (['sent','delivered','success'].includes(v)) return 'badge-success'; if (['pending','processing','queued','retry'].includes(v)) return 'badge-warning'; if (['failed','error'].includes(v)) return 'badge-error'; return 'badge-neutral'; };
const unsafePreviewUrl = (value: string) => /(localhost|127\.0\.0\.1|0\.0\.0\.0|webcontainer-api\.io|local-credentialless|\.local(?:\/|$)|bolt\.new)/i.test(value);

function metaParamCount(components: unknown) {
  let max = 0;
  for (const component of Array.isArray(components) ? components : []) {
    const text = String((component as AnyRow)?.text || '');
    for (const match of text.matchAll(/\{\{([0-9]+)\}\}/g)) max = Math.max(max, Number(match[1] || 0));
  }
  return max;
}

function ruleHealth(rule: AnyRow, templates: AnyRow[]): RuleHealth {
  if (!rule.enabled) return { code:'disabled', label:'DISABLED', detail:'Notification disabled' };
  if (!rule.template_enabled) return { code:'freeform', label:'FREE-FORM ONLY', detail:'Template after 24H disabled' };
  const template = templates.find((item) => item.name === rule.template_name && item.language === rule.template_language && String(item.status).toUpperCase() === 'APPROVED');
  if (!template) return { code:'bad', label:'MISSING TEMPLATE', detail:`${rule.template_name || 'No template'} (${rule.template_language || 'ms'}) not approved` };
  const mapped = asArray(rule.template_params?.value || rule.template_params).length;
  const expected = metaParamCount(template.components);
  if (mapped !== expected) return { code:'bad', label:'PARAM MISMATCH', detail:`Meta expects ${expected}; mapping has ${mapped}` };
  return { code:'ready', label:'READY', detail:`${template.name} · ${template.language} · ${mapped} params` };
}

export default function WhatsAppControl() {
  const [tab, setTab] = useState<'overview'|'settings'|'rules'|'test'|'queue'>('overview');
  const [data, setData] = useState<Snapshot>({});
  const [summary, setSummary] = useState<Summary>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    const [snapshotRes, summaryRes] = await Promise.all([
      supabase.rpc('icetak_admin_whatsapp_snapshot'),
      supabase.rpc('icetak_admin_notification_summary'),
    ]);
    if (snapshotRes.error) setError(snapshotRes.error.message); else setData((snapshotRes.data || {}) as Snapshot);
    if (!summaryRes.error) setSummary((summaryRes.data || {}) as Summary);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(null), 3500); return () => window.clearTimeout(t); }, [notice]);

  const approved = useMemo(() => (data.templates || []).filter((t) => String(t.status || '').toUpperCase() === 'APPROVED'), [data.templates]);
  const connected = Boolean(data.status?.configured?.partner_key && data.status?.configured?.waba_id);
  const pending = Number(summary.pending || 0) + Number(summary.processing || 0);

  const edge = async (functionName: string, path: string, body?: unknown) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Admin session tamat. Login semula.');
    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  };

  const syncTemplates = async () => {
    setBusy(true); setError(null);
    try { const result = await edge('whatsapp-admin', '/templates/sync', {}); setNotice(`Synced ${result.synced || 0} template.`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const processQueue = async () => {
    setBusy(true); setError(null);
    try {
      const { data: jobs, error: claimError } = await supabase.rpc('icetak_admin_claim_notification_jobs', { p_limit: 8 });
      if (claimError) throw claimError;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Admin session tamat.');
      let processed = 0;
      for (const job of (jobs || []) as AnyRow[]) {
        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ ...(job.payload || {}), queue_id: job.id, idempotency_key: job.idempotency_key, source: 'admin_v2_queue' }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.ok === false) throw new Error(result.error || `WhatsApp send ${response.status}`);
          await supabase.rpc('icetak_admin_finish_notification_job', { p_id: job.id, p_success: true, p_result: result, p_error: null });
        } catch (sendError) {
          await supabase.rpc('icetak_admin_finish_notification_job', { p_id: job.id, p_success: false, p_result: {}, p_error: sendError instanceof Error ? sendError.message : String(sendError) });
        }
        processed += 1;
      }
      setNotice(`Queue processed: ${processed} job.`); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const retry = async (id: string) => {
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('icetak_admin_retry_notification_job', { p_id: id });
    setBusy(false);
    if (rpcError) setError(rpcError.message); else { setNotice('Retry queued.'); await load(); }
  };

  return <div className="fade-in">
    <div className="page-header"><div><div className="page-label">WhatsApp</div><h1 className="page-title">Control Center</h1><p className="page-subtitle">Single V2 control for WasapFlow, rules, health, tests and queue</p></div><button className="btn btn-outline" onClick={() => void load()}><IconRefresh size={16}/> Refresh</button></div>
    <div className="stats-grid"><Stat label="WasapFlow" value={connected ? 'Connected' : 'Need Config'} /><Stat label="Approved Templates" value={String(approved.length)} /><Stat label="Pending Queue" value={String(pending)} /><Stat label="Failed" value={String(summary.failed || 0)} /></div>
    <div className="filter-tabs" style={{ marginBottom: 14 }}>{([['overview','Overview'],['settings','Connection'],['rules','Notification Rules'],['test','Send Test'],['queue','Queue & Logs']] as const).map(([k,l]) => <button key={k} className={`filter-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
    {notice && <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: '#ecfdf3', color: '#067647', fontWeight: 700 }}>{notice}</div>}
    {error && <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: '#fef3f2', color: '#b42318' }}>{error}</div>}
    {loading ? <div className="panel"><div className="loading"><span className="spinner" /></div></div> : <>
      {tab === 'overview' && <Overview data={data} onProcess={() => void processQueue()} onSync={() => void syncTemplates()} busy={busy} />}
      {tab === 'settings' && <SettingsPanel status={data.status || {}} onSaved={async () => { setNotice('WhatsApp settings saved.'); await load(); }} />}
      {tab === 'rules' && <RulesPanel rules={data.rules || []} templates={approved} onSaved={async () => { setNotice('Notification rule saved.'); await load(); }} />}
      {tab === 'test' && <TestPanel rules={data.rules || []} edge={edge} onSent={async (message) => { setNotice(message); await load(); }} />}
      {tab === 'queue' && <QueuePanel data={data} onRetry={(id) => void retry(id)} onProcess={() => void processQueue()} busy={busy} />}
    </>}
  </div>;
}

function Overview({ data, onProcess, onSync, busy }: { data: Snapshot; onProcess: () => void; onSync: () => void; busy: boolean }) {
  const status = data.status || {};
  const health = data.health || {};
  const invalid = Array.isArray(health.invalid_rules) ? health.invalid_rules.length : 0;
  return <div style={{ display:'grid', gap:14 }}>
    <div className="panel"><div className="panel-header"><div><div className="panel-title">Production Health</div><div className="panel-subtitle">Live backend, triggers, queue and template validation</div></div><span className={`badge ${health.overall_ready ? 'badge-success':'badge-error'}`}>{health.overall_ready ? 'PRODUCTION READY':'ACTION NEEDED'}</span></div><div style={{padding:18,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}><Health label="Connection" value={health.connected ? 'OK':'FAIL'} ok={Boolean(health.connected)}/><Health label="Dispatcher" value={health.dispatcher_ready ? 'OK':'FAIL'} ok={Boolean(health.dispatcher_ready)}/><Health label="Event Triggers" value={`${health.trigger_count || 0}/${health.expected_trigger_count || 7}`} ok={Number(health.trigger_count||0)>=Number(health.expected_trigger_count||7)}/><Health label="Valid Rules" value={String(health.valid_rules || 0)} ok={invalid===0}/><Health label="Invalid Rules" value={String(invalid)} ok={invalid===0}/><Health label="Failed Queue" value={String(health.failed || 0)} ok={Number(health.failed||0)===0}/></div></div>
    <div className="grid-2"><div className="panel"><div className="panel-header"><div className="panel-title">Architecture</div></div><div style={{ padding: 20 }}><p>WasapFlow inbound → Unified Inbox 24H → notification queue → free-form / approved Meta template.</p><div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap:'wrap' }}><button className="btn btn-primary" disabled={busy} onClick={onProcess}>Process Queue Now</button><button className="btn btn-outline" disabled={busy} onClick={onSync}>Sync Meta Templates</button></div></div></div><div className="panel"><div className="panel-header"><div className="panel-title">Connection</div></div><div style={{ padding: 20 }}><div className="kv-list"><KV k="Enabled" v={status.enabled === false ? 'OFF' : 'ON'} /><KV k="Base URL" v={status.base_url || MANAGED_GATEWAY} /><KV k="WABA ID" v={status.waba_id || (status.configured?.waba_id ? 'Configured' : 'Missing')} /><KV k="Partner Key" v={status.configured?.partner_key ? 'Configured' : 'Missing'} /><KV k="Default Language" v={status.default_language || 'ms'} /><KV k="Customer App" v={status.customer_app_base_url || PRODUCTION_CUSTOMER_APP_URL}/></div></div></div></div>
  </div>;
}

function SettingsPanel({ status, onSaved }: { status: AnyRow; onSaved: () => Promise<void> }) {
  const existingCustomerUrl=String(status.customer_app_base_url || '');
  const safeCustomerUrl=!existingCustomerUrl || unsafePreviewUrl(existingCustomerUrl) ? PRODUCTION_CUSTOMER_APP_URL : existingCustomerUrl;
  const [form, setForm] = useState({ enabled: status.enabled !== false, base_url: MANAGED_GATEWAY, partner_key: '', waba_id: status.waba_id || '', default_language: status.default_language || 'ms', customer_app_base_url: safeCustomerUrl, unified_inbox_24h_url: status.unified_inbox_24h_url || '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const customerUrl=form.customer_app_base_url.trim();
    if(!customerUrl.startsWith('https://') || unsafePreviewUrl(customerUrl)) { setForm({...form,customer_app_base_url:PRODUCTION_CUSTOMER_APP_URL}); return setError('Customer App URL mesti URL production HTTPS. Preview/local URL tidak dibenarkan.'); }
    setBusy(true);
    const payload: AnyRow = { ...form, base_url:MANAGED_GATEWAY, enabled: String(form.enabled) };
    if (!form.partner_key.trim()) delete payload.partner_key;
    const { error: rpcError } = await supabase.rpc('icetak_admin_whatsapp_save_settings', { p_payload: payload });
    setBusy(false); if (rpcError) setError(rpcError.message); else await onSaved();
  };
  return <div className="panel" style={{ maxWidth: 900 }}><div className="panel-header"><div><div className="panel-title">Connection Settings</div><div className="panel-subtitle">Gateway dikunci. Customer App URL mesti production HTTPS. Secret kosong = kekalkan credential lama.</div></div></div><div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>{error && <div style={{ color: '#b42318', gridColumn:'1/-1' }}>{error}</div>}<Field label="Enable notification"><select value={form.enabled ? 'true':'false'} onChange={(e) => setForm({ ...form, enabled: e.target.value === 'true' })}><option value="true">Enabled</option><option value="false">Disabled</option></select></Field><Field label="WasapFlow Base URL · Managed 🔒"><input readOnly value={form.base_url} style={{background:'#f1f5f9'}} /></Field><Field label="Partner Key"><input type="password" value={form.partner_key} onChange={(e) => setForm({ ...form, partner_key: e.target.value })} placeholder={status.configured?.partner_key ? 'Configured — leave blank to keep' : 'Partner key'}/></Field><Field label="WABA ID"><input value={form.waba_id} onChange={(e) => setForm({ ...form, waba_id: e.target.value })}/></Field><Field label="Language"><input value={form.default_language} onChange={(e) => setForm({ ...form, default_language: e.target.value })}/></Field><Field label="Customer App URL · Production only"><input value={form.customer_app_base_url} onChange={(e) => setForm({ ...form, customer_app_base_url: e.target.value })} placeholder={PRODUCTION_CUSTOMER_APP_URL}/></Field><Field label="Unified Inbox 24H URL"><input value={form.unified_inbox_24h_url} onChange={(e) => setForm({ ...form, unified_inbox_24h_url: e.target.value })}/></Field><div><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving...' : 'Save Settings'}</button></div></div></div>;
}

function RulesPanel({ rules, templates, onSaved }: { rules: AnyRow[]; templates: AnyRow[]; onSaved: () => Promise<void> }) {
  return <div style={{ display: 'grid', gap: 12 }}>{rules.map((rule) => <RuleCard key={rule.event_type} rule={rule} templates={templates} onSaved={onSaved} />)}</div>;
}

function RuleCard({ rule, templates, onSaved }: { rule: AnyRow; templates: AnyRow[]; onSaved: () => Promise<void> }) {
  const state=ruleHealth(rule,templates);
  const [form, setForm] = useState({ enabled: Boolean(rule.enabled), freeform_enabled: Boolean(rule.freeform_enabled), template_enabled: Boolean(rule.template_enabled), freeform_text: String(rule.freeform_text || ''), template_name: String(rule.template_name || ''), template_language: String(rule.template_language || 'ms'), template_params: asArray(rule.template_params?.value || rule.template_params).join(', ') });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const save = async () => { setBusy(true); setError(null); const payload = { event_type: rule.event_type, enabled: form.enabled, freeform_enabled: form.freeform_enabled, template_enabled: form.template_enabled, freeform_text: form.freeform_text, template_name: form.template_name, template_language: form.template_language, template_params: asArray(form.template_params), available_fields: FIELDS }; const { error: rpcError } = await supabase.rpc('icetak_admin_whatsapp_save_rule', { p_payload: payload }); setBusy(false); if (rpcError) setError(rpcError.message); else await onSaved(); };
  return <details className="panel"><summary style={{ cursor: 'pointer', padding: 16, fontWeight: 800,display:'flex',gap:8,alignItems:'center' }}><span>{rule.label || rule.event_type} · {form.enabled ? 'Enabled' : 'Disabled'}</span><span className={`badge ${state.code==='ready'?'badge-success':state.code==='bad'?'badge-error':state.code==='freeform'?'badge-warning':'badge-neutral'}`} style={{marginLeft:'auto'}} title={state.detail}>{state.label}</span></summary><div style={{ padding: '0 18px 18px', display: 'grid', gap: 10 }}>{error && <div style={{ color:'#b42318' }}>{error}</div>}<div className="cell-sub">{state.detail}</div><label><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled:e.target.checked })}/> Enable notification</label><label><input type="checkbox" checked={form.freeform_enabled} onChange={(e) => setForm({ ...form, freeform_enabled:e.target.checked })}/> Free-form when 24H open</label><label><input type="checkbox" checked={form.template_enabled} onChange={(e) => setForm({ ...form, template_enabled:e.target.checked })}/> Template after 24H</label><Field label="Free-form message"><textarea rows={5} value={form.freeform_text} onChange={(e) => setForm({ ...form, freeform_text:e.target.value })}/></Field><Field label="Approved template"><select value={form.template_name} onChange={(e) => setForm({ ...form, template_name:e.target.value })}><option value="">Select...</option>{templates.map((t) => <option key={`${t.name}-${t.language}`} value={t.name}>{t.name} ({t.language || 'ms'})</option>)}</select></Field><Field label="Language"><input value={form.template_language} onChange={(e) => setForm({ ...form, template_language:e.target.value })}/></Field><Field label="Template params"><input value={form.template_params} onChange={(e) => setForm({ ...form, template_params:e.target.value })}/></Field><div><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving...' : 'Save Rule'}</button></div></div></details>;
}

function TestPanel({ rules, edge, onSent }: { rules: AnyRow[]; edge: (fn:string,path:string,body?:unknown)=>Promise<any>; onSent:(message:string)=>Promise<void> }) {
  const [phone, setPhone] = useState(''); const [eventType, setEventType] = useState(String(rules[0]?.event_type || 'order_created')); const [mode, setMode] = useState('auto'); const [busy, setBusy] = useState(false); const [error,setError]=useState<string|null>(null);
  const send = async () => { setBusy(true); setError(null); try { const vars = { customer_name:'Test Customer', order_id:'IC-TEST', order_total:'RM1', date_need:'Today', order_link:PRODUCTION_CUSTOMER_APP_URL, payment_link:`${PRODUCTION_CUSTOMER_APP_URL}/?page=payment`, review_link:PRODUCTION_CUSTOMER_APP_URL, tracking_number:'MY123456789', courier:'SPX', tracking_link:'https://spx.com.my/track?MY123456789', pickup_location:'Bandar Baru Pasir Puteh', support_phone:'60179860656' }; const payload:AnyRow={ phone, event_type:eventType, vars, source:'admin_v2_test' }; if(mode!=='auto') payload.mode=mode; const result=await edge('whatsapp-send','',payload); await onSent(`Test accepted via ${result.mode || mode}: ${result.message_id || 'OK'}`); } catch(e){setError(e instanceof Error?e.message:String(e));} setBusy(false); };
  return <div className="panel" style={{ maxWidth:700 }}><div className="panel-header"><div className="panel-title">Send Test</div></div><div style={{padding:20,display:'grid',gap:10}}>{error&&<div style={{color:'#b42318'}}>{error}</div>}<Field label="Phone"><input value={phone} onChange={(e)=>setPhone(e.target.value)} placeholder="6012..."/></Field><Field label="Event"><select value={eventType} onChange={(e)=>setEventType(e.target.value)}>{rules.map((r)=><option key={r.event_type} value={r.event_type}>{r.label||r.event_type}</option>)}</select></Field><Field label="Mode"><select value={mode} onChange={(e)=>setMode(e.target.value)}><option value="auto">Auto</option><option value="freeform">Free-form</option><option value="template">Template</option></select></Field><button className="btn btn-primary" disabled={busy||!phone.trim()} onClick={()=>void send()}>{busy?'Sending...':'Send Test'}</button></div></div>;
}

function QueuePanel({ data, onRetry, onProcess, busy }: { data: Snapshot; onRetry:(id:string)=>void; onProcess:()=>void; busy:boolean }) {
  const outbox = data.outbox || [];
  const [filter,setFilter]=useState('all');
  const filtered=outbox.filter((row)=>{if(filter==='all')return true;const text=`${row.status||''} ${row.mode||''} ${row.message_type||''}`.toLowerCase();return text.includes(filter);});
  return <div className="panel"><div className="panel-header" style={{gap:8,flexWrap:'wrap'}}><div><div className="panel-title">Queue & Logs</div><div className="panel-subtitle">Recent notification jobs / provider result</div></div><select style={{marginLeft:'auto'}} value={filter} onChange={(e)=>setFilter(e.target.value)}><option value="all">All logs</option><option value="sent">Sent only</option><option value="failed">Failed only</option><option value="template">Template only</option><option value="text">Free-form only</option></select><button className="btn btn-primary" disabled={busy} onClick={onProcess}>Process Queue</button></div><div className="table-wrap"><table><thead><tr><th>Event</th><th>Customer</th><th>Status</th><th>Mode</th><th>Created</th><th>Action</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td>{row.event_type || 'manual'}</td><td>{row.customer_name || row.phone || '—'}<div className="cell-sub">{row.phone}</div></td><td><span className={`badge ${badge(row.status)}`}>{row.status || '—'}</span>{(row.error_message||row.last_error)&&<div style={{color:'#b42318',fontSize:11}}>{row.error_message||row.last_error}</div>}</td><td>{row.mode || row.message_type || '—'}</td><td className="cell-sub">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td><td>{['failed','error','retry'].includes(String(row.status||'').toLowerCase()) && <button className="btn btn-outline" onClick={()=>onRetry(row.id)}>Retry</button>}</td></tr>)}</tbody></table></div></div>;
}

function Health({label,value,ok}:{label:string;value:string;ok:boolean}){return <div style={{padding:11,border:'1px solid var(--border-light)',borderRadius:12,background:'#f8fafc'}}><b style={{display:'block',color:ok?'#15803d':'#b91c1c'}}>{value}</b><span className="cell-sub">{label}</span></div>;}
function Stat({ label, value }: { label:string; value:string }) { return <div className="stat-card new"><div className="stat-label">{label}</div><div className="stat-value" style={{fontSize:value.length>10?18:28}}>{value}</div></div>; }
function KV({k,v}:{k:string;v:unknown}) { return <div className="kv-row"><span className="k">{k}</span><span className="v">{String(v ?? '—')}</span></div>; }
function Field({label,children}:{label:string;children:React.ReactNode}) { return <label className="form-field"><span>{label}</span>{children}</label>; }
