// Read-only cached media signing for the Order project's exact task/session brief gateway.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const base=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const headers={apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'};
const out=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
async function call(path:string,body?:unknown){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const d=await r.json();if(!r.ok)throw Error('MEDIA_UNAVAILABLE');return d;}
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false},405);
 try{
  const rows=await call('/rest/v1/private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
  const token=req.headers.get('x-admin-window-token');if(!token||token!==rows[0]?.setting_value)return out({ok:false},401);
  const input=await req.json();
  if(input.action==='buyer_note'){
   const order=String(input.order_sn||'').trim(), shop=String(input.shop_id||'').trim();
   if(!/^[0-9A-Z]{10,24}$/.test(order)||!/^[0-9]{1,20}$/.test(shop))return out({ok:false,error:'INVALID_ORDER_ID'},400);
   const configs=await call('/rest/v1/private_runtime_settings?setting_key=eq.'+
      encodeURIComponent(shop==='188218638'?'shopee_chat_direct_config':'shopee_chat_direct_config:'+shop)+
      '&select=setting_value&limit=1');
   const config=JSON.parse(String(configs?.[0]?.setting_value||'{}'));
   if(config.enabled!==true||String(config.shop_id)!==shop||config.environment!=='production'
    ||!config.partner_id||!config.partner_key||!config.access_token)return out({ok:true,available:false,reason:'SHOPEE_CONFIG_UNAVAILABLE'});
   const path='/api/v2/order/get_order_detail',time=Math.floor(Date.now()/1000),partner=String(config.partner_id);
   const keyBytes=new TextEncoder().encode(String(config.partner_key));
   const k=await crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const bytes=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(partner+path+time+String(config.access_token)+shop));
   const signature=Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('');
   const params=new URLSearchParams({partner_id:partner,timestamp:String(time),access_token:String(config.access_token),
     shop_id:shop,sign:signature,order_sn_list:order,response_optional_fields:'buyer_user_id,buyer_username'});
   const remote=await fetch('https://partner.shopeemobile.com'+path+'?'+params,{
     headers:{'accept':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)
   });
   if(!remote.ok)return out({ok:true,available:false,reason:'SHOPEE_HTTP_'+remote.status});
   const data=await remote.json();
   if(data.error)return out({ok:true,available:false,reason:'SHOPEE_PROVIDER_ERROR'});
   const matches=(data.response?.order_list||[]).filter((o:Record<string,unknown>)=>String(o.order_sn)===order);
   if(matches.length!==1)return out({ok:true,available:false,reason:'ORDER_NOT_VERIFIED'});
   return out({ok:true,available:true,order_sn:order,shop_id:shop,
      buyer_note:typeof matches[0].message_to_seller==='string'?matches[0].message_to_seller.slice(0,2000):'',
      buyer_user_id:matches[0].buyer_user_id==null?null:String(matches[0].buyer_user_id)});
  }

  if(input.action==='order_proof'){
   const order=String(input.order_sn||'').trim(),placed=String(input.placed_at||''),buyer=String(input.buyer_user_id||'').trim();
   const placedMs=Date.parse(placed);
   if(!/^[A-Z0-9]{10,24}$/.test(order)||!Number.isFinite(placedMs))
    return out({ok:false,error:'INVALID_ORDER_PROOF_INPUT'},400);
   const linked=await call('/rest/v1/conversation_order_links?order_no=eq.'+encodeURIComponent(order)+
     '&unlinked_at=is.null&select=conversation_id,match_method,match_confidence&limit=3');
   if(linked.length!==1||!['exact_order_id','buyer_id'].includes(String(linked[0].match_method))||Number(linked[0].match_confidence)<0.99)
    return out({ok:true,matched:false,reason:'NO_UNAMBIGUOUS_ORDER_LINK'});
   const conversation=String(linked[0].conversation_id);
   if(!/^[0-9a-f-]{36}$/i.test(conversation))return out({ok:true,matched:false});
   // A 99% buyer-id match is usable only if the order's actual Shopee buyer ID
   // matches the exact conversation identity, and no competing order is bound.
   if(linked[0].match_method==='buyer_id'){
    if(!/^\d{3,20}$/.test(buyer))return out({ok:true,matched:false,reason:'BUYER_ID_REQUIRED'});
    const profiles=await call('/rest/v1/conversations?id=eq.'+conversation+
      '&channel=eq.shopee&select=external_customer_id&limit=1');
    if(profiles.length!==1||String(profiles[0].external_customer_id)!==buyer)
     return out({ok:true,matched:false,reason:'BUYER_ID_MISMATCH'});
    const competing=await call('/rest/v1/external_order_summaries?shopee_buyer_id=eq.'+buyer+
      '&order_no=neq.'+encodeURIComponent(order)+'&active_order=eq.true&select=order_no&limit=2');
    if(competing.length)return out({ok:true,matched:false,reason:'COMPETING_ACTIVE_ORDER'});
   }
   const others=await call('/rest/v1/conversation_order_links?conversation_id=eq.'+conversation+
     '&unlinked_at=is.null&select=order_no&limit=10');
   if(others.some((x:{order_no:string})=>x.order_no!==order))
    return out({ok:true,matched:false,reason:'MULTIPLE_LINKED_ORDERS'});
   const from=new Date(placedMs-60*60*1000).toISOString();
   const items=await call('/rest/v1/messages?conversation_id=eq.'+conversation+
     '&direction=eq.inbound&is_history=eq.false&created_at=gte.'+encodeURIComponent(from)+
     '&select=id,conversation_id,channel,direction,text_content,caption,created_at,message_type,media_url,is_history'+
     '&order=created_at.asc&limit=100');
   return out({ok:true,matched:true,match_method:linked[0].match_method,conversation_id:conversation,messages:items});
  }
  if(input.action==='context'){
   if(!Array.isArray(input.orders)||!input.orders.length||input.orders.length>50)return out({ok:false},400);
   return out({ok:true,contexts:await call('/rest/v1/rpc/icetak_task_automation_context',{p_orders:input.orders})});
  }
  if(input.action&&input.action!=='prepare')return out({ok:false},400);
  if(input.action==='prepare'&&(!Array.isArray(input.ids)||input.ids.length>4))return out({ok:false},400);
  if(!Array.isArray(input.ids)||input.ids.length>20||input.ids.some((x:unknown)=>typeof x!=='string'||!/^\d{1,40}$/.test(x)))return out({ok:false},400);
  const media:Record<string,unknown>={};
  await Promise.all([...new Set<string>(input.ids)].map(async id=>{
   let cached=await call(`/rest/v1/message_media?provider_media_id=eq.${id}&download_status=eq.ready&select=storage_path,mime_type&order=updated_at.desc&limit=1`);
   if(!cached[0]&&input.action==='prepare'){
    // Only the selected task's gateway supplies IDs. No list poll or background mass recovery.
    if(input.ids.length>4)throw Error('PREPARE_LIMIT');
    const attempts=await call(`/rest/v1/message_media?provider_media_id=eq.${id}&select=download_status,updated_at&order=updated_at.desc&limit=1`);
    const recentFailure=attempts[0]?.download_status==='failed'&&Date.now()-Date.parse(attempts[0]?.updated_at)<300000;
    if(!recentFailure){try{
     const response=await fetch(base+'/functions/v1/wasapflow-media?id='+id,{headers:{'x-admin-window-token':token},signal:AbortSignal.timeout(15000)});
     await response.body?.cancel();
     if(response.ok)cached=await call(`/rest/v1/message_media?provider_media_id=eq.${id}&download_status=eq.ready&select=storage_path,mime_type&order=updated_at.desc&limit=1`);
    }catch{/* Return an explicit unavailable asset; never hide the rest of the task. */}}
   }
   const file=cached[0];if(!file?.storage_path||!/^image\/(?:png|jpeg|webp|gif)$/i.test(file.mime_type||'')){media['wasapflow-media://'+id]={available:false};return;}
   const signed=await call('/storage/v1/object/sign/whatsapp-media/'+String(file.storage_path).split('/').map(encodeURIComponent).join('/'),{expiresIn:900});
   media['wasapflow-media://'+id]={available:true,url:base+'/storage/v1'+signed.signedURL};
  }));
  return out({ok:true,media});
 }catch{return out({ok:false,error:'MEDIA_UNAVAILABLE'},503);}
});
