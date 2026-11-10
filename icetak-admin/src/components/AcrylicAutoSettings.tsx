import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

type Job = { task_id: string; state: string; stage: string; last_error: string; updated_at: string };
type Status = { enabled: boolean; ready: boolean; can_manage: boolean; model: string; delay_seconds: number; daily_limit: number; used_today: number; counts: Record<string, number>; recent: Job[] };

export default function AcrylicAutoSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const request = useRef(0);
  const changing = useRef(false);
  const refresh = useCallback(async () => {
    if (changing.current) return;
    const id = ++request.current;
    try {
      const { data, error: failure } = await supabase.rpc('icetak_acrylic_auto_settings');
      if (!alive.current || id !== request.current) return;
      if (failure) throw failure;
      if (!data || typeof data.enabled !== 'boolean') throw new Error('Respons Settings tidak lengkap.');
      setStatus(data as Status); setError('');
    } catch (e) {
      if (alive.current && id === request.current) setError(e instanceof Error ? e.message : 'Tidak dapat membaca tetapan acrylic.');
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => { alive.current = false; ++request.current; window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [refresh]);
  const toggle = async () => {
    if (!status?.can_manage || changing.current || (!status.enabled && !status.ready)) return;
    changing.current = true; ++request.current; setBusy(true); setError('');
    try {
      const { data, error: failure } = await supabase.rpc('icetak_acrylic_auto_settings', { p_enabled: !status.enabled });
      if (failure) throw failure;
      if (!data || typeof data.enabled !== 'boolean') throw new Error('Status belum disahkan. Semak semula sebelum retry.');
      if (alive.current) setStatus(data as Status);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Tetapan tidak dapat disahkan. Refresh status dahulu.');
    } finally { changing.current = false; if (alive.current) { setBusy(false); void refresh(); } }
  };
  const held = (status?.counts.review || 0) + (status?.counts.uncertain || 0);
  return <section className="panel" aria-labelledby="acrylic-auto-title" style={{ gridColumn: '1 / -1' }}>
    <div className="panel-header" style={{ gap: 16, flexWrap: 'wrap' }}>
      <div><div className="panel-title" id="acrylic-auto-title">Auto Generate Acrylic</div><div className="panel-subtitle">AutoBrief confirmed → tunggu 3 minit → queue → OpenAI → QC → attachment ClickUp</div></div>
      <button type="button" className={status?.enabled ? 'btn btn-primary' : 'btn btn-outline'} role="switch" aria-label="Auto Generate Acrylic" aria-checked={status?.enabled ?? false} disabled={busy || !status?.can_manage || (!status.enabled && !status.ready)} onClick={() => void toggle()}>{busy ? 'Menyimpan...' : status ? (status.enabled ? 'ON · Matikan' : 'OFF · Hidupkan') : 'Memuatkan...'}</button>
    </div>
    <div style={{ padding: 20 }}>
      {error && <div role="alert" style={{ marginBottom: 12 }}><b>{error}</b> <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void refresh()}>Semak semula</button></div>}
      {!status && !error && <p role="status">Membaca tetapan sebenar...</p>}
      {status && <>
        {!status.ready && <p role="status"><b>OFF semasa pemasangan dan pengesahan.</b> Butang ON dibuka selepas worker disahkan tersedia.</p>}
        {!status.can_manage && <p className="cell-sub">Owner/admin sahaja boleh ubah tetapan ini.</p>}
        <div className="kv-list">
          <div className="kv-row"><span className="k">Giliran</span><span className="v">{status.counts.queued || 0} menunggu · {held} perlu semakan · {status.counts.completed || 0} siap</span></div>
          <div className="kv-row"><span className="k">Had hari ini (Malaysia)</span><span className="v">{status.used_today} / {status.daily_limit} percubaan image</span></div>
          <div className="kv-row"><span className="k">Model</span><span className="v" style={{ overflowWrap: 'anywhere' }}>{status.model}</span></div>
        </div>
        <p>Hanya task <b>acrylic + Ai Check + confirmed</b>. Mula layak selepas {status.delay_seconds / 60} minit AutoBrief siap, ikut giliran. Maksimum satu task diproses pada satu masa.</p>
        <p className="cell-sub">OpenAI API dicaj berasingan daripada ChatGPT/ClickUp. Had mengira percubaan, bukan jumlah kos. OFF menghentikan langkah baru; request yang sudah dihantar mungkin tetap dicaj. Fail disahkan ada sebelum Review customer ditukar kepada Ai designed gpt.</p>
        {status.recent.length > 0 && <details><summary>Aktiviti terbaru</summary><ul style={{ paddingLeft: 20 }}>{status.recent.map(job => <li key={job.task_id} style={{ marginTop: 12, overflowWrap: 'anywhere' }}><a href={`https://app.clickup.com/t/${job.task_id}`} target="_blank" rel="noopener noreferrer">Buka task</a>: {job.state} / {job.stage}{job.last_error ? ` · ${job.last_error}` : ''}<div className="cell-sub">{new Date(job.updated_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}</div></li>)}</ul></details>}
      </>}
    </div>
  </section>;
}
