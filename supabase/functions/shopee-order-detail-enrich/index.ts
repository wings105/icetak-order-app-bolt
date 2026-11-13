import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}});
const endpoint='https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-order-audit-source';
const out=(b:unknown,s=200)=>Response.json(b,{status:s,headers:{'cache-control':'no-store'}});
export function toDetail(o:any,job:any){
 if(o?.order_sn!==job.order_sn||o?.shop_id!==job.shop_id)throw Error('DETAIL_IDENTITY_MISMATCH');
 if(o.currency!==(job.shop_id==='188218638'?'MYR':'SGD'))throw Error('DETAIL_CURRENCY_MISMATCH');
 if(!Array.isArray(o.items)||o.items.length<1||o.items.length>100)throw Error('DETAIL_ITEMS_INVALID');
 if(!Number.isFinite(o.update_time)||o.update_time<=0)throw Error('DETAIL_TIMESTAMP_MISSING');
 return {order_sn:o.order_sn,shop_id:o.shop_id,currency:o.currency,order_status:o.status,
 cod:typeof o.cod==='boolean'?o.cod:null,payment_method:typeof o.payment_method==='string'?o.payment_method:null,
 pay_time:o.pay_time??null,update_time:o.update_time,
 item_list:o.items.map((i:any)=>{
  if(!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>100000||!/^\d+$/.test(i.item_id)||!i.title)throw Error('DETAIL_ITEM_INVALID');
  return {item_id:i.item_id,model_id:i.model_id,item_sku:i.sku,model_sku:i.model_sku,item_name:i.title,model_name:i.model,model_quantity_purchased:i.quantity,model_original_price:i.unit_original_price,model_discounted_price:i.unit_discounted_price,image_url:i.image_url??null};
 })};
}
async function finish(j:any,error:string,retry:boolean){
 const {error:e}=await db.rpc('finish_marketplace_order_detail_job',{p_job_id:j.job_id,p_lease_id:j.lease_id,p_ok:false,p_error:error,p_retryable:retry});
 if(e)throw Error('DETAIL_FINISH_FAILED');
}
async function run(j:any,token:string){
 try{
  const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-admin-window-token':token},body:JSON.stringify({action:'order_detail',shop_id:j.shop_id,order_sn_list:[j.order_sn]}),signal:AbortSignal.timeout(25000)});
  const b=await r.json().catch(()=>({}));
  if(!r.ok||!b.ok||!b.complete||!Array.isArray(b.orders)||b.orders.length!==1)throw Error(`DETAIL_PROVIDER_${r.status}`);
  const detail=toDetail(b.orders[0],j);
  const {data,error}=await db.rpc('apply_marketplace_order_detail',{p_job_id:j.job_id,p_lease_id:j.lease_id,p_order_id:j.order_id,p_order_sn:j.order_sn,p_shop_id:j.shop_id,p_provider_updated_at:new Date(detail.update_time*1000).toISOString(),p_detail:detail});
  if(error)throw Error(/MISMATCH|INVALID/.test(error.message)?'DETAIL_APPLY_INVALID':'DETAIL_APPLY_FAILED');
  return {order_sn:j.order_sn,ok:true,result:data};
 }catch(e){
  const msg=e instanceof Error&&/^DETAIL_[A-Z0-9_]+$/.test(e.message)?e.message:'DETAIL_READ_FAILED';
  await finish(j,msg,!/MISMATCH|INVALID|PROVIDER_40[13]/.test(msg));
  return {order_sn:j.order_sn,ok:false,error:msg};
 }
}
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 try{
  const supplied=req.headers.get('x-admin-window-token');
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!supplied&&!(service&&req.headers.get('authorization')===`Bearer ${service}`))return out({ok:false,error:'UNAUTHORIZED'},401);
  const {data:s,error:se}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','admin_window_bridge_token').single();
  if(se||!s?.setting_value)throw Error('CONFIG_UNAVAILABLE');
  if(supplied!==s.setting_value&&!(service&&req.headers.get('authorization')===`Bearer ${service}`))return out({ok:false,error:'UNAUTHORIZED'},401);
  const raw=await req.text();if(raw.length>2000)return out({ok:false,error:'PAYLOAD_TOO_LARGE'},413);
  const b=raw.trim()?JSON.parse(raw):{};
  const {data:jobs,error}=await db.rpc('claim_marketplace_order_detail_jobs',{p_limit:Math.max(1,Math.min(10,Math.floor(Number(b.limit)||10)))});
  if(error)throw Error('DETAIL_CLAIM_FAILED');
  const results=await Promise.all((jobs||[]).map((j:any)=>run(j,s.setting_value)));
  return out({ok:results.every((r:any)=>r.ok),claimed:results.length,results});
 }catch{return out({ok:false,error:'DETAIL_WORKER_FAILED'},503);}
});
