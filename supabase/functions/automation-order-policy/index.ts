import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const out=(v:unknown,s=200)=>Response.json(v,{status:s,headers:{'cache-control':'no-store'}});
async function read(path:string){const r=await fetch(`${U}/rest/v1/${path}`,{headers:{apikey:K,authorization:`Bearer ${K}`},signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('READ_FAILED');return r.json();}
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false},405);
 try{
  const [token]=await read('private_runtime_settings?setting_key=eq.qrpay_ai_worker_token&select=setting_value&limit=1');
  if(!token?.setting_value||req.headers.get('x-automation-token')!==token.setting_value)return out({ok:false},401);
  const b=await req.json(),id=String(b.conversation_id||'');if(!/^[0-9a-f-]{36}$/i.test(id))return out({ok:false},400);
  const [master]=await read('whatsapp_settings?key=eq.enabled&select=value,text_value,secret_value&limit=1');
  const enabled=master?.secret_value||master?.text_value||master?.value;
  if(!['true','1','yes','enabled','on'].includes(String(enabled??'').trim().toLowerCase()))return out({ok:true,can_send:false,reason:'WHATSAPP_MASTER_DISABLED'});
  const [draft]=await read(`qrpay_order_drafts?conversation_id=eq.${id}&order=created_at.desc&limit=1&select=status,order_id,created_at`);
  if(draft&&['cancelled','rejected','void'].includes(draft.status)&&Date.now()-Date.parse(draft.created_at)<86400000)return out({ok:true,can_send:false,reason:'CURRENT_DRAFT_CANCELLED'});
  if(draft?.order_id&&Date.now()-Date.parse(draft.created_at)<86400000){
   const [order]=await read(`orders?id=eq.${encodeURIComponent(draft.order_id)}&select=whatsapp_opt_in,status&limit=1`);
   if(order?.whatsapp_opt_in===false)return out({ok:true,can_send:false,reason:'ORDER_OPTED_OUT'});
  }
  return out({ok:true,can_send:true});
 }catch{return out({ok:false,can_send:false,reason:'SEND_POLICY_UNAVAILABLE'},503);}
});
