import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {coverage,orderOf,ORDER_FIELD} from './matcher.ts';
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const out=(b:any,s=200)=>Response.json(b,{status:s,headers:{'cache-control':'no-store'}});
async function db(path:string,body?:unknown){const r=await fetch(U+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error('DATABASE_UNAVAILABLE');return d;}
const rpc=(action:string,body:any={},secret?:string)=>db('rpc/clickup_order_gate_auto',{p_action:action,p_body:body,p_secret:secret||null});
Deno.serve(async req=>{
 if(req.method==='GET')return out({ok:true,service:'clickup-order-gate-sync'});
 if(req.method!=='POST')return out({ok:false},405);
 try{
  const worker=req.headers.get('x-gate-worker-key');
  if(!worker){const raw=await req.text();if(new TextEncoder().encode(raw).length>32768)return out({ok:false},413);const d=await rpc('enqueue',{raw,signature:req.headers.get('x-signature')||''});return out(d,d.http_status||200);}
  if(!(await rpc('worker_auth',{},worker))?.ok)return out({ok:false},401);
  const jobs=await rpc('work');
  if(!jobs.tasks?.length&&!jobs.orders?.length)return out({ok:true,idle:true});
  const settings=await db('private_runtime_settings?setting_key=eq.clickup_designer_api_token&select=setting_value&limit=1');const token=settings?.[0]?.setting_value;if(!token)throw Error('CLICKUP_NOT_CONNECTED');
  const started=Date.now();let reads=0;async function api(path:string){if(reads>=24||Date.now()-started>40000)throw Error('READ_BUDGET');reads++;const r=await fetch('https://api.clickup.com/api/v2/'+path,{headers:{authorization:token},redirect:'error',signal:AbortSignal.timeout(12000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error('CLICKUP_HTTP_'+r.status);return d;}
  const results=[];
  for(const j of jobs.tasks||[]){if(Date.now()-started>40000)break;if(j.event_type==='taskDeleted'){await rpc('task_result',{task_id:j.task_id,event_type:j.event_type});continue;}try{const t=await api('task/'+encodeURIComponent(j.task_id));await rpc('task_result',{task_id:j.task_id,event_type:j.event_type,order_id:['18375902','901612769752'].includes(String(t.list?.id))?orderOf(t):null});}catch(e){await rpc('task_result',{task_id:j.task_id,error:String(e instanceof Error?e.message:'TASK_READ_FAILED')});}}
  for(const j of jobs.orders||[]){try{
   const found=new Map<string,any>();
   for(const list of ['18375902','901612769752']){for(let page=0;page<10;page++){
    const params=new URLSearchParams({include_closed:'true',subtasks:'false',page:String(page),custom_fields:JSON.stringify([{field_id:ORDER_FIELD,operator:'==',value:j.order_id}])});
    const d=await api('list/'+list+'/task?'+params);if(!Array.isArray(d.tasks))throw Error('INVALID_TASK_LIST');
    for(const t of d.tasks)if(orderOf(t)===j.order_id)found.set(t.id,t);
    if(d.last_page===true||d.tasks.length<100)break;if(page===9)throw Error('PAGINATION_LIMIT');
   }}
   const tasks=[...found.values()].sort((a,b)=>a.id.localeCompare(b.id));
   const normalized=Object.fromEntries(tasks.map(t=>['auto:'+t.id,{task_id:t.id,confirmed_at:new Date().toISOString(),confirmed_source:'automatic_clickup_api'}]));
   results.push(await rpc('snapshot',{order_id:j.order_id,tasks:normalized,coverage_ok:coverage(tasks,j.products),fingerprint:JSON.stringify(tasks.map(t=>({id:t.id,sets:t.custom_fields?.find((f:any)=>f.id==='2670446d-5e5a-48ac-931d-c2be790d6b3b')?.value,sku:t.custom_fields?.find((f:any)=>f.id==='34c62cbb-c174-42e8-9c50-8301f68269a8')?.value})))}));
  }catch(e){results.push(await rpc('snapshot',{order_id:j.order_id,error:e instanceof Error?e.message:'ORDER_READ_FAILED'}));}}
  return out({ok:true,provider_reads:reads,task_events:jobs.tasks?.length||0,orders:results});
 }catch{return out({ok:false,error:'SYNC_UNAVAILABLE'},503);}
});
