import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const U=Deno.env.get('SUPABASE_URL')||'';
const K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type,x-wasapflow-signature,x-wasapflow-event'};
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...C,'content-type':'application/json'}});
function n(p:any){const v=String(p||'').replace(/\D/g,'');if(!v)return'';if(v.startsWith('60'))return v;if(v.startsWith('0'))return`6${v}`;if(v.startsWith('1'))return`60${v}`;return v}
async function r(path:string,opt:any={}){const x=await fetch(`${U}/rest/v1/${path}`,{...opt,headers:{apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json',prefer:'return=representation',...(opt.headers||{})}});const body=await x.text();let data:any=null;try{data=body?JSON.parse(body):null}catch{data=body}if(!x.ok)throw new Error(`REST ${x.status}: ${typeof data==='string'?data:JSON.stringify(data)}`);return data}
async function setting(key:string){const a=await r(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&limit=1`)||[];const z=a[0]||{};return z.secret_value||z.text_value||z.value?.url||''}
async function privateSetting(key:string){const a=await r(`private_runtime_settings?setting_key=eq.${encodeURIComponent(key)}&limit=1`)||[];return a[0]?.setting_value||''}
async function hmac(raw:string,secret:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw));return`sha256=${[...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('')}`}
function rawMsg(d:any){return d?.raw?.message||d?.message||{}}
function buttonId(d:any){const m=rawMsg(d);return String(m?.button?.payload||m?.interactive?.button_reply?.id||d?.interactive?.button_reply?.id||d?.button_reply?.id||d?.button?.payload||d?.button?.id||d?.reply?.id||'').trim()}
function messageText(d:any){const m=rawMsg(d);return String(d?.text||d?.body||m?.text?.body||m?.button?.text||m?.interactive?.button_reply?.title||d?.interactive?.button_reply?.title||d?.button_reply?.title||'').trim()}
function msgType(d:any){const m=rawMsg(d);return String(d?.type||m?.type||'text')}
function fromPhone(d:any){const m=rawMsg(d);return n(d?.from||m?.from||'')}
async function contact(phone:string,name=''){const p=n(phone);let a=await r(`whatsapp_contacts?normalized_phone=eq.${p}&limit=1`)||[];if(a[0])return a[0];a=await r('whatsapp_contacts',{method:'POST',body:JSON.stringify({phone:p,normalized_phone:p,name,source:'wasapflow'})})||[];return a[0]}
async function adminControl(phone:string,d:any,p:any){const admin=n(await setting('admin_order_notify_phone')||'60129554732');if(n(phone)!==admin)return;const token=await privateSetting('qrpay_ai_worker_token');if(!token)return;const res=await fetch(`${U}/functions/v1/admin-order-control`,{method:'POST',headers:{'content-type':'application/json','x-admin-order-token':token},body:JSON.stringify({action:'incoming',phone:n(phone),text:messageText(d),button_id:buttonId(d),raw:p})});if(!res.ok)console.error('admin-order-control',res.status,await res.text())}
async function processEvent(p:any,verified:boolean){const event=p.event||'unknown',d=p.data||{},now=new Date().toISOString(),phone=fromPhone(d)||n(d?.to||d?.recipient||'');
  try{await r('wasapflow_webhook_events',{method:'POST',body:JSON.stringify({event,waba_id:p.waba_id||null,phone_number_id:p.phone_number_id||null,provider_message_id:d.message_id||rawMsg(d)?.id||null,phone,signature_valid:verified,raw_payload:p})})}catch(e){console.error('event-log',e)}
  if(event==='message.received'){
    const from=fromPhone(d);if(!from)return;
    try{const c=await contact(from,d.contact_name||d?.raw?.contacts?.[0]?.profile?.name||'');if(c){await r(`whatsapp_contacts?id=eq.${c.id}`,{method:'PATCH',body:JSON.stringify({bsuid:d.bsuid||c.bsuid||null,last_message_at:now,last_inbound_at:now,window_expires_at:new Date(Date.now()+86400000).toISOString(),window_status:'open',unread_count:(c.unread_count||0)+1})});await r('whatsapp_messages',{method:'POST',body:JSON.stringify({contact_id:c.id,direction:'inbound',message_type:msgType(d),body:messageText(d),provider_message_id:d.message_id||rawMsg(d)?.id||null,raw_payload:p,event_type:event,status:'received'})})}}catch(e){console.error('inbound-store',e)}
    try{await adminControl(from,d,p)}catch(e){console.error('admin-control',e)}
  }
  if(['message.sent','message.delivered','message.read','message.failed'].includes(event)&&(d.message_id||rawMsg(d)?.id)){
    const mid=d.message_id||rawMsg(d)?.id,status=d.status||event.replace('message.',''),patch:any={status,updated_at:now,raw_payload:p};if(event==='message.delivered')patch.delivered_at=now;if(event==='message.read')patch.read_at=now;
    try{await r(`whatsapp_messages?provider_message_id=eq.${encodeURIComponent(mid)}`,{method:'PATCH',body:JSON.stringify(patch)})}catch(e){console.error('message-status',e)}
    try{await r(`whatsapp_outbox?provider_message_id=eq.${encodeURIComponent(mid)}`,{method:'PATCH',body:JSON.stringify({status,response_payload:p,error_message:d.errors?JSON.stringify(d.errors):null})})}catch(e){console.error('outbox-status',e)}
  }
}
Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return j({ok:false,error:'POST required'},405);try{const raw=await req.text();const sig=req.headers.get('x-wasapflow-signature')||'';const secret=await setting('webhook_secret');const verified=!secret||sig===await hmac(raw,secret);if(!verified)return j({ok:false,error:'invalid signature'},401);const p=JSON.parse(raw||'{}');const work=processEvent(p,verified);const er=(globalThis as any).EdgeRuntime;if(er?.waitUntil)er.waitUntil(work);else await work;return j({ok:true,event:p.event||'unknown'});}catch(e){console.error('wasapflow-webhook',e);return j({ok:false,error:e instanceof Error?e.message:'Server error'},500)}});
