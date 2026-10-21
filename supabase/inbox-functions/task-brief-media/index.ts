// Read-only cached media signing for the Order project's exact task/session brief gateway.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const base=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const headers={apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'};
const out=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
async function call(path:string,body?:unknown){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const d=await r.json();if(!r.ok)throw Error('MEDIA_UNAVAILABLE');return d;}
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false},405);
 try{
  const rows=await call('/rest/v1/private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
  const token=req.headers.get('x-admin-window-token');if(!token||token!==rows[0]?.setting_value)return out({ok:false},401);
  const input=await req.json();
  if(input.action==='context'){
   if(!Array.isArray(input.orders)||!input.orders.length||input.orders.length>50)return out({ok:false},400);
   return out({ok:true,contexts:await call('/rest/v1/rpc/icetak_task_automation_context',{p_orders:input.orders})});
  }
  if(input.action&&input.action!=='prepare')return out({ok:false},400);
  if(input.action==='prepare'&&(!Array.isArray(input.ids)||input.ids.length>4))return out({ok:false},400);
  if(!Array.isArray(input.ids)||input.ids.length>20||input.ids.some((x:unknown)=>typeof x!=='string'||!/^\d{1,40}$/.test(x)))return out({ok:false},400);
  const media:Record<string,unknown>={};
  await Promise.all([...new Set<string>(input.ids)].map(async id=>{
   let cached=await call(`/rest/v1/message_media?provider_media_id=eq.${id}&download_status=eq.ready&select=storage_path,mime_type&order=updated_at.desc&limit=1`);
   if(!cached[0]&&input.action==='prepare'){
    // Only the selected task's gateway supplies IDs. No list poll or background mass recovery.
    if(input.ids.length>4)throw Error('PREPARE_LIMIT');
    const attempts=await call(`/rest/v1/message_media?provider_media_id=eq.${id}&select=download_status,updated_at&order=updated_at.desc&limit=1`);
    const recentFailure=attempts[0]?.download_status==='failed'&&Date.now()-Date.parse(attempts[0]?.updated_at)<300000;
    if(!recentFailure){try{
     const response=await fetch(base+'/functions/v1/wasapflow-media?id='+id,{headers:{'x-admin-window-token':token},signal:AbortSignal.timeout(15000)});
     await response.body?.cancel();
     if(response.ok)cached=await call(`/rest/v1/message_media?provider_media_id=eq.${id}&download_status=eq.ready&select=storage_path,mime_type&order=updated_at.desc&limit=1`);
    }catch{/* Return an explicit unavailable asset; never hide the rest of the task. */}}
   }
   const file=cached[0];if(!file?.storage_path||!/^image\/(?:png|jpeg|webp|gif)$/i.test(file.mime_type||'')){media['wasapflow-media://'+id]={available:false};return;}
   const signed=await call('/storage/v1/object/sign/whatsapp-media/'+String(file.storage_path).split('/').map(encodeURIComponent).join('/'),{expiresIn:900});
   media['wasapflow-media://'+id]={available:true,url:base+'/storage/v1'+signed.signedURL};
  }));
  return out({ok:true,media});
 }catch{return out({ok:false,error:'MEDIA_UNAVAILABLE'},503);}
});
