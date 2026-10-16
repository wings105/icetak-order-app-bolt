import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {sha256,tokenExpired} from '../_shared/shopee-direct.ts';
import {validateChange,readState,desiredMatches,expectedMatches,writeRequest} from '../_shared/product-sync.ts';
const out=(v:unknown,s=200)=>Response.json(v,{status:s,headers:{'cache-control':'no-store'}});
Deno.serve(async req=>{
 if(req.method!=='POST'||!req.headers.get('x-admin-window-token'))return out({ok:false,error:'UNAUTHORIZED'},401);
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:settings}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','admin_window_bridge_token').single();
  if(!settings?.setting_value||await sha256(settings.setting_value)!==await sha256(req.headers.get('x-admin-window-token')!))return out({ok:false,error:'UNAUTHORIZED'},401);
  const raw=await req.text();if(raw.length>1500000)return out({ok:false,error:'PAYLOAD_TOO_LARGE'},413);const b=JSON.parse(raw);const shop=String(b.shop_id||'');if(!/^\d{1,15}$/.test(shop))throw Error('SHOP_REQUIRED');
  if(b.action==='cache'){
   if(!Array.isArray(b.products)||b.products.length>30)throw Error('CACHE_LIMIT');
   const rows=b.products.map((p:any)=>{if(!/^\d+$/.test(p.item_id))throw Error('ITEM_REQUIRED');return {source_project:'icetak-order-system',source_channel:'shopee',external_product_id:`${shop}:${p.item_id}`,name:p.name,description:p.description,image_url:p.image_url,price:p.price,currency:'MYR',product_url:`https://shopee.com.my/product/${shop}/${p.item_id}`,active:true,metadata:{shop_id:shop,item_id:p.item_id,models:p.models},last_synced_at:new Date().toISOString()};});
   const {error}=await db.from('product_catalog_cache').upsert(rows,{onConflict:'source_project,source_channel,external_product_id'});if(error)throw Error('CACHE_WRITE_FAILED');return out({ok:true,count:rows.length});
  }
  const {data:c,error}=await db.rpc('icetak_shopee_chat_config',{p_action:'get',p_body:{shop_id:shop}});
  if(error||String(c?.shop_id)!==shop||!c?.partner_key||!c?.access_token||!c.enabled||tokenExpired(c))throw Error('SHOP_PRODUCT_CREDENTIALS_UNAVAILABLE');
  const request=async(path:string,payload:Record<string,unknown>,method='GET')=>{
   const allowed=['get_item_base_info','get_model_list','update_item','update_price','update_stock','update_model','unlist_item'];if(!allowed.includes(path))throw Error('INVALID_PROVIDER_ACTION');
   const apiPath='/api/v2/product/'+path,timestamp=Math.floor(Date.now()/1000).toString(),enc=new TextEncoder();
   const key=await crypto.subtle.importKey('raw',enc.encode(c.partner_key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const signature=await crypto.subtle.sign('HMAC',key,enc.encode(`${c.partner_id}${apiPath}${timestamp}${c.access_token}${shop}`));
   const sign=Array.from(new Uint8Array(signature),x=>x.toString(16).padStart(2,'0')).join('');
   const url=new URL(apiPath,c.environment==='sandbox'?'https://partner.test-stable.shopeemobile.com':'https://partner.shopeemobile.com');
   for(const [k,v] of Object.entries({partner_id:c.partner_id,timestamp,access_token:c.access_token,shop_id:shop,sign,...(method==='GET'?payload:{})}))url.searchParams.set(k,String(v));
   const r=await fetch(url,{method,headers:{'content-type':'application/json'},body:method==='POST'?JSON.stringify(payload):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});const d=await r.json();
   if(!r.ok||d.error)throw Error('SHOPEE_'+String(d.error||r.status).replace(/[^\w.-]/g,'').slice(0,90));return d.response;
  };
  if(b.action==='read'){
   const ids=b.item_ids;if(!Array.isArray(ids)||ids.length<1||ids.length>50||ids.some((x:any)=>!/^\d{1,15}$/.test(String(x))))throw Error('INVALID_ITEMS');
   const base=await request('get_item_base_info',{item_id_list:ids.join(',')});
   let models:any;if(ids.length===1&&b.models)models=await request('get_model_list',{item_id:Number(ids[0])});
   return out({ok:true,items:base?.item_list||[],models:models||null});
  }
  if(b.action!=='execute')throw Error('INVALID_ACTION');const change=validateChange(b.operation,b.desired);
  const read=async()=>{const a=await request('get_item_base_info',{item_id_list:String(b.item_id)});const item=a?.item_list?.find((x:any)=>String(x.item_id)===String(b.item_id));if(!item)throw Error('ITEM_NOT_FOUND');const m=['price','stock','model'].includes(b.operation)?await request('get_model_list',{item_id:Number(b.item_id)}):null;return readState(item,m,b.operation,change);};
  let current=await read();if(desiredMatches(current,change,b.operation))return out({ok:true,status:'verified',state:current});
  if(b.verify_only)return out({ok:true,status:'unknown',state:current});
  if(!expectedMatches(current,b.expected))return out({ok:true,status:'conflict',state:current});
  try{const w=writeRequest(String(b.item_id),b.operation,change,current);await request(w.path,w.body,'POST');}catch{return out({ok:true,status:'unknown',code:'WRITE_OUTCOME_REQUIRES_READBACK'});}
  try{current=await read();return out({ok:true,status:desiredMatches(current,change,b.operation)?'verified':'unknown',state:current});}catch{return out({ok:true,status:'unknown',code:'READBACK_REQUIRED'});}
 }catch(e){const error=String((e as Error).message);return out({ok:false,error:/^[A-Z0-9_.-]{1,120}$/i.test(error)?error:'PRODUCT_API_UNAVAILABLE'},502);}
});
