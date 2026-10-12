import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info'};
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{...cors,'cache-control':'no-store'}});
async function read(path:string){const r=await fetch(`${U}/rest/v1/${path}`,{headers:{apikey:K,authorization:`Bearer ${K}`},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('DATABASE_READ_FAILED');return await r.json();}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 try{
  const authorization=req.headers.get('authorization');if(!authorization)return out({ok:false,error:'LOGIN_REQUIRED'},401);
  const auth=await fetch(`${U}/auth/v1/user`,{headers:{apikey:K,authorization},signal:AbortSignal.timeout(10000)});const user=await auth.json().catch(()=>null);if(!auth.ok||!user?.id)return out({ok:false,error:'LOGIN_REQUIRED'},401);
  const admins=await read(`admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=username,role&limit=1`);const admin=admins[0];if(!admin)return out({ok:false,error:'ADMIN_REQUIRED'},403);
  const perms=await read(`admin_permissions?username=eq.${encodeURIComponent(admin.username)}&select=permissions&limit=1`);const permissions=perms?.[0]?.permissions||[],owner=admin.role==='owner';
  if(!owner&&!permissions.includes('view_orders'))return out({ok:false,error:'ORDER_ACCESS_REQUIRED'},403);
  const raw=await req.text();if(raw.length>8000)return out({ok:false,error:'PAYLOAD_TOO_LARGE'},413);const b=JSON.parse(raw);const action=String(b.action||'snapshot');
  if(!['snapshot','retry','resolve_alert'].includes(action))return out({ok:false,error:'INVALID_ACTION'},400);
  if(action!=='snapshot'&&!owner&&!permissions.includes('manage_orders'))return out({ok:false,error:'MANAGE_ORDER_ACCESS_REQUIRED'},403);
  const filter=b.filter&&typeof b.filter==='object'&&!Array.isArray(b.filter)?b.filter:{};
  if(filter.shop_id&&!/^[1-9][0-9]{0,14}$/.test(String(filter.shop_id)))return out({ok:false,error:'INVALID_SHOP'},400);
  const r=await fetch(`${U}/rest/v1/rpc/marketplace_operations`,{method:'POST',headers:{apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json'},body:JSON.stringify({p_action:action,p_filter:filter,p_actor:admin.username}),signal:AbortSignal.timeout(25000)});
  const data=await r.json().catch(()=>null);if(!r.ok)return out({ok:false,error:'OPERATIONS_REQUEST_FAILED'},400);
  if(action==='snapshot'&&!owner&&!permissions.includes('view_finance')){data.finance=[];data.finance_jobs=[];data.finance_worker=[];}
  return out({ok:true,data,can_manage:owner||permissions.includes('manage_orders')});
 }catch{return out({ok:false,error:'OPERATIONS_UNAVAILABLE'},503);}
});
