// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const db=createClient(U,K,{auth:{persistSession:false}});
const H={'content-type':'application/json'};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
async function secret(k:string){const{data}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key',k).maybeSingle();return String(data?.setting_value||'').trim()}
Deno.serve(async req=>{
  if(req.method!=='POST')return out({ok:false,error:'POST required'},405);
  const token=req.headers.get('x-admin-order-token')||'';
  if(!token||token!==await secret('qrpay_ai_worker_token'))return out({ok:false,error:'Unauthorized'},401);
  try{
    // Production publisher must never read unapproved development/main source.
    const src='https://raw.githubusercontent.com/wings105/icetak-order-app-bolt/production/public/qrpay-draft.html';
    const r=await fetch(src,{headers:{'cache-control':'no-cache'}});if(!r.ok)throw Error(`github_fetch_${r.status}`);const html=await r.text();
    const bucket='qrpay-admin-public';
    const {data:b}=await db.storage.getBucket(bucket);if(!b){const c=await db.storage.createBucket(bucket,{public:true,fileSizeLimit:1048576,allowedMimeTypes:['text/html']});if(c.error)throw c.error}
    else if(!b.public){const u=await db.storage.updateBucket(bucket,{public:true,fileSizeLimit:1048576,allowedMimeTypes:['text/html']});if(u.error)throw u.error}
    const up=await db.storage.from(bucket).upload('qrpay-draft.html',new Blob([html],{type:'text/html; charset=utf-8'}),{contentType:'text/html; charset=utf-8',upsert:true,cacheControl:'60'});if(up.error)throw up.error;
    const pub=db.storage.from(bucket).getPublicUrl('qrpay-draft.html');
    return out({ok:true,size:html.length,url:pub.data.publicUrl,source_branch:'production'});
  }catch(e){console.error(e);return out({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
