import { useEffect, useState } from 'react';
import { costNumber, money, request, stateLabels, type ContributionRow } from '../lib/contribution';
import './Contribution.css';

type Props={orderId:string;canManage:boolean;onSaved?:()=>void};
export default function DirectContribution({orderId,canManage,onSaved}:Props){
 const [row,setRow]=useState<ContributionRow|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[tick,setTick]=useState(0);
 const [material,setMaterial]=useState(''),[courier,setCourier]=useState(''),[extras,setExtras]=useState('0'),[note,setNote]=useState('');
 const [ma,setMa]=useState(false),[ca,setCa]=useState(false),[ea,setEa]=useState(false);
 const install=(r:ContributionRow)=>{setRow(r);setMaterial(r.material_override==null?'':String(r.material_override));setCourier(r.courier_override==null?'':String(r.courier_override));setExtras(String(r.extras));setNote(r.note||'');setMa(!!r.material_actual);setCa(!!r.courier_actual);setEa(!!r.extras_actual)};
 useEffect(()=>{let active=true;setRow(null);setError('');setNotice('');void request<ContributionRow>({action:'contribution_detail',order_id:orderId}).then(r=>{if(active)install(r)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[orderId,tick]);
 const save=async()=>{if(!row)return;setBusy(true);setError('');setNotice('');try{const r=await request<ContributionRow>({action:'direct_costs_save',order_id:orderId,version:row.version,signature:row.signature,costs:{material:costNumber(material,true),courier:costNumber(courier,true),extras:costNumber(extras),material_actual:ma&&material.trim()!=='',courier_actual:ca&&courier.trim()!=='',extras_actual:ea,note}});install(r);setNotice('Kos disimpan. Target akan guna kiraan terkini.');onSaved?.()}catch(e){setError(e instanceof Error?e.message:'Gagal simpan kos')}finally{setBusy(false)}};
 return <section className="ct-direct"><div className="ct-heading"><div><h3>Margin direct</h3><p>Customer bayar − courier − modal − kos tambahan</p></div><button className="btn btn-outline btn-sm" disabled={busy} onClick={()=>setTick(t=>t+1)}>Muat semula</button></div>
 {error&&<p className="ct-warning" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {!row&&!error&&<p>Memuatkan pecahan kos…</p>}{row&&<>
  <dl className="ct-breakdown">{[['Nilai barang',row.sales],['Postage customer',row.shipping_charged],['Customer bayar',row.customer_paid],['Fee platform',0],['Courier',row.courier],['Modal bahan',row.material],['Kos tambahan',row.extras],['Sumbangan sebelum overhead',row.contribution]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{money(value as number|null)}</dd></div>)}</dl>
  <p className="ct-muted">{stateLabels[row.state]} · Margin {row.margin==null?'—':`${row.margin.toFixed(2)}%`} · Courier {row.courier_state==='actual'?'sebenar':'anggaran'}. {row.income_state==='paid_status_only'?'Bayaran berdasarkan status Paid; tiada transaksi direkod.':''}</p>
  {row.reasons.length>0&&<p className="ct-warning">{row.reasons.join(' · ')}</p>}
  <details><summary>Modal setiap item</summary><div className="ct-breakdown">{row.lines?.map((l,i)=><div key={i}><span>{l.qty}× {l.title} · {l.category||'Kategori belum dikenal'}</span><b>{money(l.material)}</b></div>)}</div></details>
  {canManage&&<form onSubmit={e=>{e.preventDefault();void save()}}><p className="ct-muted">Modal ikut tetapan ketika order dibuat. Courier guna caj AWB sebenar apabila ada, kemudian quotation, kemudian postage order. Kos kosong guna kiraan automatik; courier sebenar manual mengatasi AWB.</p>
   <div className="ct-cost-fields">{[{label:'Modal manual (RM)',v:material,set:setMaterial,actual:ma,setActual:setMa},{label:'Courier manual (RM)',v:courier,set:setCourier,actual:ca,setActual:setCa},{label:'Kos tambahan (RM)',v:extras,set:setExtras,actual:ea,setActual:setEa}].map(f=><div key={f.label}><label>{f.label}<input type="number" min="0" max="1000000" step="0.01" disabled={busy} value={f.v} placeholder="Automatik" onChange={e=>{f.set(e.target.value);f.setActual(false);setNotice('')}}/></label><label className="ct-check"><input type="checkbox" disabled={busy||!f.v.trim()} checked={f.actual} onChange={e=>f.setActual(e.target.checked)}/>Disahkan sebenar</label></div>)}</div>
   <label className="ct-note">Catatan kos<textarea maxLength={2000} disabled={busy} value={note} onChange={e=>setNote(e.target.value)}/></label><button className="btn btn-primary" disabled={busy}>{busy?'Menyimpan…':'Simpan kos direct'}</button>
  </form>}
 </>}
 </section>;
}
