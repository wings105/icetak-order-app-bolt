import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';
const url=Deno.env.get('SUPABASE_URL')!;
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(url,key,{auth:{persistSession:false}});
const headers={'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-credit-token'};
const out=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
async function rpc(name:string,args:Record<string,unknown>={}){const r=await db.rpc(name,args);if(r.error)throw new Error(r.error.message);return r.data;}
async function setting(k:string){const r=await db.from('whatsapp_settings').select('text_value,secret_value').eq('key',k).maybeSingle();if(r.error)throw r.error;return String(r.data?.secret_value||r.data?.text_value||'');}
async function refreshAlertTemplate(){
 const name='icetak_parceldaily_credit_low_ms';
 const cached=await db.from('whatsapp_templates').select('status').eq('name',name).eq('language','ms').eq('status','APPROVED').maybeSingle();
 if(cached.data)return;
 const partner=await setting('partner_key'),waba=await setting('waba_id');
 const r=await fetch('https://officialapi.wasapflow.com/bridge/v1/templates',{headers:{'x-partner-key':partner,'x-waba-id':waba},signal:AbortSignal.timeout(10000)});
 if(!r.ok)return;const j=await r.json();const t=j.templates?.find((t:{name:string;language:string})=>t.name===name&&t.language==='ms');
 if(t){const saved=await db.from('whatsapp_templates').upsert({waba_id:waba,name,language:'ms',category:t.category,status:t.status,components:t.components||[],raw_payload:t,synced_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'waba_id,name,language'});if(saved.error)throw saved.error;}
}
async function alert(){
 if(await setting('enabled')!=='true')return;
 const a=await rpc('icetak_credit_claim_alert');if(!a)return;
 const phone=await setting('admin_order_notify_phone');
 let status='unknown',error:string|null=null,sendStarted=false;
 try{
  if(!/^601\d{8,9}$/.test(phone))throw new Error('ADMIN_PHONE_NOT_CONFIGURED');
  await refreshAlertTemplate();
  sendStarted=true;
  const r=await fetch(`${url}/functions/v1/whatsapp-send`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({event_type:'parceldaily_low_credit',mode:'auto',phone,template_name:'icetak_parceldaily_credit_low_ms',template_language:'ms',template_params:['balance'],vars:{balance:Number(a.balance).toFixed(2)},text:`⚠️ Kredit ParcelDaily rendah\nBaki: RM${Number(a.balance).toFixed(2)}\nSila topup kredit untuk penghantaran seterusnya.\nShipping & Tracking: https://shop.decocake.my/?admin=v2&view=shipping`,idempotency_key:`parceldaily-credit:${a.episode}`}),signal:AbortSignal.timeout(20000)});
  const j=await r.json();
  if(r.ok&&j.ok){status='sent';}else{status=r.status<500?'blocked':'unknown';error=String(j.error||`HTTP ${r.status}`).slice(0,300);}
 }catch(e){status=sendStarted?'unknown':'blocked';error=e instanceof Error?e.message:'SEND_RESULT_UNKNOWN';}
 await rpc('icetak_credit_alert_result',{p_episode:a.episode,p_status:status,p_error:error});
}
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return out({error:'POST_REQUIRED'},405);
 const b=await req.json().catch(()=>({}));
 try{
  const token=req.headers.get('x-credit-token');
  let internal=false;
  if(token){const r=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','qrpay_ai_worker_token').maybeSingle();internal=!!r.data?.setting_value&&token===r.data.setting_value;}
  const bearer=req.headers.get('authorization')||'';
  let actor:string|null=null;
  if(!internal){
   const user=await db.auth.getUser(bearer.replace(/^Bearer\s+/i,''));if(user.error||!user.data.user)return out({error:'UNAUTHORIZED'},401);
   actor=user.data.user.id;
   const scoped=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:bearer}},auth:{persistSession:false}});
   const permission=await scoped.rpc('icetak_admin_can_manage_shipping_messages');
   if(permission.error||permission.data!==true)return out({error:'SHIPPING_PERMISSION_REQUIRED'},403);
  }
  if(b.action==='classify'){
   if(internal||!actor)return out({error:'STAFF_REQUIRED'},403);
   await rpc('icetak_credit_classify',{p_id:b.id,p_kind:b.kind,p_reference:b.reference,p_actor:actor});
  }else if(b.action==='sync'){
   if(await rpc('icetak_credit_claim')){
    const started=new Date().toISOString();
    try{
     const base=(Deno.env.get('PARCELDAILY_BASE_URL')||'').replace(/\/$/,'');
     if(base!=='https://api.parceldaily.com')throw new Error('LIVE_PROVIDER_NOT_CONFIGURED');
     const token=Deno.env.get('PARCELDAILY_TOKEN')||'',merchantid=Deno.env.get('PARCELDAILY_MERCHANT_ID')||'';
     if(!token||!merchantid)throw new Error('PROVIDER_CREDENTIALS_MISSING');
     const r=await fetch(`${base}/v1/partner/account-info`,{headers:{token,merchantid},signal:AbortSignal.timeout(15000)});
     if(!r.ok)throw new Error(`PROVIDER_HTTP_${r.status}`);
     const j=await r.json();const raw=(j.data||j.success||j).credit;
     const balance=Number(String(raw??'').replace(/,/g,''));
     if(raw===undefined||raw===null||String(raw).trim()===''||!Number.isFinite(balance))throw new Error('INVALID_PROVIDER_BALANCE');
     const saved=await rpc('icetak_credit_snapshot',{p_balance:balance,p_started:started});
     if(!saved.retry)await alert();
    }catch(e){await rpc('icetak_credit_error',{p_error:e instanceof Error?e.message:'SYNC_FAILED'});throw e;}
   }
  }else if(b.action!=='dashboard'&&b.action!=='classify')return out({error:'UNKNOWN_ACTION'},400);
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month||'')?b.month:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit'}).format(new Date());
  return out(await rpc('icetak_credit_read',{p_month:month}));
 }catch(e){return out({error:e instanceof Error?e.message:'CREDIT_ERROR'},500);}
});
