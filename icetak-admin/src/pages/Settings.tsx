import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

 type Props = { permissions?: string[]; onOpenAiLearning?: () => void };

export default function Settings({ permissions = [], onOpenAiLearning }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canExport = permissions.includes('export_data');
  const canManageMonitor = permissions.includes('manage_admins');
  const [monitor, setMonitor] = useState<{enabled:boolean;delay_minutes:number;open_alerts:number;updated_at?:string}|null>(null);
  const [monitorBusy, setMonitorBusy] = useState(false);
  const [forwardUrl, setForwardUrl] = useState('');
  const [forwardBusy, setForwardBusy] = useState(false);
  const [forwardLoaded, setForwardLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const callForwardSettings = async (action: 'get'|'save', url?: string) => {
    const { data, error: functionError } = await supabase.functions.invoke('webhook-forward-settings', {
      body: { action, url },
    });
    if (functionError) throw functionError;
    if (!data?.ok) throw new Error(data?.error || 'Webhook setting gagal diproses.');
    return data as {ok:boolean;url?:string};
  };

  const loadMonitor = async () => {
    if (!canManageMonitor) return;
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_payment_order_attention_settings');
    if (rpcError) return setError(rpcError.message);
    setMonitor(data as {enabled:boolean;delay_minutes:number;open_alerts:number;updated_at?:string});
  };
  useEffect(() => { void loadMonitor(); }, [canManageMonitor]);
  useEffect(() => {
    if (!canManageMonitor) return;
    let active = true;
    setForwardBusy(true);
    void callForwardSettings('get')
      .then((data) => { if (active) setForwardUrl(data.url || ''); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Webhook setting gagal dimuatkan.'); })
      .finally(() => { if (active) { setForwardBusy(false); setForwardLoaded(true); } });
    return () => { active = false; };
  }, [canManageMonitor]);

  const saveForwardUrl = async () => {
    setForwardBusy(true); setError(null); setNotice(null);
    try {
      const data = await callForwardSettings('save', forwardUrl);
      setForwardUrl(data.url || '');
      setNotice(data.url ? 'External raw webhook URL disimpan.' : 'External raw webhook forwarding dimatikan.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Webhook setting gagal disimpan.');
    } finally { setForwardBusy(false); }
  };
  const setMonitorEnabled = async (enabled:boolean) => {
    setMonitorBusy(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_set_payment_order_attention_enabled',{p_enabled:enabled});
    setMonitorBusy(false);
    if (rpcError) return setError(rpcError.message);
    setMonitor(data as {enabled:boolean;delay_minutes:number;open_alerts:number;updated_at?:string});
  };

  const download = (name:string, content:string, type:string) => {
    const url=URL.createObjectURL(new Blob([content],{type}));
    const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
  };

  const exportData = async (format:'json'|'csv') => {
    setBusy(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_export_data');
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    const payload=(data||{}) as {orders?:Array<Record<string,unknown>>};
    const stamp=new Date().toISOString().slice(0,10);
    if(format==='json') download(`icetak-backup-${stamp}.json`,JSON.stringify(data,null,2),'application/json');
    else {
      const rows=(payload.orders||[]).map((o)=>[o.order_id||o.order_no,o.created_at,o.date_need,o.total,o.payment||o.payment_status,o.delivery||o.delivery_method,o.status,o.admin_status].map((v)=>`"${String(v??'').replaceAll('"','""')}"`).join(','));
      download(`icetak-orders-${stamp}.csv`,['Order ID,Created,Date,Total,Payment,Delivery,Status,Admin Status',...rows].join('\n'),'text/csv');
    }
  };

  const signOut = async () => { await supabase.auth.signOut(); window.location.assign(window.location.pathname); };

  return <div className="fade-in">
    <div className="page-header"><div><h1 className="page-title">Settings</h1><p className="page-subtitle">Real system tools only — demo V2 settings removed</p></div></div>
    {error&&<div style={{marginBottom:12,padding:10,borderRadius:10,background:'#fef3f2',color:'#b42318'}}>{error}</div>}
    {notice&&<div style={{marginBottom:12,padding:10,borderRadius:10,background:'#ecfdf3',color:'#027a48'}}>{notice}</div>}
    <div className="grid-2" style={{alignItems:'start'}}>
      <div className="panel"><div className="panel-header"><div><div className="panel-title">Data Export</div><div className="panel-subtitle">Replacement for V1 admin export.</div></div></div><div style={{padding:20}}>{canExport?<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-primary" disabled={busy} onClick={()=>void exportData('json')}>Download JSON Backup</button><button className="btn btn-outline" disabled={busy} onClick={()=>void exportData('csv')}>Download Orders CSV</button></div>:<div className="cell-sub">Permission export_data diperlukan.</div>}</div></div>
      <div className="panel"><div className="panel-header"><div><div className="panel-title">System ownership</div><div className="panel-subtitle">Admin frontend selepas migration</div></div></div><div style={{padding:20}}><div className="kv-list"><div className="kv-row"><span className="k">Admin UI</span><span className="v">React Admin V2</span></div><div className="kv-row"><span className="k">Database / actions</span><span className="v">Supabase RPC + Edge Functions</span></div><div className="kv-row"><span className="k">Legacy V1</span><span className="v">Retiring after parity QA</span></div></div></div></div>
      <div className="panel"><div className="panel-header"><div><div className="panel-title">WhatsApp & integrations</div><div className="panel-subtitle">Configuration moved to dedicated pages.</div></div></div><div style={{padding:20}}><p>WhatsApp rules, credentials and queue are managed in <b>WhatsApp → Control Center</b>. Provider values remain in Supabase/Integrations.</p></div></div>
      {canManageMonitor&&<div className="panel"><div className="panel-header"><div><div className="panel-title">WasapFlow Raw Webhook Forward</div><div className="panel-subtitle">Forward salinan payload mentah ke automation luar tanpa mengganggu proses order.</div></div></div><div style={{padding:20,display:'grid',gap:10}}><label className="form-field"><span>External webhook URL</span><input type="url" placeholder="https://automation.example.com/webhook/..." value={forwardUrl} disabled={forwardBusy} onChange={(event)=>setForwardUrl(event.target.value)} /></label><div className="cell-sub">POST JSON tanpa custom header. Kosongkan URL dan Save untuk matikan forwarding.</div><button className="btn btn-primary" disabled={forwardBusy||!forwardLoaded} onClick={()=>void saveForwardUrl()}>{forwardBusy?'Saving…':'Save Webhook URL'}</button></div></div>}
      {canManageMonitor&&<div className="panel"><div className="panel-header"><div><div className="panel-title">Matched Payment Monitor</div><div className="panel-subtitle">Pantau QRPay customer checkout yang sudah matched tetapi belum ada real order.</div></div></div><div style={{padding:20,display:'grid',gap:12}}>{monitor?<><div className="kv-list"><div className="kv-row"><span className="k">Monitor</span><span className="v">{monitor.enabled?'ON':'OFF'}</span></div><div className="kv-row"><span className="k">Semakan bermula</span><span className="v">{monitor.delay_minutes} minit selepas payment</span></div><div className="kv-row"><span className="k">Belum ditutup</span><span className="v">{monitor.open_alerts}</span></div></div><div className="cell-sub">Alert kekal sampai order berjaya dicipta/linked atau admin pilih Ignore. OFF hentikan alert baharu dan penghantaran WhatsApp.</div><button className={`btn ${monitor.enabled?'btn-outline':'btn-primary'}`} disabled={monitorBusy} onClick={()=>void setMonitorEnabled(!monitor.enabled)}>{monitorBusy?'Saving…':`Monitor: ${monitor.enabled?'ON — Turn OFF':'OFF — Turn ON'}`}</button></>:<div className="cell-sub">Loading monitor setting…</div>}</div></div>}
      {(permissions.includes('view_finance') || permissions.includes('manage_admins')) && <div className="panel"><div className="panel-header"><div><div className="panel-title">AI Draft Learning</div><div className="panel-subtitle">Weekly rule update, correction history, lock and rollback.</div></div></div><div style={{padding:20}}><button className="btn btn-primary" onClick={onOpenAiLearning}>Open AI Learning Control Center</button></div></div>}
      <div className="panel"><div className="panel-header"><div className="panel-title">Session</div></div><div style={{padding:20}}><button className="btn btn-outline" onClick={()=>void signOut()}>Log Out Admin</button></div></div>
    </div>
  </div>;
}
