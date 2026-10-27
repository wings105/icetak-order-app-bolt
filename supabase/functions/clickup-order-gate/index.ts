import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function db(path:string,body?:unknown){
 const r=await fetch(U+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const d=await r.json().catch(()=>null);if(!r.ok)throw Error('DATABASE_UNAVAILABLE');return d;
}
Deno.serve(async req=>{
 if(req.method==='GET')return out({ok:true,service:'clickup-order-gate',version:1});
 if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 const secret=req.headers.get('x-order-gate-key')||'';
 if(secret.length<32||secret.length>200)return out({ok:false,error:'UNAUTHORIZED'},401);
 try{
  const auth=await db('rpc/clickup_order_gate',{p_action:'authorize',p_body:{},p_secret:secret});
  if(!auth?.ok)return out({ok:false,error:'UNAUTHORIZED'},401);
  if(Number(req.headers.get('content-length'))>16000)return out({ok:false,error:'PAYLOAD_TOO_LARGE'},413);
  const raw=await req.text();if(new TextEncoder().encode(raw).length>16000)return out({ok:false,error:'PAYLOAD_TOO_LARGE'},413);
  let b:any;try{b=JSON.parse(raw);}catch{return out({ok:false,error:'INVALID_JSON'},400);}
  if(!b||typeof b!=='object'||Array.isArray(b))return out({ok:false,error:'INVALID_BODY'},400);
  const action=b.action||'claim';if(!['claim','status','set_expected','register_task','finish','fail'].includes(action))return out({ok:false,error:'INVALID_ACTION'},400);
  let verified=false;
  if(action==='register_task'){
   // Require an existing order before provider reads. The RPC validates run ownership.
   const state=await db('rpc/clickup_order_gate',{p_action:'status',p_body:b,p_secret:secret});
   if(!state?.ok)return out(state,state?.http_status||400);
   if(typeof b.clickup_task_id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(b.clickup_task_id))return out({ok:false,error:'INVALID_TASK'},400);
   const settings=await db('private_runtime_settings?setting_key=eq.clickup_designer_api_token&select=setting_value&limit=1');
   const token=settings?.[0]?.setting_value;if(!token)return out({ok:false,error:'CLICKUP_NOT_CONNECTED'},503);
   const r=await fetch('https://api.clickup.com/api/v2/task/'+encodeURIComponent(b.clickup_task_id),{headers:{authorization:token},redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!r.ok)return out({ok:false,error:'CLICKUP_VERIFY_FAILED',retryable:true},503);
   const task=await r.json();
   const order=task.custom_fields?.find((f:any)=>f.id==='a8996f77-fcf9-4804-84bb-89f97905473d')?.value;
   if(task.id!==b.clickup_task_id||!['18375902','901612769752'].includes(String(task.list?.id))||String(order||'').trim().toUpperCase()!==String(b.order_id||b.orderno||'').trim().toUpperCase())return out({ok:false,error:'TASK_ORDER_MISMATCH',retryable:true},409);
   verified=true;
  }
  const d=await db('rpc/clickup_order_gate',{p_action:action,p_body:b,p_secret:secret,p_verified:verified});
  const status=d?.http_status||200;delete d.http_status;return out(d,status);
 }catch{return out({ok:false,error:'GATE_UNAVAILABLE',retryable:true},503);}
});
