import {useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {clickupRequest} from '../lib/taskDashboard';
import type {PanelOptions} from '../lib/taskPanel';
import {CopyValue} from './TaskPanelControls';
export function safeTaskLink(value?:string){try{const u=new URL(value||'');return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export default function TaskListActions({taskId,reviewLabel,awbLink,orderLink,showReview,canEdit,onChanged}:{taskId:string;reviewLabel:string;awbLink?:string;orderLink?:string;showReview:boolean;canEdit:boolean;onChanged:()=>void}){
 const [options,setOptions]=useState<PanelOptions|null>(null),[popup,setPopup]=useState<{left:number;top:number}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[receipt,setReceipt]=useState('');
 const lock=useRef(false),retry=useRef<{id:string;payload:Record<string,unknown>}|null>(null);
 async function read(){const o:PanelOptions=await clickupRequest({action:'options',task_id:taskId});setOptions(o);return o;}
 async function open(button:HTMLButtonElement){if(lock.current)return;const r=button.getBoundingClientRect();setPopup({left:Math.max(8,Math.min(r.left,innerWidth-290)),top:Math.max(8,Math.min(r.bottom+4,innerHeight-340))});setError('');setBusy(true);try{await read();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function mutate(value:string|null,complete=false){
  if(lock.current||receipt||!canEdit)return;lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const o=await read();if(!o.configured||!o.can_edit)throw Error('Tiada akses API ClickUp untuk mengemas kini task.');
   let payload:Record<string,unknown>;
   if(complete){const status=o.statuses.find(s=>s.status.toLowerCase()==='complete');if(!status)throw Error('Status Complete tidak tersedia.');payload={action:'status',task_id:taskId,status:status.status,expected_status:o.status,expected_updated_at:o.updated_at};}
   else{if(!o.review?.available||value!==null&&!o.review.options.some(v=>v.id===value))throw Error('Pilihan Review Customer sudah berubah. Buka semula dropdown.');payload={action:'field',task_id:taskId,field_id:o.review.id,value,expected_value:o.review.value??null,expected_updated_at:o.updated_at};}
   if(!retry.current||JSON.stringify(retry.current.payload)!==JSON.stringify(payload))retry.current={id:crypto.randomUUID(),payload};
   const result=await clickupRequest({...payload,request_id:retry.current.id});if(!result.verified)throw Error('Perubahan belum disahkan.');
   setOptions({...o,...result});setNotice(complete?'Complete disahkan.':'Review disahkan.');setPopup(null);retry.current=null;onChanged();
  }catch(e){if((e as {uncertain?:boolean}).uncertain&&retry.current)setReceipt(retry.current.id);setError((e as Error).message);}
  finally{lock.current=false;setBusy(false);}
 }
 async function reconcile(){if(lock.current||!receipt)return;lock.current=true;setBusy(true);try{const r=await clickupRequest({action:'receipt',task_id:taskId,request_id:receipt});if(!r.verified)throw Error('Belum disahkan.');setReceipt('');setError('');setPopup(null);setNotice('Perubahan disahkan.');onChanged();}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}}
 const label=options?.review?.options.find(o=>o.id===options.review?.value)?.name??reviewLabel;
 const link=(value:string|undefined,name:string)=>{const url=safeTaskLink(value);return <td><div className="tw-cell-value">{url?<><a href={url} target="_blank" rel="noopener noreferrer" className="tw-cell-content" title={url}>{name} ↗</a><CopyValue value={url} label={name}/></>:<span>—</span>}</div></td>;};
 return <>{showReview&&<td><button type="button" className="tw-list-review" aria-label={`Review Customer ${taskId}`} aria-expanded={!!popup} disabled={!canEdit||busy||!!receipt} onClick={e=>void open(e.currentTarget)}>{label||'—'} ▾</button></td>}{link(awbLink,'AWB link')}{link(orderLink,'order_link')}<td><button type="button" className="tw-list-complete" disabled={!canEdit||busy||!!receipt} onClick={()=>void mutate(null,true)}>✓ Complete</button>{busy&&<small role="status">Menyimpan…</small>}{notice&&<small role="status">{notice}</small>}{error&&<small role="alert">{error}</small>}{receipt&&<button onClick={()=>void reconcile()} disabled={busy}>Semak perubahan</button>}</td>
 {popup&&createPortal(<div className="tw-review-backdrop" onClick={()=>{if(!busy)setPopup(null);}}><div role="dialog" aria-label="Review Customer" className="tw-review-popup" style={popup} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'&&!busy)setPopup(null);}}><header>Review Customer <button onClick={()=>setPopup(null)} disabled={busy} aria-label="Tutup pilihan review">×</button></header>{busy?<p role="status">Memuat / menyimpan…</p>:error?<p role="alert">{error}</p>:<div role="listbox" aria-label="Pilihan Review Customer">{[{id:'',name:'Kosongkan',color:'#888'},...(options?.review?.options||[])].map(o=><button type="button" role="option" aria-selected={(options?.review?.value||'')===o.id} key={o.id} disabled={!options?.configured||!options.can_edit||!!receipt} onClick={()=>void mutate(o.id||null)}><i style={{background:o.color}}/>{o.name}</button>)}</div>}</div></div>,document.body)}</>;
}
