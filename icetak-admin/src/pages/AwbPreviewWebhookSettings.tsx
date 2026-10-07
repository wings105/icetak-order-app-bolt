import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AwbPreviewWebhookSettings() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true); setLoaded(false); setError('');
    void supabase.functions.invoke('webhook-forward-settings', {body:{action:'get',kind:'awb_preview'}})
      .then(({data,error:failure}) => {
        if (!active) return;
        if (failure || !data?.ok) throw new Error(data?.error || failure?.message || 'Tetapan gagal dimuat.');
        setUrl(data.url || ''); setLoaded(true);
      })
      .catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : 'Tetapan gagal dimuat.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [reload]);
  async function save() {
    if (busy || !loaded) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const {data,error:failure} = await supabase.functions.invoke('webhook-forward-settings', {body:{action:'save',kind:'awb_preview',url}});
      if (failure || !data?.ok) throw new Error(data?.error || failure?.message || 'Tetapan gagal disimpan.');
      setUrl(data.url || '');
      setNotice(data.url ? 'Webhook disimpan. Refresh halaman preview untuk aktifkan butang.' : 'URL dikosongkan. Butang tindakan preview dimatikan.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Tetapan gagal disimpan.'); }
    finally { setBusy(false); }
  }
  return <section className="panel" aria-label="AWB Preview Actions">
    <div className="panel-header"><div><div className="panel-title">AWB Preview Actions</div><div className="panel-subtitle">Webhook untuk butang pada halaman preview.</div></div></div>
    <div style={{padding:20,display:'grid',gap:10}}>
      <label className="form-field"><span>AWB Preview Action Webhook URL</span><input type="url" placeholder="https://automation.example.com/webhook/..." value={url} disabled={busy || !loaded} onChange={(event)=>{setUrl(event.target.value);setNotice('');}} /></label>
      <div className="cell-sub">1 = AWB/address printed · 2 = Finished product printed · 3 = Complete. Satu POST bagi setiap task.</div>
      <div className="cell-sub">Kosongkan URL dan Save untuk matikan butang tindakan.</div>
      {error && <div role="alert" style={{color:'#b42318'}}>{error}</div>}
      {notice && <div role="status" style={{color:'#027a48'}}>{notice}</div>}
      {!loaded && !busy && <button className="btn btn-outline" onClick={()=>setReload(value=>value+1)}>Cuba muat semula</button>}
      <button className="btn btn-primary" disabled={busy || !loaded} onClick={()=>void save()}>{busy?'Loading…':'Save AWB Webhook URL'}</button>
    </div>
  </section>;
}
