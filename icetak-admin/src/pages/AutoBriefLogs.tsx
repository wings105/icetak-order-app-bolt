import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import './AutoBriefLogs.css';
type Receipt={state?:string;sent_at?:string;provider_message_id?:string;request_id?:string;attempts?:number;next_retry_at?:string;error?:string};
type Row={task_id:string;order_reference:string;phase:string;status:string;updated_at:string;checked_at?:string;due_at?:string;blocked?:string;defaulted:boolean;is_historical?:boolean;remark?:string;sku?:string;wording?:string;confirmed?:boolean;job_state:string;last_error?:string;receipt?:Receipt;product_id?:string;product_title?:string};
type LogEvent={id:number;phase:string;state:string;remark:string;created_at:string};
type Result={rows:Row[];total:number;events:LogEvent[];as_of:string;history_limit:number};
const labels:Record<string,string>={waiting:'Menunggu',sent:'Diterima API Shopee',manual:'Rekod staf',unknown:'Belum pasti',failed:'Gagal',blocked:'Perlu semakan',sending:'Sedang proses',skipped:'Detail tersedia',defaulted:'Default hb',detail_available:'Detail tersedia'};
const phaseLabel=(p:string)=>p==='first'?'Permintaan detail · 15 minit':p==='deadline'?'Notis deadline · 2 petang':'Semakan detail';
const badge=(s:string)=>['sent','detail_available','skipped'].includes(s)?'succeeded':s==='unknown'?'uncertain':s==='waiting'?'pending':s==='manual'?'observed':s;
const time=(s?:string)=>s&&Number.isFinite(Date.parse(s))?new Date(s).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'short',timeStyle:'short'})+' MYT':'—';
async function api(action:string,payload:Record<string,unknown>){
 const {data,error}=await supabase.functions.invoke('admin-automation',{body:{action,payload}});
 if(error||data?.ok!==true)throw Error('Log tidak dapat dimuat. Sila cuba semula.');
 return data.data as Result;
}
export default function AutoBriefLogs(){
 const [data,setData]=useState<Result|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const [query,setQuery]=useState(''),[phase,setPhase]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(0);
 const [selected,setSelected]=useState(''),[detail,setDetail]=useState<Result|null>(null),[detailError,setDetailError]=useState('');
 const request=useRef(0),detailRequest=useRef(0),dialog=useRef<HTMLDialogElement>(null);
 const load=useCallback(async(quiet=false)=>{
  const seq=++request.current;if(!quiet)setBusy(true);setError('');
  try{const r=await api('autobrief_logs',{query,phase,state:status,offset:page*30});if(seq===request.current){if(page>0&&page*30>=r.total){setPage(0);return;}setData(r);}}
  catch{if(seq===request.current)setError('Log tidak dapat dimuat. Sila cuba semula.');}finally{if(seq===request.current)setBusy(false);}
 },[query,phase,status,page]);
 useEffect(()=>{setBusy(true);const t=window.setTimeout(()=>void load(),250);return()=>{clearTimeout(t);request.current+=1;};},[load]);
 useEffect(()=>{const t=window.setInterval(()=>{if(document.visibilityState==='visible')void load(true);},30000);return()=>clearInterval(t);},[load]);
 useEffect(()=>()=>{detailRequest.current++;},[]);
 const close=()=>{detailRequest.current++;dialog.current?.close();setSelected('');setDetail(null);};
 useEffect(()=>{if(selected&&!dialog.current?.open)dialog.current?.showModal();},[selected]);
 const open=async(task_id:string)=>{
  const seq=++detailRequest.current;setSelected(task_id);setDetail(null);setDetailError('');
  try{const r=await api('autobrief_log_detail',{task_id});if(seq===detailRequest.current)setDetail(r);}catch{if(seq===detailRequest.current)setDetailError('Butiran log tidak dapat dimuat. Sila cuba semula.');}
 };
 const current=detail?.rows[0];
 return <section className="ab-logs" aria-label="Log AutoBrief">
  <div className="ab-log-heading"><div><h2>Log AutoBrief</h2><p>Follow-up cake topper Shopee · semua masa dalam MYT</p></div><button className="btn btn-outline" disabled={busy} onClick={()=>void load()}>{busy?'Memuat…':'Refresh log'}</button></div>
  <p className="ab-log-note">Setiap order mempunyai dua peringkat. “Diterima API Shopee” mengikut receipt; “Rekod staf” merekod follow up1 tanpa bukti API. Semakan ini tidak menghantar mesej.</p>
  {error?<div role="alert" className="auto-notice error">{error} <button className="btn btn-outline" onClick={()=>void load()}>Cuba semula</button></div>:null}
  <div className="auto-panel">
   <div className="auto-filters"><label>Cari Order ID<input value={query} maxLength={80} placeholder="Order ID atau Task ID" onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label><label>Peringkat<select value={phase} onChange={e=>{setPhase(e.target.value);setPage(0);}}><option value="">Semua peringkat</option><option value="first">Permintaan detail · 15 minit</option><option value="deadline">Notis deadline · 2 petang</option></select></label><label>Status follow-up<select value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}><option value="">Semua status</option>{['waiting','sent','manual','unknown','failed','blocked','sending','skipped'].map(s=><option value={s} key={s}>{labels[s]}</option>)}</select></label></div>
   <div className="auto-table-wrap" aria-busy={busy}><table><thead><tr><th>Order / SKU</th><th>Peringkat</th><th>Status</th><th>Masa penghantaran / cut-off</th><th>Semakan terakhir</th><th/></tr></thead><tbody>{!busy&&data?.rows.map(row=><tr key={row.task_id+':'+row.phase}><td><b>{row.order_reference||row.task_id}</b><small>{row.sku||'SKU belum tersedia'}</small></td><td>{phaseLabel(row.phase)}</td><td><span className={`auto-badge ${badge(row.status)}`}>{labels[row.status]||row.status}</span>{row.phase==='deadline'&&row.defaulted?<small>Default wording: hb</small>:null}{row.blocked?<small>{row.blocked}</small>:null}{row.last_error?<small>AutoBrief: {row.last_error}</small>:null}</td><td>{time(row.receipt?.sent_at)}{row.phase==='deadline'?<small>Cut-off: {time(row.due_at)}</small>:null}</td><td>{time(row.checked_at||row.updated_at)}</td><td><button className="btn btn-outline" aria-label={`Butiran ${row.order_reference||row.task_id} ${row.phase}`} onClick={()=>void open(row.task_id)}>Butiran</button></td></tr>)}</tbody></table>{busy||!data?.rows.length?<div className="auto-empty" role="status">{busy?'Memuat log…':error?'Log belum tersedia.':'Tiada rekod sepadan.'}</div>:null}</div>
   <footer className="auto-pagination"><span>{data?.total||0} rekod peringkat{data?.as_of?<small className="ab-asof">Dibaca: {time(data.as_of)}</small>:null}</span><div><button className="btn btn-outline" disabled={!page||busy} onClick={()=>setPage(p=>p-1)}>Sebelum</button><span>{page+1} / {Math.max(1,Math.ceil((data?.total||0)/30))}</span><button className="btn btn-outline" disabled={busy||(page+1)*30>=(data?.total||0)} onClick={()=>setPage(p=>p+1)}>Seterusnya</button></div></footer>
  </div>
  <p className="auto-footnote">Status ialah snapshot semakan AutoBrief terakhir. Jejak perubahan disimpan mulai kemas kini log ini; receipt lama kekal dipaparkan. Tiada rekod baharu bagi semakan yang tidak mengubah status.</p>
  {selected?<dialog ref={dialog} className="ab-log-dialog auto-run-dialog" aria-label="Butiran log AutoBrief" onCancel={e=>{e.preventDefault();close();}}><header><div><h2>{current?.order_reference||'Butiran log AutoBrief'}</h2><p>{current?.sku||selected}</p></div><button className="btn btn-outline" autoFocus onClick={close}>Tutup</button></header>{detailError?<div role="alert" className="auto-notice error">{detailError}<button className="btn btn-outline" onClick={()=>void open(selected)}>Cuba semula</button></div>:!detail?<p role="status">Memuat butiran…</p>:!current?<p>Rekod tidak lagi tersedia.</p>:<>
   {current.is_historical?<p className="auto-warning">Snapshot terakhir sebelum ralat AutoBrief. Rujuk ralat dan jejak perubahan.</p>:null}<p className="ab-remark">{current.remark||'Remark akan tersedia selepas semakan AutoBrief berikutnya.'}</p>
   <dl><div><dt>Produk</dt><dd>{current.product_title||'—'}<br/>Product ID: {current.product_id||'—'}</dd></div><div><dt>Wording / confirm</dt><dd>{current.wording||'Perlu detail'} · {current.confirmed?'Disahkan':'Belum disahkan'}</dd></div><div><dt>Semakan terakhir / status job</dt><dd>{time(current.checked_at||current.updated_at)} · {current.job_state}</dd></div>{current.last_error?<div><dt>Ralat AutoBrief</dt><dd>{current.last_error}</dd></div>:null}</dl>
   <a href={`https://app.clickup.com/t/${encodeURIComponent(current.task_id)}`} target="_blank" rel="noreferrer">Buka task ClickUp ↗</a>
   <h3>Receipt setiap peringkat</h3>{detail.rows.map(r=><article className="ab-receipt" key={r.phase}><h4>{phaseLabel(r.phase)}</h4><span className={`auto-badge ${badge(r.status)}`}>{labels[r.status]||r.status}</span><dl><div><dt>Masa dihantar</dt><dd>{time(r.receipt?.sent_at)}</dd></div>{r.phase==='deadline'?<div><dt>Cut-off</dt><dd>{time(r.due_at)}</dd></div>:null}<div><dt>Provider Message ID</dt><dd><code>{r.receipt?.provider_message_id||'Tiada bukti API'}</code></dd></div><div><dt>Request ID</dt><dd><code>{r.receipt?.request_id||'—'}</code></dd></div><div><dt>Cubaan API / cubaan seterusnya</dt><dd>{r.receipt?.attempts??'—'} · {time(r.receipt?.next_retry_at)}</dd></div>{r.receipt?.error||r.blocked?<div><dt>Sebab</dt><dd>{r.receipt?.error||r.blocked}</dd></div>:null}</dl></article>)}
   <h3>Jejak perubahan</h3>{detail.events.length?<ol className="auto-timeline">{detail.events.map(e=><li key={e.id}><b>{phaseLabel(e.phase)} · {labels[e.state]||e.state}</b><small>{time(e.created_at)}</small><p>{e.remark||'Status direkod sebelum remark tersedia.'}</p></li>)}</ol>:<p className="auto-footnote">Belum ada perubahan selepas log diperkenalkan. Receipt sedia ada ditunjukkan di atas.</p>}{detail.events.length>=detail.history_limit?<p className="auto-footnote">Menunjukkan {detail.history_limit} perubahan terkini.</p>:null}
  </>}</dialog>:null}
 </section>;
}
