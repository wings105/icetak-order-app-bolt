import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const out=(body:unknown,status=200)=>Response.json(body,{status});
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return out({ok:false,error:'POST required'},405);
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:settings,error:authError}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','admin_window_bridge_token').limit(1);
  const key=settings?.[0]?.setting_value;
  if(authError||!key||req.headers.get('x-admin-window-token')!==key)return out({ok:false,error:'Unauthorized'},401);
  const raw=await req.text();if(raw.length>30000)return out({ok:false,error:'Payload too large'},413);
  let b;try{b=JSON.parse(raw)}catch{return out({ok:false,error:'JSON required'},400)}
  const {data,error}=await db.rpc('icetak_log_order_whatsapp_outbound',{p_body:b});
  if(error){const code=['IDENTITY_AMBIGUOUS','IDENTITY_NOT_FOUND','CONVERSATION_NOT_FOUND','MESSAGE_IDENTITY_CONFLICT','INVALID_OUTBOUND'].find(x=>error.message.includes(x));return out({ok:false,error:code||'LOG_FAILED'},code?422:500);}
  return out({ok:true,...data});
 }catch{return out({ok:false,error:'LOG_FAILED'},500);}
});
