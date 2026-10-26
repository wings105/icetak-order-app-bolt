import {useRef,useState} from 'react';
import {clickupRequest} from '../lib/taskDashboard';
import type {PanelOptions} from '../lib/taskPanel';

const reviewActions=['FINISHED product Printed','AWB/address printed'] as const;
export default function ProductionTaskActions({taskId,onComplete}:{taskId:string;onComplete:()=>void}){
 const [pending,setPending]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [review,setReview]=useState(''),[receipt,setReceipt]=useState('');
 const lock=useRef(false),retry=useRef<{id:string;payload:Record<string,unknown>}|null>(null);
 function confirmed(result:Pick<PanelOptions,'review'|'status'>&{verified?:boolean},label:string){
  if(!result.verified)throw Error('Perubahan belum disahkan oleh ClickUp.');
  setReview(result.review?.options.find(o=>o.id===result.review?.value)?.name||'');
  setNotice(`${label} disahkan di ClickUp.`);setReceipt('');retry.current=null;
  if(/^complete$/i.test(result.status||''))onComplete();
 }
 async function update(label:string){
  if(lock.current||receipt)return;lock.current=true;setPending(label);setError('');setNotice('');
  try{
   // Read on operator action, not once per card/refresh. The provider's live
   // options and revision drive the existing optimistic, audited API contract.
   const options:PanelOptions=await clickupRequest({action:'options',task_id:taskId});
   if(!options.configured)throw Error('API ClickUp belum disambungkan. Semak Settings.');
   if(!options.can_edit)throw Error('Akaun ini tiada kebenaran mengemas kini task.');
   if(/^(complete|closed|cancelled|canceled)$/i.test(options.status||''))throw Error('Task ini sudah ditutup. Refresh senarai.');
   let payload:Record<string,unknown>;
   if(label==='Complete'){
    const complete=options.statuses.find(s=>s.status.toLowerCase()==='complete');
    if(!complete)throw Error('Status Complete tidak tersedia pada task ini.');
    payload={action:'status',task_id:taskId,status:complete.status,expected_status:options.status,expected_updated_at:options.updated_at};
   }else{
    const option=options.review?.options.find(o=>o.name===label);
    if(!options.review?.available||!option)throw Error(`Pilihan ${label} tiada dalam Review Customer task ini.`);
    if(options.review.value===option.id){setReview(label);setNotice(`${label} sudah disahkan di ClickUp.`);return;}
    payload={action:'field',task_id:taskId,field_id:options.review.id,value:option.id,expected_value:options.review.value??null,expected_updated_at:options.updated_at};
   }
   if(!retry.current||JSON.stringify(retry.current.payload)!==JSON.stringify(payload))retry.current={id:crypto.randomUUID(),payload};
   const result=await clickupRequest({...payload,request_id:retry.current.id});
   confirmed(result,label);
  }catch(e){
   if((e as {uncertain?:boolean}).uncertain&&retry.current)setReceipt(retry.current.id);
   setError(e instanceof Error?e.message:'Kemas kini ClickUp gagal.');
  }finally{lock.current=false;setPending('');}
 }
 async function checkReceipt(){
  if(lock.current||!receipt)return;lock.current=true;setPending('Semak');setError('');
  try{confirmed(await clickupRequest({action:'receipt',task_id:taskId,request_id:receipt}),'Perubahan terdahulu');}
  catch(e){setError(e instanceof Error?e.message:'Status perubahan belum dapat disahkan.');}
  finally{lock.current=false;setPending('');}
 }
 return <div className="acp-actions" aria-label="Tindakan ClickUp" aria-busy={!!pending}>
  {review&&<small className="acp-current-review">Review Customer: {review}</small>}
  {reviewActions.map((label,index)=><button type="button" key={label} className={index===0?'acp-finished':'acp-address'} disabled={!!pending||!!receipt||review===label} onClick={()=>void update(label)}>{review===label?'✓ ':''}{label}</button>)}
  <button type="button" className="acp-complete" disabled={!!pending||!!receipt} onClick={()=>void update('Complete')}>✓ Complete</button>
  {pending&&<small role="status">{pending==='Semak'?'Menyemak perubahan…':'Menyimpan ke ClickUp…'}</small>}
  {notice&&<small className="acp-action-success" role="status">{notice}</small>}
  {error&&<small className="acp-action-error" role="alert">{error}</small>}
  {receipt&&<button type="button" disabled={!!pending} onClick={()=>void checkReceipt()}>Semak perubahan</button>}
 </div>;
}
