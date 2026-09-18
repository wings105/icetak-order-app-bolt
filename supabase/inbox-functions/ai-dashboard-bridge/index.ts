// Deploy to Unified Inbox. Server-to-server only; never expose the bridge token to browsers.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const U=Deno.env.get('SUPABASE_URL')||'', K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const out=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const t=(v:unknown)=>String(v??'').trim();
const uuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t(v));
async function db(path:string,body?:unknown,method='POST') {
 const res=await fetch(`${U}/rest/v1/${path}`,{method:body===undefined?'GET':method,
 headers:{apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json',prefer:'return=representation'},
 body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await res.json().catch(()=>null);if(!res.ok)throw new Error(data?.message||`Database request failed (${res.status})`);return data;
}
async function read(id:string|null,b:any={}) {
 return await db('rpc/icetak_ai_inbox_read',{p_conversation_id:id,p_channel:b.channel||null,
 p_search:t(b.search).slice(0,100),p_offset:Math.max(0,Number(b.offset)||0),p_limit:Math.min(60,Math.max(1,Number(b.limit)||30))});
}
function phone(value:unknown){const raw=t(value);if(/^[A-Z]{2}\./i.test(raw))return '';let d=raw.replace(/\D/g,'');if(d.startsWith('0'))d='6'+d;return /^[1-9]\d{7,14}$/.test(d)?d:'';}
async function capability(){return {whatsapp_api:!!((Deno.env.get('WF_PARTNER_KEY')||Deno.env.get('WASAPFLOW_PARTNER_KEY'))&&(Deno.env.get('WF_WABA_ID')||Deno.env.get('WASAPFLOW_WABA_ID'))),shopee_api:false};}
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false,error:'POST required'},405);
 try{
  const settings=await db('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
  const expected=t(settings?.[0]?.setting_value), supplied=t(req.headers.get('x-admin-window-token'));
  if(!expected||!supplied||supplied!==expected)return out({ok:false,error:'Unauthorized'},401);
  const b=await req.json();const action=t(b.action)||'list';
  if(action==='capabilities')return out({ok:true,...await capability()});
  if(action==='list'||action==='detail'){
   if(action==='detail'&&!uuid(b.conversation_id))return out({ok:false,error:'Invalid conversation ID'},400);
   return out({ok:true,...await read(action==='detail'?b.conversation_id:null,b),capabilities:await capability()});
  }
  if(action==='semantic'){
   try{
    const model=new Supabase.ai.Session('gte-small');
    const embedding=Array.from(await model.run(t(b.text).slice(0,2500),{mean_pool:true,normalize:true}) as number[]);
    const matches=await db('rpc/match_ai_semantic_prototypes',{p_embedding:embedding,p_limit:3});
    return out({ok:true,model:'gte-small',matches});
   }catch{return out({ok:true,model:null,matches:[]});}
  }
  if(action!=='send_text')return out({ok:false,error:'Unsupported action'},400);
  if(!uuid(b.conversation_id)||!uuid(b.request_id)||!t(b.actor)||!t(b.text)||t(b.text).length>4000||b.approved!==true)
   return out({ok:false,error:'Explicit approval, identity and response required'},400);
  const existing=await db(`ai_dashboard_send_attempts?request_id=eq.${b.request_id}&select=*&limit=1`);
  if(existing?.[0]){
   const a=existing[0];if(a.conversation_id!==b.conversation_id||a.text_content!==t(b.text)||a.actor!==t(b.actor))return out({ok:false,error:'Request ID conflict'},409);
   return out({ok:a.status==='sent',duplicate:true,status:a.status,provider_message_id:a.provider_message_id,error:a.error});
  }
  const c=(await read(b.conversation_id)).rows[0];
  if(!c||c.channel!=='whatsapp')return out({ok:false,error:'WhatsApp conversation required'},422);
  const expires=Date.parse(c.window_expires_at||'')||Date.parse(c.last_inbound_at||'')+86400000;
  if(!Number.isFinite(expires)||Date.now()>=expires)return out({ok:false,error:'Tetingkap API tamat. Balas manual atau guna template diluluskan.'},409);
  const own=(c.identities||[]).filter((i:any)=>i.channel==='whatsapp');
  const phones=[...new Set(own.map((i:any)=>phone(i.phone)).filter(Boolean))];
  if(phones.length>1)return out({ok:false,error:'Identiti telefon bertindih. Semak CRM.'},409);
  const p=phones[0]||phone(c.external_customer_id);const bs=/^[A-Z]{2}\.\d+$/i.test(c.external_customer_id||'')?c.external_customer_id:null;
  if(!p&&!bs)return out({ok:false,error:'Tiada penerima yang disahkan'},422);
  const partner=Deno.env.get('WF_PARTNER_KEY')||Deno.env.get('WASAPFLOW_PARTNER_KEY');
  const waba=Deno.env.get('WF_WABA_ID')||Deno.env.get('WASAPFLOW_WABA_ID');
  if(!partner||!waba)return out({ok:false,error:'WhatsApp provider not configured'},503);
  const claim=await db('rpc/icetak_ai_claim_send',{p_request_id:b.request_id,p_conversation_id:c.id,p_actor:t(b.actor),p_text:t(b.text),p_revision:t(b.revision)});
  if(!claim.claimed)return out({ok:claim.attempt.status==='sent',duplicate:true,status:claim.attempt.status});
  const update=async(status:string,extra:any={})=>await db(`ai_dashboard_send_attempts?request_id=eq.${b.request_id}`,{status,updated_at:new Date().toISOString(),...extra},'PATCH');
  let response:Response;
  try{
   const raw=Deno.env.get('WASAPFLOW_BASE_URL')||'https://officialapi.wasapflow.com/bridge/v1';
   const base=(raw.match(/https?:\/\/[^\s"']+/)?.[0]||'https://officialapi.wasapflow.com/bridge/v1').replace(/\/$/,'');
   response=await fetch(`${base}/messages/send`,{method:'POST',headers:{'content-type':'application/json','x-partner-key':partner,'x-waba-id':waba},
    body:JSON.stringify({...p?{to:p}:{recipient:bs},text:t(b.text),preview_url:false}),signal:AbortSignal.timeout(20000)});
  }catch{
   await update('unknown',{error:'Provider response unavailable. Semak chat asal; jangan hantar semula.'});
   return out({ok:false,status:'unknown',error:'Status penghantaran tidak pasti. Semak WhatsApp asal.'},502);
  }
  const provider=await response.json().catch(()=>({}));const pid=t(provider.message_id||provider.messageId||provider.id);
  if(!response.ok||provider.success===false||provider.error){
   const uncertain=response.status>=500;await update(uncertain?'unknown':'failed',{error:`Provider rejected or uncertain (${response.status})`});
   return out({ok:false,status:uncertain?'unknown':'failed',error:'Provider tidak mengesahkan penghantaran. Semak chat asal.'},502);
  }
  if(!pid){await update('unknown',{error:'Provider returned no message ID'});return out({ok:false,status:'unknown',error:'Tiada ID mesej daripada provider. Semak chat asal.'},502);}
  await update('sent',{provider_message_id:pid});
  // Do not clear needs_reply: successful send is distinct from resolving the customer request.
  try{await db('messages',{conversation_id:c.id,channel:'whatsapp',provider_message_id:pid,direction:'outbound',sender_type:'seller',source:'admin-ai-dashboard',
   recipient_phone:p||null,recipient_bsuid:bs,message_type:'text',text_content:t(b.text),status:'sent',sent_at:new Date().toISOString()});}
  catch{return out({ok:true,status:'sent',provider_message_id:pid,warning:'Mesej dihantar; salinan inbox belum disahkan.'});}
  return out({ok:true,status:'sent',provider_message_id:pid});
 }catch(error){const message=error instanceof Error?error.message:String(error);return out({ok:false,error:message},/CHAT_CHANGED|Request ID conflict|belum disahkan/.test(message)?409:500);}
});
