import { useEffect, useState } from 'react';
import { malaysiaDate, money, request, type ContributionReport } from '../lib/contribution';
import './Contribution.css';

export function TargetNumbers({data}:{data:ContributionReport}){
 const s=data.summary,pct=s.goal>0?Math.max(0,Math.min(s.known/s.goal*100,100)):100;
 const current=data.month.slice(0,7)===data.today.slice(0,7);
 return <>
  <div className="ct-metrics">
   <div className="ct-primary"><span>Terkumpul selepas kos</span><strong>{money(s.known)}</strong><small>Target {money(s.goal)} · {data.month.slice(0,7)}</small></div>
   <div><span>Baki untuk dikejar</span><strong>{money(s.remaining)}</strong><small>{s.remaining===0?'Target dicapai':`${s.remaining_days} hari kerja berbaki${current?' termasuk hari ini jika bekerja':''}`}</small></div>
   <div><span>{current?'Sumbangan hari ini':'Sumbangan sebenar'}</span><strong>{money(current?s.today:s.actual)}</strong><small>{current?'Order bertarikh hari ini, selepas kos':'Duit dan kos telah disahkan'}</small></div>
   <div><span>{current?(s.is_workday?'Perlu kumpul hari ini':'Perlu setiap hari kerja berikut'):'Sasaran asal / hari kerja'}</span><strong>{money(current?s.daily_target:s.daily_base)}</strong><small>{current&&s.is_workday?`Lagi ${money(s.daily_gap)} hari ini`:current?'Hari ini bukan hari kerja':`${s.workdays} hari kerja dalam bulan`}</small></div>
  </div>
  <div className="ct-progress" role="progressbar" aria-label="Progress target bulanan" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{width:`${pct}%`}}/></div>
  <div className="ct-foot"><span>{pct.toFixed(1)}% · Sebenar {money(s.actual)} + Anggaran {money(s.estimated)}</span><span>Selepas overhead: {money(s.after_overhead)}</span></div>
  {s.missing>0&&<p className="ct-warning">{s.missing} order belum lengkap / perlu semakan dan belum menambah angka terkumpul. Baki target berdasarkan kos yang diketahui.</p>}
 </>;
}
export default function ContributionTarget({onOpen,refreshKey}:{onOpen:()=>void;refreshKey?:string}){
 const [data,setData]=useState<ContributionReport|null>(null),[error,setError]=useState(''),[tick,setTick]=useState(0),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setLoading(true);setError('');void request<ContributionReport>({action:'contribution_report',month:`${malaysiaDate().slice(0,7)}-01`}).then(r=>{if(active)setData(r)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[tick,refreshKey]);
 return <section className="ct-panel" aria-label="Target dan baki bulanan"><div className="ct-heading"><div><h2>Target & Baki</h2><p>Margin Shopee + direct untuk cover overhead bulan ini</p></div><div><button className="btn btn-outline btn-sm" disabled={loading} onClick={()=>setTick(t=>t+1)}>{loading?'Memuatkan…':'↻'}</button><button className="btn btn-primary btn-sm" onClick={onOpen}>Detail target & margin</button></div></div>
 {error&&<p className="ct-warning" role="alert">Gagal muat target: {error}{data?' · Angka di bawah daripada bacaan sebelumnya.':''}</p>}
 {data?<TargetNumbers data={data}/>:!error&&<p className="ct-muted">Memuatkan data margin…</p>}
 {data&&<small className="ct-muted">Bacaan {new Date(data.fetched_at).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'})} · Anggaran release belum menjadi tunai di bank.</small>}
 </section>;
}
