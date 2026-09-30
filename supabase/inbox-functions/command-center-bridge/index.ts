import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function rest(path:string,body?:unknown){
 const r=await fetch(`${url}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok)throw new Error('Inbox aggregate unavailable');return data;
}
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false,error:'POST required'},405);
 try{
  const rows=await rest('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
  const expected=String(rows?.[0]?.setting_value||'');
  if(!expected||req.headers.get('x-admin-window-token')!==expected)return out({ok:false,error:'Unauthorized'},401);
  const b=await req.json();
  const data=await rest('rpc/icetak_command_center_inbox',{p_from:b.from,p_to:b.to,p_source:b.source,p_reviews:b.reviews||[]});
  return out({ok:true,...data});
 }catch{return out({ok:false,error:'Inbox dashboard data unavailable'},500);}
});
