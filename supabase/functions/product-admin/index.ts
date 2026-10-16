import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {validateChange,readState} from '../_shared/product-sync.ts';
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info'};
const out=(v:unknown,s=200)=>Response.json(v,{status:s,headers:{...cors,'cache-control':'no-store'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');const {data:u,error:ae}=await db.auth.getUser(token);if(ae||!u?.user)return out({ok:false,error:'LOGIN_REQUIRED'},401);
  const {data:admin}=await db.from('admin_users').select('username,role').eq('auth_user_id',u.user.id).eq('is_active',true).maybeSingle();if(!admin)return out({ok:false,error:'ADMIN_REQUIRED'},403);
  const {data:permissions}=await db.from('admin_permissions').select('permissions').eq('username',admin.username).maybeSingle();const owner=admin.role==='owner';
  if(!owner&&!permissions?.permissions?.includes('view_orders')&&!permissions?.permissions?.includes('approve_production'))return out({ok:false,error:'CATALOG_ACCESS_REQUIRED'},403);
  const raw=await req.text();if(raw.length>1500000)return out({ok:false,error:'PAYLOAD_TOO_LARGE'},413);const b=JSON.parse(raw),action=String(b.action||'list');
  if(!['list','detail','import','complete_import','save','queue','process','close_job','refresh','cache'].includes(action))throw Error('INVALID_ACTION');
  if(!['list','detail'].includes(action)&&!owner)return out({ok:false,error:'OWNER_REQUIRED'},403);
  const call=async(name:string,args:any)=>{const {data,error}=await db.rpc(name,args);if(error)throw Error(error.message);return data;};
  const bridge=async(payload:any)=>{const {data:s}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','admin_window_bridge_token').single();if(!s?.setting_value)throw Error('PRODUCT_BRIDGE_REQUIRED');const r=await fetch('https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-product-api',{method:'POST',headers:{'content-type':'application/json','x-admin-window-token':s.setting_value},body:JSON.stringify(payload),signal:AbortSignal.timeout(55000)});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'PRODUCT_BRIDGE_FAILED');return d;};
  const body=b.payload||{};let data:any;
  if(action==='close_job'){
   if(body.acknowledge!==true)throw Error('ACKNOWLEDGEMENT_REQUIRED');data=await call('icetak_product_job',{p_id:body.id,p_action:'close',p_result:{actor:admin.username}});
  }else if(action==='process'){
   const c=await call('icetak_product_job',{p_id:body.id,p_action:'claim'});if(!c.job)return out({ok:true,data:c,is_owner:owner});
   let result:any;try{result=await bridge({action:'execute',shop_id:c.listing.shop_id,item_id:c.listing.item_id,operation:c.job.action,desired:c.job.desired.patch,expected:c.job.desired.expected,verify_only:c.verify_only});}catch{result={status:'unknown',code:'PROVIDER_OUTCOME_UNKNOWN'};}
   data=await call('icetak_product_job',{p_id:body.id,p_action:'finish',p_result:result});
   if(data.status==='verified'){const {data:listing}=await db.from('product_channel_listings').select('shop_id,snapshot').eq('id',c.listing.id).single();if(listing)try{await bridge({action:'cache',shop_id:listing.shop_id,products:[listing.snapshot]});data.cache_synced=true;}catch{data.cache_synced=false;}}
  }else if(action==='refresh'){
   if(!Array.isArray(body.listing_ids)||body.listing_ids.length<1||body.listing_ids.length>50)throw Error('REFRESH_LIMIT');
   const {data:rows,error}=await db.from('product_channel_listings').select('*').in('id',body.listing_ids);if(error||!rows?.length)throw Error('LISTINGS_REQUIRED');
   const shops=[...new Set(rows.map(x=>x.shop_id))];let count=0;
   for(const shop of shops){const subset=rows.filter(x=>x.shop_id===shop);const d=await bridge({action:'read',shop_id:shop,item_ids:subset.map(x=>x.item_id)});
    for(const item of d.items){const l=subset.find(x=>x.item_id===String(item.item_id));if(!l)continue;const snapshot={...l.snapshot,provider_item:item};const {data:changed,error}=await db.from('product_channel_listings').update({provider_status:item.item_status||'UNKNOWN',snapshot,revision:l.revision+1,last_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',l.id).eq('revision',l.revision).select('id');if(error||changed?.length!==1)throw Error('LISTING_CHANGED_RELOAD');count++;}
   }data={refreshed:count};
  }else if(action==='cache'){
   const {data:rows,error}=await db.from('product_channel_listings').select('shop_id,snapshot').in('id',body.listing_ids||[]).limit(30);if(error||!rows?.length)throw Error('LISTINGS_REQUIRED');
   data=[];for(const shop of [...new Set(rows.map(x=>x.shop_id))])data.push(await bridge({action:'cache',shop_id:shop,products:rows.filter(x=>x.shop_id===shop).map(x=>x.snapshot)}));
  }else{
   if(action==='queue'){
    const patch=validateChange(body.operation,body.desired);const {data:l}=await db.from('product_channel_listings').select('*').eq('id',body.listing_id).single();if(!l)throw Error('LISTING_REQUIRED');
    const d=await bridge({action:'read',shop_id:l.shop_id,item_ids:[l.item_id],models:['price','stock','model'].includes(body.operation)});const item=d.items.find((x:any)=>String(x.item_id)===l.item_id);if(!item)throw Error('ITEM_NOT_FOUND');
    if(!['NORMAL','UNLIST'].includes(item.item_status))throw Error('SHOPEE_STATUS_NOT_EDITABLE');
    body.desired={patch,expected:readState(item,d.models,body.operation,patch)};
   }
   data=await call('icetak_product_admin',{p_action:action,p_body:body,p_actor:admin.username});
   if(action==='import'){try{await bridge({action:'cache',shop_id:body.shop_id,products:body.products});data.cache_synced=true;}catch{data.cache_synced=false;}}
  }
  return out({ok:true,data,is_owner:owner});
 }catch(e){return out({ok:false,error:String((e as Error).message).slice(0,180)},400);}
});
