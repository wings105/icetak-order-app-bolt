import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {buyerIdentity} from '../_shared/shopee-buyer-identity.ts';
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function rest(path:string,body?:unknown){
 const r=await fetch(`${U}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const d=await r.json().catch(()=>null);if(!r.ok)throw new Error(`DATABASE_${r.status}`);return d;
}
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 try{
  if(req.headers.get('authorization')!==`Bearer ${K}`&&!req.headers.get('x-admin-window-token'))return out({ok:false,error:'UNAUTHORIZED'},401);
  const rows=await rest('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');const token=rows?.[0]?.setting_value;
  if(!K||!(req.headers.get('authorization')===`Bearer ${K}`||(token&&req.headers.get('x-admin-window-token')===token)))return out({ok:false,error:'UNAUTHORIZED'},401);
  const b=await req.json().catch(()=>({}));const jobs=await rest('rpc/claim_marketplace_recovery',{p_limit:Math.max(1,Math.min(50,Number(b.limit)||20))});
  const results=[];
  for(const j of jobs||[]){let ok=false,error:string|null=null;try{
   if(j.event_code===10){
    const history=Date.now()-Date.parse(j.received_at)>300000;
    const r=await fetch('https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-chat-ingest',{method:'POST',headers:{'content-type':'application/json','x-admin-window-token':token},body:JSON.stringify({source_event_id:j.event_id,source_received_at:j.received_at,payload:j.payload,is_history:history}),signal:AbortSignal.timeout(20000)});
    const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(`INBOX_${r.status}_${String(d.error||'FAILED').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,80)}`);
    const identity=!history?buyerIdentity(j.payload,j.received_at):null;
    if(identity)await rest('rpc/sync_marketplace_customer_identity',{...identity,p_source_event_id:j.event_id});
    ok=true;
   }else{const result=await rest('rpc/process_marketplace_webhook_event',{p_event_id:j.event_id});ok=result==='processed';if(!ok)error=`PROCESS_${result}`;}
  }catch(e){error=e instanceof Error?e.message:'RECOVERY_FAILED';}
  await rest('rpc/finish_marketplace_recovery',{p_event_id:j.event_id,p_lease_id:j.lease_id,p_ok:ok,p_error:error});results.push({event_id:j.event_id,ok,error});}
  if(b.finance!==false&&await rest('rpc/claim_marketplace_finance_run',{})){
   EdgeRuntime.waitUntil(fetch(`${U}/functions/v1/shopee-financial-enrich`,{method:'POST',headers:{apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json'},body:JSON.stringify({limit:10,claimed:true}),signal:AbortSignal.timeout(55000)}).catch(()=>undefined));
  }
  return out({ok:true,claimed:results.length,processed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length});
 }catch{return out({ok:false,error:'RECOVERY_WORKER_FAILED'},503);}
});
