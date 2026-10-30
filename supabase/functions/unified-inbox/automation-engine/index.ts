import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { executeRun } from './worker.ts';
const U=Deno.env.get('SUPABASE_URL')||'', K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const headers={'content-type':'application/json','cache-control':'no-store'};
const out=(v:unknown,s=200)=>Response.json(v,{status:s,headers});
async function rpc(action:string,payload:Record<string,unknown>={},actor='worker'){
 const r=await fetch(`${U}/rest/v1/rpc/icetak_wa_automation`,{method:'POST',headers:{apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json'},body:JSON.stringify({p_action:action,p_payload:payload,p_actor:actor}),signal:AbortSignal.timeout(20000)});
 const j=await r.json();if(!r.ok)throw Error(j.message||'AUTOMATION_DATABASE_FAILED');return j;
}
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 try{
  const q=await fetch(`${U}/rest/v1/private_runtime_settings?setting_key=eq.qrpay_ai_worker_token&select=setting_value&limit=1`,{headers:{apikey:K,authorization:`Bearer ${K}`},signal:AbortSignal.timeout(8000)});
  const token=(await q.json())?.[0]?.setting_value;
  if(!token||req.headers.get('x-automation-token')!==token)return out({ok:false,error:'UNAUTHORIZED'},401);
  const raw=await req.text();if(raw.length>16000)return out({ok:false,error:'PAYLOAD_TOO_LARGE'},413);
  const b=JSON.parse(raw),action=String(b.action||'snapshot');
  if(action==='process'){
   const jobs=await rpc('claim',{limit:5});
   const results=await Promise.all(jobs.map(async(run:any)=>{
    const result=await executeRun(run,{url:U,token,fetcher:fetch});
    await rpc('finish',{id:run.id,lease_id:run.lease_id,...result});return {id:run.id,status:result.status};
   }));return out({ok:true,processed:results.length,results});
  }
  if(!['snapshot','detail','save','preview','retry'].includes(action))return out({ok:false,error:'INVALID_ACTION'},400);
  return out({ok:true,data:await rpc(action,b.payload||{},String(b.actor||'admin-gateway').slice(0,80))});
 }catch(e){return out({ok:false,error:e instanceof Error?e.message.slice(0,250):'AUTOMATION_UNAVAILABLE'},503);}
});
