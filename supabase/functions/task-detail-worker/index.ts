import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {loadReadiness} from '../task-workspace/sources.ts';
import {observe} from '../task-workspace/automation.ts';
const base=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const headers={apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'};
const out=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
async function call(path:string,init:RequestInit={}){
 const r=await fetch(base+path,{...init,headers:{...headers,...init.headers},signal:AbortSignal.timeout(25000)});
 const d=await r.json().catch(()=>null);if(!r.ok)throw Error('AUTOMATION_REQUEST_FAILED');return d;
}
const rpc=(name:string,body:unknown)=>call('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(body)});
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false},405);
 let run:string|null=null;
 try{
  const settings=await call('/rest/v1/private_runtime_settings?setting_key=eq.task_detail_worker_token&select=setting_value&limit=1');
  if(!settings[0]?.setting_value||req.headers.get('x-task-detail-token')!==settings[0].setting_value)return out({ok:false},401);
  const claim=await rpc('icetak_task_detail_begin',{});if(!claim.run_id)return out({ok:true,busy:true});
  run=claim.run_id;
  const tasks=claim.tasks||[];let saved=0,unchanged=0,failed=0;
  // Bounded batches keep one unavailable bridge from discarding earlier successful orders.
  for(let start=0;start<tasks.length;start+=25){
   const batch=tasks.slice(start,start+25);
   try{
    const loaded=await loadReadiness(batch,rpc,call);
    for(const t of batch){
     try{
      const l=loaded[t.task_id];
      const result=await rpc('icetak_task_detail_record',{p_run:run,p_task_id:t.task_id,p_version:l.automation_version,
       p_source_token:l.source.source_token,p_data:l.observation});
      result.changed?saved++:unchanged++;
     }catch{failed++;}
    }
   }catch{failed+=batch.length;}
  }
  let intake=0;
  const pending=await rpc('icetak_task_detail_intake_pending',{});
  if(pending.length){
   const keys=pending.map((o:any)=>o.row_key);
   const snapshot=await rpc('icetak_customer_focus_orders',{p_keys:keys});
   for(const p of pending){
    try{
     const order=snapshot.orders?.find((o:any)=>`${o.kind}:${o.id}`===p.row_key);if(!order)continue;
     const rows=(order.items||[]).slice(0,50).map((_i:any,index:number)=>({task_id:`intake-${order.id}-${index}`,virtual:true,item_index:index,
      order_id:order.kind==='icetak'?order.id:null,marketplace_order_id:order.kind==='shopee'?order.id:null}));
     const loaded=rows.length?await loadReadiness(rows,rpc,call):{};
     const items=[];
     for(let n=0;n<rows.length;n++){
      const l=loaded[rows[n].task_id],previous=p.data?.items?.find((i:any)=>i.index===n&&i.sku===String(order.items[n].sku||''));
      items.push({index:n,sku:String(order.items[n].sku||''),observation:await observe({...l,readiness:l.raw_readiness},previous?{data:previous.observation}:null)});
     }
     const status=!items.length?'missing':items.some(i=>i.observation.status==='review')?'review':items.every(i=>i.observation.status==='ready')?'ready':'missing';
     await rpc('icetak_task_detail_intake_record',{p_run:run,p_key:p.row_key,p_version:p.version,p_revision:p.revision,p_data:{status,items,truncated:order.items?.length>50,checked_at:new Date().toISOString()}});
     intake++;
    }catch{failed++;}
   }
  }
  const result={ok:failed===0,processed:tasks.length,saved,unchanged,intake,failed,truncated:claim.truncated===true};
  await rpc('icetak_task_detail_finish',{p_run:run,p_result:result});run=null;
  return out(result,failed?207:200);
 }catch{
  if(run)await rpc('icetak_task_detail_finish',{p_run:run,p_result:{ok:false,error:'AUTOMATION_REQUEST_FAILED'}}).catch(()=>{});
  return out({ok:false,error:'AUTOMATION_REQUEST_FAILED'},503);
 }
});
