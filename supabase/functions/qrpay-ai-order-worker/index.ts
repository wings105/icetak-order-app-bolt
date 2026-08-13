// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}});
const TARGET='https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/qrpay-ai-order-worker';
const H={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type,x-qrpay-ai-token','cache-control':'no-store'};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
async function token(){const q=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','qrpay_ai_worker_token').maybeSingle();return String(q.data?.setting_value||'')}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:H});
  if(req.method!=='POST')return out({ok:false,error:'POST required'},405);
  const expected=await token(),given=req.headers.get('x-qrpay-ai-token')||'';
  if(!expected||given!==expected)return out({ok:false,error:'Unauthorized'},401);
  const body=await req.text();
  const r=await fetch(TARGET,{method:'POST',headers:{'content-type':'application/json','x-qrpay-ai-token':expected},body:body||'{}'});
  const text=await r.text();
  return new Response(text,{status:r.status,headers:H});
});
