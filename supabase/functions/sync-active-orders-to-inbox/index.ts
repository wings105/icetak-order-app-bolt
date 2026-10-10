import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const out=(body:unknown,status=200)=>Response.json(body,{status});
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return out({ok:false,error:'POST required'},405);
 const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 if(req.headers.get('Authorization')!==`Bearer ${key}`&&req.headers.get('apikey')!==key)return out({ok:false,error:'Service authentication required'},401);
 const db=createClient(url,key,{auth:{persistSession:false}});
 const body=await req.json().catch(()=>({}));
 let q=db.from('active_order_summary').select('order_system_order_id').order('order_no').range(Math.max(0,Number(body.offset)||0),Math.max(0,Number(body.offset)||0)+Math.min(1000,Math.max(1,Number(body.limit)||500))-1);
 if(body.only_active!==false)q=q.eq('active_order',true);
 const {data,error}=await q;if(error)return out({ok:false,error:error.message},500);
 const {data:token}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','admin_window_bridge_token').single();
 if(!token?.setting_value)return out({ok:false,error:'Inbox bridge configuration missing'},503);
 for(let n=0;n<(data||[]).length;n+=100){
  const result=await fetch(`${url}/functions/v1/order-inbox-sync-worker`,{method:'POST',headers:{'Content-Type':'application/json','x-order-sync-token':token.setting_value},body:JSON.stringify({source:'direct',order_ids:data!.slice(n,n+100).map(o=>o.order_system_order_id)}),signal:AbortSignal.timeout(60000)});
  const payload=await result.json();if(!result.ok||payload.ok!==true)return out({ok:false,error:'Inbox sync failed; durable queue remains active'},502);
 }
 return out({ok:true,pulled:data?.length||0});
});
