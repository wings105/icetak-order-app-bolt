import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {productionItem,type SourceRow} from './model.ts';
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info'};
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{...cors,'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function read(path:string){const r=await fetch(`${url}/rest/v1/${path}`,{headers:{apikey:key,authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('DATABASE_READ_FAILED');return r.json();}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 try{
  const authorization=req.headers.get('authorization');if(!authorization)return out({ok:false,error:'LOGIN_REQUIRED'},401);
  const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,authorization},signal:AbortSignal.timeout(10000)});
  const user=await r.json().catch(()=>null);if(!r.ok||!user?.id)return out({ok:false,error:'LOGIN_REQUIRED'},401);
  const admins=await read(`admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=username,role&limit=1`);
  if(!admins[0])return out({ok:false,error:'ADMIN_REQUIRED'},403);
  const perms=await read(`admin_permissions?username=eq.${encodeURIComponent(admins[0].username)}&select=permissions&limit=1`);
  const permissions=Array.isArray(perms[0]?.permissions)?perms[0].permissions:[];
  if(admins[0].role!=='owner'&&!permissions.includes('view_orders')&&!permissions.includes('approve_production'))return out({ok:false,error:'PRODUCTION_ACCESS_REQUIRED'},403);
  const response=await fetch(`${url}/rest/v1/rpc/icetak_acrylic_production_snapshot`,{method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('PRODUCTION_READ_FAILED');
  const source=await response.json();
  return out({ok:true,items:(source.rows||[]).map((row:SourceRow)=>productionItem(row)).filter(Boolean),truncated:source.truncated,read_at:new Date().toISOString()});
 }catch{return out({ok:false,error:'Data production gagal dimuat. Cuba refresh.'},503);}
});
