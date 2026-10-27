import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const json=(x:unknown,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
 if(req.method!=='POST')return json({ok:false},405);
 try{
  const key=req.headers.get('x-admin-window-token');if(!key)return json({ok:false},401);
  const {data:s}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','admin_window_bridge_token').single();
  if(!s?.setting_value||await hash(key)!==await hash(s.setting_value))return json({ok:false},401);
  const now=Math.floor(Date.now()/1000),all:any[]=[];let reads=0;
  for(const shop of ['188218638','1635364464']){
   const {data:c,error}=await db.rpc('icetak_shopee_chat_config',{p_action:'get',p_body:{shop_id:shop}});
   if(error||String(c?.shop_id)!==shop||!c?.enabled||!c?.partner_key||!c?.access_token)throw Error('SHOP_NOT_CONNECTED_'+shop);
   const api=async(path:string,params:any)=>{
    if(++reads>250)throw Error('PROVIDER_READ_LIMIT');
    const ts=Math.floor(Date.now()/1000).toString(),enc=new TextEncoder();
    const k=await crypto.subtle.importKey('raw',enc.encode(c.partner_key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const sign=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(c.partner_id+path+ts+c.access_token+shop))),x=>x.toString(16).padStart(2,'0')).join('');
    const u=new URL(path,'https://partner.shopeemobile.com');
    for(const [k,v] of Object.entries({partner_id:c.partner_id,timestamp:ts,access_token:c.access_token,shop_id:shop,sign,...params}))u.searchParams.set(k,String(v));
    const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(15000)});const j=await r.json();
    if(!r.ok||j.error||!j.response)throw Error('SHOPEE_'+String(j.error||r.status).replace(/[^\w.-]/g,'').slice(0,90));return j.response;
   };
   const found=new Map();
   for(let win=0;win<6;win++){
    const pages=await Promise.all(['READY_TO_SHIP','PROCESSED'].map(async status=>{
     let cursor='';const rows=[];
     for(let p=0;p<30;p++){
      const d=await api('/api/v2/order/get_order_list',{time_range_field:'create_time',time_from:now-(win+1)*1296000,time_to:now-win*1296000,page_size:100,order_status:status,response_optional_fields:'order_status',cursor});
      if(!Array.isArray(d.order_list))throw Error('INVALID_ORDER_LIST');rows.push(...d.order_list);
      if(!d.more)return rows;if(!d.next_cursor||d.next_cursor===cursor)throw Error('INVALID_ORDER_CURSOR');cursor=d.next_cursor;
     }throw Error('ORDER_PAGINATION_LIMIT');
    }));for(const o of pages.flat())found.set(o.order_sn,o);
   }
   const ids=[...found.keys()];for(let i=0;i<ids.length;i+=50){
    const d=await api('/api/v2/order/get_order_detail',{order_sn_list:ids.slice(i,i+50).join(','),response_optional_fields:'item_list,order_status'});
    if(!Array.isArray(d.order_list)||d.order_list.length!==ids.slice(i,i+50).length)throw Error('ORDER_DETAIL_INCOMPLETE');
    for(const o of d.order_list){if(!Array.isArray(o.item_list)||!o.item_list.length)throw Error('ITEM_DETAIL_MISSING');
     if(!['READY_TO_SHIP','PROCESSED'].includes(o.order_status))continue;
     all.push({order_sn:o.order_sn,shop_id:shop,status:o.order_status,create_time:o.create_time,update_time:o.update_time,items:o.item_list.map((x:any)=>({item_id:String(x.item_id),sku:x.item_sku||'',model_sku:x.model_sku||'',model:x.model_name||'',title:x.item_name||'',quantity:x.model_quantity_purchased}))});
    }
   }
  }
  return json({ok:true,complete:true,checked_at:new Date().toISOString(),window_days:90,shops:['188218638','1635364464'],provider_reads:reads,orders:all});
 }catch(e){const code=String((e as Error).message);return json({ok:false,error:/^[\w.-]{1,130}$/.test(code)?code:'SHOPEE_AUDIT_UNAVAILABLE'},503);}
});
