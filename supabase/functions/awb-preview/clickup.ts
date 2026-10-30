import {REVIEW_FIELD,reviewField,panelFields} from '../task-clickup/panel.ts';
type Data=Record<string,any>;
// Fixed actions only. The public request cannot choose a field, value, URL or status.
export async function applyClickUpAction(db:any,token:string,orderId:string,taskId:string,buton:number,fetcher:typeof fetch=fetch){
 let dispatched=false;
 async function api(path:string,body?:Data,method=body?'POST':'GET'){
  const r=await fetcher('https://api.clickup.com/api/v2/'+path,{method,headers:{authorization:token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Object.assign(Error('ClickUp menolak permintaan ('+r.status+').'),{rejected:method!=='GET'&&r.status<500,httpStatus:r.status});
  const data=await r.json();if(!data||data.err||data.error)throw Error('Respons ClickUp tidak sah.');return data;
 }
 async function task(){
  const t=await api('task/'+encodeURIComponent(taskId));
  if(t.id!==taskId||!(String(t.list?.id)==='18375902'||buton===3&&String(t.list?.id)==='901612769752'&&String(t.status?.status).toLowerCase()==='complete')||t.archived||panelFields(t).order_reference.trim()!==orderId)throw Object.assign(Error('Task tidak lagi berkaitan dengan order/ORDER LIST ini. Tekan Refresh.'),{safe:true});
  return t;
 }
 try{
  const current=await task();let desired:string,changed=false;
  if(buton===3){
   const list=await api('list/18375902');
   const statuses=(list.statuses||[]).filter((s:Data)=>String(s.status).toLowerCase()==='complete');
   if(statuses.length!==1)throw Object.assign(Error('Status Complete tidak tersedia.'),{safe:true});
   desired=statuses[0].status;changed=current.status?.status!==desired;
   if(changed){dispatched=true;await api('task/'+encodeURIComponent(taskId),{status:desired},'PUT');}
  }else{
   const review=reviewField(current),name=buton===1?'AWB/address printed':'FINISHED product Printed';
   const options=review.options.filter((o:Data)=>o.name===name);
   if(!review.available||options.length!==1)throw Object.assign(Error('Pilihan '+name+' tiada dalam Review customer.'),{safe:true});
   desired=options[0].id;changed=review.value!==desired;
   if(changed){dispatched=true;await api('task/'+encodeURIComponent(taskId)+'/field/'+REVIEW_FIELD,{value:desired});}
  }
  const fresh=changed?await task():current;
  if((buton===3?fresh.status?.status:reviewField(fresh).value)!==desired)throw Error('Perubahan belum dapat disahkan di ClickUp.');
  // The same verified snapshot projection used by the authenticated designer API.
  const {error:projectError}=await db.rpc('icetak_project_clickup_work',{p_task:fresh,p_observed_at:new Date().toISOString()});if(projectError)throw projectError;
  const {error:ingestError}=await db.rpc('ingest_clickup_event',{p_event:{event_key:'icetak-direct:'+fresh.id+':'+fresh.date_updated,task_id:fresh.id,task_name:fresh.name,list_id:String(fresh.list.id),current_status:fresh.status?.status,task_updated_at:String(fresh.date_updated),event_type:'taskUpdated',raw_payload:{task:fresh,source:'icetak_internal_api'}}});if(ingestError)throw ingestError;
  return {verified:true,unchanged:!changed};
 }catch(error){
  const e=error as Error&{rejected?:boolean;httpStatus?:number};
  // A write timeout or failed readback never becomes an automatic retry.
  throw Object.assign(Error(e.message||'Kemas kini ClickUp gagal.'),{uncertain:dispatched&&!e.rejected,httpStatus:e.httpStatus});
 }
}
