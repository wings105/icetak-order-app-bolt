import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','cache-control':'no-store'};
const out=(v:unknown,s=200)=>Response.json(v,{status:s,headers:cors});
async function read(path:string){const r=await fetch(`${U}/rest/v1/${path}`,{headers:{apikey:K,authorization:`Bearer ${K}`},signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('DATABASE_UNAVAILABLE');return r.json();}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 try{
  const authorization=req.headers.get('authorization');if(!authorization)return out({ok:false,error:'LOGIN_REQUIRED'},401);
  const auth=await fetch(`${U}/auth/v1/user`,{headers:{apikey:K,authorization},signal:AbortSignal.timeout(8000)});
  const user=await auth.json().catch(()=>null);if(!auth.ok||!user?.id)return out({ok:false,error:'LOGIN_REQUIRED'},401);
  const [admin]=await read(`admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=username,role&limit=1`);
  if(!admin)return out({ok:false,error:'ADMIN_REQUIRED'},403);
  const [perm]=await read(`admin_permissions?username=eq.${encodeURIComponent(admin.username)}&select=permissions&limit=1`);
  const permissions=Array.isArray(perm?.permissions)?perm.permissions:[],manage=admin.role==='owner'||permissions.includes('manage_admins');
  if(!manage&&!permissions.includes('view_orders'))return out({ok:false,error:'AUTOMATION_ACCESS_REQUIRED'},403);
  const raw=await req.text();if(raw.length>16000)return out({ok:false,error:'PAYLOAD_TOO_LARGE'},413);
  const b=JSON.parse(raw),action=String(b.action||'snapshot');
  if(!['snapshot','detail','preview','save','retry'].includes(action))return out({ok:false,error:'INVALID_ACTION'},400);
  if(['save','retry'].includes(action)&&!manage)return out({ok:false,error:'MANAGE_AUTOMATION_REQUIRED'},403);
  const [setting]=await read('private_runtime_settings?setting_key=eq.qrpay_ai_worker_token&select=setting_value&limit=1');
  if(!setting?.setting_value)throw Error('AUTOMATION_NOT_CONFIGURED');
  const response=await fetch('https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/automation-engine',{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-automation-token':setting.setting_value},body:JSON.stringify({action,payload:b.payload||{},actor:admin.username}),signal:AbortSignal.timeout(25000)});
  const data=await response.json().catch(()=>({}));
  const draftId=data?.data?.run?.result?.draft_id;
  // Resolve an exact review capability only for managers after the run was read through the private gateway.
  // Never store review capabilities in the automation ledger or expose them in list snapshots.
  if(action==='detail'&&response.ok&&manage&&/^[0-9a-f-]{36}$/i.test(String(draftId||''))){
   const [draft]=await read(`qrpay_order_drafts?id=eq.${encodeURIComponent(draftId)}&select=review_token&limit=1`);
   if(draft?.review_token)data.data.run.result.review_url=`/qrpay-draft.html?token=${encodeURIComponent(draft.review_token)}`;
  }
  return out({...data,can_manage:manage},response.status);
 }catch{return out({ok:false,error:'AUTOMATION_UNAVAILABLE'},503);}
});
