import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info'};
const out=(data:unknown,status=200)=>Response.json(data,{status,headers:{...cors,'cache-control':'no-store'}});
const actions=new Set(['snapshot','opening','purchase','manual_use','waste','adjustment','material_save','size_rule','item_rule','retry','exclude','resolve_issue','settings']);
async function read(path:string){
 const r=await fetch(`${url}/rest/v1/${path}`,{headers:{apikey:key,authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('DATABASE_READ_FAILED');return await r.json();
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 try{
  const authorization=req.headers.get('authorization');if(!authorization)return out({ok:false,error:'LOGIN_REQUIRED'},401);
  const auth=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,authorization},signal:AbortSignal.timeout(10000)});
  const user=await auth.json().catch(()=>null);if(!auth.ok||!user?.id)return out({ok:false,error:'LOGIN_REQUIRED'},401);
  const rows=await read(`admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=username,role&limit=1`);
  const admin=rows[0];if(!admin)return out({ok:false,error:'ADMIN_REQUIRED'},403);
  const perms=await read(`admin_permissions?username=eq.${encodeURIComponent(admin.username)}&select=permissions&limit=1`);
  const permissions=Array.isArray(perms[0]?.permissions)?perms[0].permissions:[];
  const owner=admin.role==='owner',manage=owner||permissions.includes('manage_orders');
  if(!owner&&!permissions.includes('view_orders')&&!permissions.includes('approve_production'))return out({ok:false,error:'STOCK_ACCESS_REQUIRED'},403);
  const text=await req.text();if(text.length>12000)return out({ok:false,error:'PAYLOAD_TOO_LARGE'},413);
  const body=JSON.parse(text);const action=String(body.action||'snapshot');
  if(!actions.has(action))return out({ok:false,error:'INVALID_ACTION'},400);
  if(action!=='snapshot'&&!manage)return out({ok:false,error:'MANAGE_STOCK_REQUIRED'},403);
  if(action==='settings'&&!owner)return out({ok:false,error:'OWNER_REQUIRED'},403);
  const payload=body.payload&&typeof body.payload==='object'&&!Array.isArray(body.payload)?body.payload:{};
  if(action!=='snapshot'&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(payload.request_id||'')))return out({ok:false,error:'REQUEST_ID_REQUIRED'},400);
  const r=await fetch(`${url}/rest/v1/rpc/icetak_stock_admin`,{method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},
   body:JSON.stringify({p_action:action,p_payload:payload,p_actor:admin.username}),signal:AbortSignal.timeout(20000)});
  const data=await r.json().catch(()=>null);
  if(!r.ok)return out({ok:false,error:String(data?.message||'STOCK_REQUEST_FAILED').slice(0,200)},400);
  if(action==='snapshot'&&!owner&&Array.isArray(data?.movements))for(const row of data.movements)delete row.cost;
  return out({ok:true,data,can_manage:manage,is_owner:owner});
 }catch{return out({ok:false,error:'STOCK_UNAVAILABLE'},503);}
});
