import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { costNumber, malaysiaDate, money, request, stateLabels, type ContributionReport, type ContributionRow, type TargetSettings } from '../lib/contribution';
import { TargetNumbers } from '../components/ContributionTarget';
import MoneyBreakdown from '../components/MoneyBreakdown';
import DirectContribution from '../components/DirectContribution';
import OrderProfitDetail from '../components/OrderProfitDetail';
import '../components/Contribution.css';

const dayNames=['Ahad','Isnin','Selasa','Rabu','Khamis','Jumaat','Sabtu'];
function TargetSettingsForm({settings,onSaved}:{settings:TargetSettings;onSaved:()=>void}){
 const [overhead,setOverhead]=useState(String(settings.overhead)),[income,setIncome]=useState(String(settings.owner_income)),[days,setDays]=useState(settings.workdays),[holidays,setHolidays]=useState(settings.holidays.join('\n'));
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const save=async()=>{setError('');setBusy(true);try{const dates=holidays.split(/[\s,]+/).filter(Boolean);if(!days.length)throw new Error('Pilih sekurang-kurangnya satu hari kerja.');if(dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)))throw new Error('Isi tarikh cuti YYYY-MM-DD, satu setiap baris.');await request({action:'contribution_settings_save',version:settings.version,settings:{overhead:costNumber(overhead),owner_income:costNumber(income),workdays:days,holidays:dates}});onSaved()}catch(e){setError(e instanceof Error?e.message:'Tetapan gagal disimpan')}finally{setBusy(false)}};
 return <form className="ct-settings" onSubmit={e=>{e.preventDefault();void save()}}>
  <div className="ct-cost-fields"><label>Overhead bulanan (RM)<input type="number" min="0" max="1000000" step="0.01" value={overhead} disabled={busy} onChange={e=>setOverhead(e.target.value)}/></label><label>Pendapatan owner (RM, pilihan)<input type="number" min="0" max="1000000" step="0.01" value={income} disabled={busy} onChange={e=>setIncome(e.target.value)}/></label></div>
  <fieldset disabled={busy}><legend>Hari kerja</legend><div className="ct-days">{dayNames.map((d,i)=><label key={d}><input type="checkbox" checked={days.includes(i)} onChange={e=>setDays(ds=>e.target.checked?[...ds,i]:ds.filter(v=>v!==i))}/>{d}</label>)}</div></fieldset>
  <label className="ct-note">Tarikh cuti (YYYY-MM-DD, satu setiap baris)<textarea rows={3} value={holidays} disabled={busy} placeholder="2026-10-20" onChange={e=>setHolidays(e.target.value)}/></label>
  <p className="ct-muted">Tetapan ini digunakan untuk semua bulan yang dipilih. Modal produk kekal mengikut versi asal order.</p>
  {error&&<p className="ct-warning" role="alert">{error}</p>}<button className="btn btn-primary" disabled={busy}>{busy?'Menyimpan…':'Simpan target'}</button>
 </form>;
}
function DirectDialog({row,canManage,onClose,onSaved,onOpenOrder}:{row:ContributionRow;canManage:boolean;onClose:()=>void;onSaved:()=>void;onOpenOrder?: (reference:string)=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const el=dialog.current,previous=document.activeElement as HTMLElement|null;el?.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{el?.close();document.body.style.overflow=overflow;previous?.focus()}},[]);
 return createPortal(<dialog className="ct-dialog" ref={dialog} onCancel={onClose} aria-label={`Margin ${row.reference}`}><header className="ct-heading"><div><h2>{row.reference}</h2><p>Direct / Decoshop</p></div><button className="btn btn-outline" onClick={onClose}>Tutup ×</button></header><DirectContribution orderId={row.order_id} canManage={canManage} onSaved={onSaved}/>{onOpenOrder&&<button className="btn btn-outline" onClick={()=>{onClose();onOpenOrder(row.reference)}}>Buka order</button>}</dialog>,document.body);
}
export default function TargetMargin({canManage,onOpenOrder,onOpenSettings}:{canManage:boolean;onOpenOrder?:(reference:string)=>void;onOpenSettings?:()=>void}){
 const [month,setMonth]=useState(malaysiaDate().slice(0,7)),[channel,setChannel]=useState('all'),[state,setState]=useState('all'),[query,setQuery]=useState(''),[sort,setSort]=useState('day_desc'),[offset,setOffset]=useState(0),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [data,setData]=useState<ContributionReport|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[tick,setTick]=useState(0),[selected,setSelected]=useState<ContributionRow|null>(null),[settingsOpen,setSettingsOpen]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{let active=true;setLoading(true);setError('');setData(null);const timer=window.setTimeout(()=>{
  if(!/^\d{4}-\d{2}$/.test(month)||month>malaysiaDate().slice(0,7)||(from&&from.slice(0,7)!==month)||(to&&to.slice(0,7)!==month)||(from&&to&&from>to)){setError('Semak bulan dan tarikh filter. Tarikh mesti dalam bulan pilihan.');setLoading(false);return;}
  void request<ContributionReport>({action:'contribution_report',month:`${month}-01`,channel,state,query,sort,offset,from,to}).then(r=>{if(active)setData(r)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});
 },200);return()=>{active=false;window.clearTimeout(timer)}},[month,channel,state,query,sort,offset,from,to,tick]);
 const refresh=()=>setTick(t=>t+1);
 const filter=(fn:()=>void)=>{fn();setOffset(0)};
 return <div className="ct-page">
  <section className="ct-panel"><div className="ct-heading"><div><h2>Target & Margin</h2><p>Sumbangan selepas kos, sebelum overhead. Semua angka dalam MYR.</p></div><div><button className="btn btn-outline btn-sm" disabled={loading} onClick={refresh}>Muat semula margin</button>{canManage&&<button className="btn btn-outline btn-sm" onClick={()=>setSettingsOpen(v=>!v)}>{settingsOpen?'Tutup tetapan':'Tetapan target'}</button>}{onOpenSettings&&<button className="btn btn-outline btn-sm" onClick={onOpenSettings}>Tetapan modal</button>}</div></div>
   <label className="ct-month">Bulan target<input type="month" max={malaysiaDate().slice(0,7)} value={month} onChange={e=>filter(()=>{setMonth(e.target.value);setFrom('');setTo('')})}/></label>
   {error&&<p className="ct-warning" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
   {loading&&<p className="ct-muted" role="status">Memuatkan margin…</p>}{data&&<TargetNumbers data={data}/>}
   {settingsOpen&&canManage&&data&&<TargetSettingsForm key={data.settings.version} settings={data.settings} onSaved={()=>{setSettingsOpen(false);setNotice('Target disimpan.');refresh()}}/>}
  </section>
  {data&&<div className="ct-channel-grid">{['shopee','deco'].map(key=>{const c=data.channels.find(c=>c.channel===key);return <article className="ct-panel" key={key}><h3>{key==='shopee'?'Shopee':'Direct / Decoshop'}</h3><strong>{money(c?.contribution??0)}</strong><p>{c?.orders??0} order · Margin {c?.margin==null?'belum lengkap':`${c.margin.toFixed(2)}%`}</p><small>{key==='shopee'?'Nett release / escrow − modal − kos tambahan':'Bayaran − courier − modal − kos tambahan'}</small><MoneyBreakdown data={c?.breakdown}/>{!!c?.missing&&<p className="ct-warning">{c.missing} order belum cukup data</p>}</article>})}</div>}
  <p className="ct-muted ct-explanation">Shopee: nett sudah mengambil kira fees dan shipping platform. Direct: postage customer termasuk dalam bayaran; courier ditolak dahulu, modal atas barang sahaja. Margin % = sumbangan ÷ nilai barang. Ringkasan target sentiasa untuk seluruh bulan; filter di bawah hanya menapis senarai order.</p>
  <section className="ct-panel"><div className="ct-filters">
   <label>Channel<select aria-label="Channel" value={channel} onChange={e=>filter(()=>setChannel(e.target.value))}><option value="all">Semua channel</option><option value="shopee">Shopee</option><option value="deco">Direct / Decoshop</option></select></label>
   <label>Jenis margin<select aria-label="Jenis margin" value={state} onChange={e=>filter(()=>setState(e.target.value))}><option value="all">Semua jenis</option>{Object.entries(stateLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}<option value="loss">Rugi</option></select></label>
   <label>Cari order<input value={query} placeholder="Nombor order" onChange={e=>filter(()=>setQuery(e.target.value))}/></label>
   <label>Dari<input type="date" value={from} onChange={e=>filter(()=>setFrom(e.target.value))}/></label><label>Hingga<input type="date" value={to} onChange={e=>filter(()=>setTo(e.target.value))}/></label>
   <label>Susunan<select aria-label="Susunan" value={sort} onChange={e=>filter(()=>setSort(e.target.value))}><option value="day_desc">Terbaru</option><option value="contribution_asc">Sumbangan terendah</option><option value="contribution_desc">Sumbangan tertinggi</option><option value="margin_asc">Margin terendah</option></select></label>
  </div>
  {data&&<><div className="table-wrap"><table className="ct-table"><thead><tr><th>Order / tarikh</th><th>Channel</th><th>Barang</th><th>Bayaran</th><th>Fee¹</th><th>Courier¹</th><th>Nett</th><th>Modal</th><th>Tambahan</th><th>Sumbangan</th><th>Margin</th><th>Jenis</th></tr></thead><tbody>{data.rows.map(r=><tr key={r.order_id}><td><button className="finance-order-link" onClick={()=>setSelected(r)}>{r.reference}</button><small className="ct-block">{r.day} · {r.status}</small>{r.reasons.length>0&&<small className="ct-warning ct-block">{r.reasons.join(' · ')}</small>}</td><td>{r.channel==='shopee'?'Shopee':'Direct'}</td>{[r.sales,r.customer_paid,r.fee,r.courier,r.nett,r.material,r.extras,r.contribution].map((n,i)=><td key={i} className={i===7?'ct-amount':''}>{r.channel==='shopee'&&i===3?<small>Dalam nett</small>:money(n)}</td>)}<td>{r.margin==null?'—':`${r.margin.toFixed(2)}%`}</td><td><span className={`ct-badge ${r.state}`}>{stateLabels[r.state]}</span>{r.channel==='deco'&&<small className="ct-block">Courier {r.courier_state==='actual'?'sebenar':'anggaran'}</small>}</td></tr>)}</tbody></table></div>
  {data.rows.length===0&&<p className="ct-empty">Tiada order untuk filter ini.</p>}
  <div className="ct-pagination"><small>{data.total} order · ¹ Fee Shopee untuk rujukan; sudah ditolak dalam nett. Courier direct ditolak daripada bayaran.</small><div><button className="btn btn-outline btn-sm" disabled={!offset||loading} onClick={()=>setOffset(o=>Math.max(0,o-50))}>Sebelum</button><span>{data.total?`${offset+1}–${Math.min(offset+50,data.total)}`:'0'}</span><button className="btn btn-outline btn-sm" disabled={offset+50>=data.total||loading} onClick={()=>setOffset(o=>o+50)}>Seterusnya</button></div></div></>}
  </section>
  {selected?.channel==='shopee'&&<OrderProfitDetail orderId={selected.order_id} canManage={canManage} onClose={()=>setSelected(null)} onSaved={refresh}/>}
  {selected?.channel==='deco'&&<DirectDialog row={selected} canManage={canManage} onClose={()=>setSelected(null)} onSaved={refresh} onOpenOrder={onOpenOrder}/>}
 </div>;
}
