import { useState } from 'react';
import { supabase } from '../lib/supabase';

 type Props = { permissions?: string[] };

export default function Settings({ permissions = [] }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canExport = permissions.includes('export_data');

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
      download(`icetak-orders-${stamp}.csv`,['Order ID,Created,Date Need,Total,Payment,Delivery,Status,Admin Status',...rows].join('\n'),'text/csv');
    }
  };

  const signOut = async () => { await supabase.auth.signOut(); window.location.assign(window.location.pathname); };

  return <div className="fade-in">
    <div className="page-header"><div><h1 className="page-title">Settings</h1><p className="page-subtitle">Real system tools only — demo V2 settings removed</p></div></div>
    {error&&<div style={{marginBottom:12,padding:10,borderRadius:10,background:'#fef3f2',color:'#b42318'}}>{error}</div>}
    <div className="grid-2" style={{alignItems:'start'}}>
      <div className="panel"><div className="panel-header"><div><div className="panel-title">Data Export</div><div className="panel-subtitle">Replacement for V1 admin export.</div></div></div><div style={{padding:20}}>{canExport?<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-primary" disabled={busy} onClick={()=>void exportData('json')}>Download JSON Backup</button><button className="btn btn-outline" disabled={busy} onClick={()=>void exportData('csv')}>Download Orders CSV</button></div>:<div className="cell-sub">Permission export_data diperlukan.</div>}</div></div>
      <div className="panel"><div className="panel-header"><div><div className="panel-title">System ownership</div><div className="panel-subtitle">Admin frontend selepas migration</div></div></div><div style={{padding:20}}><div className="kv-list"><div className="kv-row"><span className="k">Admin UI</span><span className="v">React Admin V2</span></div><div className="kv-row"><span className="k">Database / actions</span><span className="v">Supabase RPC + Edge Functions</span></div><div className="kv-row"><span className="k">Legacy V1</span><span className="v">Retiring after parity QA</span></div></div></div></div>
      <div className="panel"><div className="panel-header"><div><div className="panel-title">WhatsApp & integrations</div><div className="panel-subtitle">Configuration moved to dedicated pages.</div></div></div><div style={{padding:20}}><p>WhatsApp rules, credentials and queue are managed in <b>WhatsApp → Control Center</b>. Provider values remain in Supabase/Integrations.</p></div></div>
      <div className="panel"><div className="panel-header"><div className="panel-title">Session</div></div><div style={{padding:20}}><button className="btn btn-outline" onClick={()=>void signOut()}>Log Out Admin</button></div></div>
    </div>
  </div>;
}
