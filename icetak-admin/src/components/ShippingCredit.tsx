import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
type Entry={id:string;kind:string;amount:number;reference:string|null;occurred_at:string;note:string};
type Credit={account:{balance:number|null;provider_balance:number|null;checked_at:string|null;last_error:string|null;alert_status:string|null;alert_error:string|null;started_at:string};monthly:{topup:number;usage:number;refund:number;unclassified:number;unclassified_count:number};entries:Entry[]};
const cash=(v:number|null|undefined)=>v==null?'—':new Intl.NumberFormat('ms-MY',{style:'currency',currency:'MYR'}).format(v);
const time=(v:string|null)=>v?new Intl.DateTimeFormat('ms-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(v)):'Belum disemak';
const kinds:Record<string,string>={opening:'Baki awal',usage:'Caj order',refund:'Refund / caj dipulangkan',unclassified:'Perlu pengesahan',topup:'Topup disahkan',adjustment:'Pelarasan'};
export default function ShippingCredit(){
 const [month,setMonth]=useState(()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit'}).format(new Date()));
 const [data,setData]=useState<Credit|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
 const load=useCallback(async(action='dashboard',extra:Record<string,unknown>={})=>{
  setBusy(true);setError('');
  try{const r=await supabase.functions.invoke('shipping-credit',{body:{action,month,...extra}});if(r.error||r.data?.error)throw new Error(r.data?.error||r.error?.message||'Semakan gagal');setData(r.data as Credit);}catch(e){setError(e instanceof Error?e.message:'Semakan gagal');}finally{setBusy(false);}
 },[month]);
 useEffect(()=>{void load();const t=window.setInterval(()=>void load(),30000);return()=>window.clearInterval(t);},[load]);
 const classify=(entry:Entry,kind:string)=>{const reference=window.prompt('Nombor resit / rujukan penyata untuk pengesahan ini:');if(reference&&reference.trim().length>=3)void load('classify',{id:entry.id,kind,reference});};
 const stale=!!data?.account.checked_at&&Date.now()-new Date(data.account.checked_at).getTime()>15*60000;
 return <section className="panel" style={{marginBottom:18}} aria-label="Kredit ParcelDaily">
  <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><div className="panel-title">Kredit ParcelDaily</div><strong style={{fontSize:30,color:data?.account.balance!=null&&data.account.balance<20?'#dc2626':undefined}}>{cash(data?.account.balance)}</strong><div className="cell-sub">Disahkan API: {cash(data?.account.provider_balance)} · {time(data?.account.checked_at||null)}{stale?' · Baki mungkin belum terkini':''}</div><div className="cell-sub">Caj order direkod terus; baki API disemak setiap 5 minit. Notifikasi admin bila bawah RM20.</div></div><div style={{display:'flex',gap:8,alignItems:'start'}}><button className="btn btn-outline" disabled={busy} onClick={()=>void load('sync')}>{busy?'Memuat…':'Semak baki API'}</button><button className="btn btn-outline" onClick={()=>setOpen(!open)}>{open?'Tutup penyata':'Lihat penyata'}</button></div></div>
  {error&&<p role="alert" style={{color:'#b42318'}}>{error} <button className="btn btn-outline" onClick={()=>void load()}>Cuba semula</button></p>}
  {data?.account.last_error&&<p role="status">Semakan tertunda: {data.account.last_error}</p>}
  {data?.account.alert_status&&<p role="status">Notifikasi kredit: {data.account.alert_status}{data.account.alert_error?` · ${data.account.alert_error}`:''}</p>}
  {open&&<><label>Bulan penyata (Malaysia) <input type="month" value={month} onChange={e=>setMonth(e.target.value)} /></label><div style={{display:'flex',gap:24,flexWrap:'wrap',margin:'16px 0'}}>{[['Topup disahkan',data?.monthly.topup],['Digunakan',data?.monthly.usage],['Refund',data?.monthly.refund],['Belum dikenal pasti',data?.monthly.unclassified]].map(([label,value])=><div key={String(label)}><div className="cell-sub">{label}</div><b>{cash(value as number|undefined)}</b></div>)}</div>
  <p className="cell-sub">Rekod bermula {time(data?.account.started_at||null)}. API tidak menyediakan sejarah amaun topup. Sahkan kredit masuk dengan resit; refund dan pelarasan diasingkan daripada topup. Paparan 200 transaksi terbaru bagi bulan dipilih.</p>
  <div style={{overflowX:'auto'}}><table><thead><tr><th>Masa MYT</th><th>Jenis</th><th>Order / rujukan</th><th>Perubahan kredit</th><th>Pengesahan</th></tr></thead><tbody>{data?.entries.map(e=><tr key={e.id}><td>{time(e.occurred_at)}</td><td>{kinds[e.kind]||e.kind}</td><td>{e.reference||'—'}</td><td style={{fontWeight:700}}>{cash(e.amount)}</td><td>{e.kind==='unclassified'&&<div style={{display:'flex',gap:6}}>{e.amount>0&&<button disabled={busy} className="btn btn-outline btn-sm" onClick={()=>classify(e,'topup')}>Topup</button>}{e.amount>0&&<button disabled={busy} className="btn btn-outline btn-sm" onClick={()=>classify(e,'refund')}>Refund</button>}<button disabled={busy} className="btn btn-outline btn-sm" onClick={()=>classify(e,'adjustment')}>Pelarasan</button></div>}</td></tr>)}</tbody></table>{!data?.entries.length&&<p>Tiada transaksi direkod dalam bulan ini.</p>}</div></>}
 </section>;
}
