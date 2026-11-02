import {shopeeRequest} from '../_shared/shopee-direct.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
type Obj=Record<string,any>;
const BASE=Deno.env.get('SUPABASE_URL')||'',KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const HEAD={apikey:KEY,authorization:'Bearer '+KEY,'content-type':'application/json'};
const s=(x:unknown)=>String(x??'').trim();
const out=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
const FIRST='Hi,\n\nSila berikan nama & umur jika untuk topper.\n\nJika tiada, kami akan proceed dengan wording default seperti "Happy Birthday".';
const DEADLINE='we proceed to make sure receive timely. thanks';
const canonical=(v:string)=>v.replace(/\\n/g,'\n').replace(/\\"/g,'"').toLowerCase().replace(/\s+/g,' ').trim();
const acknowledgement=(v:string)=>/^(?:ok(?:ay)?|baik|noted|terima kasih(?: banyak)?|thank(?:s| you)|tq|ty|👍|🙏|✅|👌|alright|baiklah)[!.\s🙏👍👌✅]*$/i.test(v.trim());
async function db(path:string,body?:unknown,method='POST'){
 const r=await fetch(BASE+'/rest/v1/'+path,{method:body===undefined?'GET':method,headers:HEAD,
  body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const v=await r.json();if(!r.ok)throw Error('DB_'+r.status);return v;
}
function providerJSON(raw:string){
 return JSON.parse(raw.replace(/("(?:conversation_id|message_id|next_timestamp_nano|next_offset)"\s*:\s*)(\d{15,})/g,'$1"$2"'));
}
async function api(config:Obj,path:any,payload:Obj,method:'GET'|'POST'='GET'){
 const response=await shopeeRequest(config,path,payload,method);
 const v=providerJSON(await response.text());
 if(!response.ok||v.error)throw Error('SHOPEE_'+(s(v.error).replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,70)||response.status));
 return v.response||{};
}
const timestamp=(m:Obj)=>Number(m.created_timestamp||m.create_time||m.timestamp||0)*1000;
async function messageId(shop:string,id:string){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('shopee:'+shop+':'+id)));
 const h=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
}
function deadlineAt(shipBy:number){
 if(!Number.isFinite(shipBy)||shipBy<=0)return NaN;
 const day=new Date(shipBy*1000+8*3600000).toISOString().slice(0,10);
 return Date.parse(day+'T14:00:00+08:00');
}
async function inspect(input:Obj,config:Obj){
 const shop=s(input.shop_id),orderSn=s(input.order_sn),buyer=s(input.buyer_user_id);
 const detail=await api(config,'/api/v2/order/get_order_detail',{order_sn_list:orderSn,
  response_optional_fields:'buyer_user_id,buyer_username,item_list,pay_time'});
 const exact=(detail.order_list||[]).filter((o:Obj)=>s(o.order_sn)===orderSn);
 if(exact.length!==1||s(exact[0].buyer_user_id)!==buyer)throw Error('ORDER_BUYER_IDENTITY_MISMATCH');
 const order=exact[0],placedMs=Number(order.create_time)*1000;
 if(!Number.isFinite(placedMs)||placedMs<=0)throw Error('ORDER_TIME_UNAVAILABLE');
 // Provider fallback has no verified earlier order-session boundary. Only the
 // existing Inbox context reader may contribute scoped pre-order messages.
 const since=placedMs;
 const locals=await db('conversations?channel=eq.shopee&external_customer_id=eq.'+buyer+
  '&metadata->>shop_id=eq.'+shop+'&select=id,external_conversation_id&limit=2');
 if(locals.length>1)throw Error('MULTIPLE_BUYER_CONVERSATIONS');
 const cached=await db('autobrief_followup_context?shop_id=eq.'+shop+'&buyer_id=eq.'+buyer+'&select=conversation_id&limit=1');
 let cid=s(locals[0]?.external_conversation_id||cached[0]?.conversation_id),localId=s(locals[0]?.id),listComplete=false;
 if(!cid){
  let cursor='';
  for(let page=0;page<5;page++){
   const v=await api(config,'/api/v2/sellerchat/get_conversation_list',{
    direction:'older',type:'all',page_size:100,...(cursor?{next_timestamp_nano:cursor}:{})});
   const rows=v.conversations||v.conversation_list;
   if(!Array.isArray(rows))throw Error('CONVERSATION_LIST_SCHEMA_'+Object.keys(v).join('_').slice(0,100));
   const found=rows.filter((x:Obj)=>s(x.to_id||x.buyer_id||x.user_id)===buyer);
   if(found.length>1)throw Error('MULTIPLE_PROVIDER_CONVERSATIONS');
   if(found.length===1){cid=s(found[0].conversation_id);break;}
   const next=s(v.next_timestamp_nano||v.page_result?.next_timestamp_nano);
   const times=rows.map((x:Obj)=>timestamp(x.latest_message||x.last_message||{})).filter((x:number)=>x>0);
   if(rows.length<100||(times.length===rows.length&&Math.min(...times)<since)){listComplete=true;break;}
   if(!next||next===cursor)throw Error('CONVERSATION_LOOKUP_TRUNCATED');
   cursor=next;
  }
  if(!cid&&!listComplete)throw Error('CONVERSATION_LOOKUP_TRUNCATED');
 }
 let messages:Obj[]=[],historyComplete=!cid;
 if(cid){
  const one=await api(config,'/api/v2/sellerchat/get_one_conversation',{conversation_id:cid});
  const c=one.conversation||one;
  if(s(c.conversation_id)!==cid||s(c.to_id||c.buyer_id||c.user_id)!==buyer)throw Error('PROVIDER_CONVERSATION_IDENTITY_MISMATCH');
  if(!cached[0]){
   const response=await fetch(BASE+'/rest/v1/autobrief_followup_context?on_conflict=shop_id,buyer_id',{method:'POST',headers:{...HEAD,prefer:'resolution=merge-duplicates'},
    body:JSON.stringify({shop_id:shop,buyer_id:buyer,conversation_id:cid,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('CONVERSATION_CACHE_WRITE_FAILED');
  }
  let offset='';
  for(let page=0;page<5;page++){
   const v=await api(config,'/api/v2/sellerchat/get_message',{conversation_id:cid,page_size:100,...(offset?{offset}:{})});
   const rows=v.messages||v.message_list;
   if(!Array.isArray(rows))throw Error('MESSAGE_SCHEMA_'+Object.keys(v).join('_').slice(0,100));
   messages.push(...rows.filter((m:Obj)=>s(m.conversation_id)===cid&&(s(m.from_id)===buyer||s(m.to_id)===buyer)&&timestamp(m)>=since));
   const next=s(v.page_result?.next_offset||v.next_offset);
   if(rows.length<100||rows.some((m:Obj)=>timestamp(m)<since)){historyComplete=true;break;}
   if(!next||next===offset)throw Error('MESSAGE_HISTORY_TRUNCATED');
   offset=next;
  }
  if(!historyComplete)throw Error('MESSAGE_HISTORY_TRUNCATED');
 }
 const providerIds=[...new Set(messages.map(m=>s(m.message_id)))];
 if(providerIds.some(id=>!/^\d{1,40}$/.test(id)))throw Error('PROVIDER_MESSAGE_ID_INVALID');
 const localMessages=providerIds.length?await db('messages?channel=eq.shopee&provider_message_id=in.('+providerIds.join(',')+')&select=id,provider_message_id&limit=500'):[];
 const localMessageIds=new Map(localMessages.map((m:Obj)=>[s(m.provider_message_id),s(m.id)]));
 const normalized:Obj[]=[];
 for(const m of messages){
  const id=s(m.message_id),at=timestamp(m);if(!id||!Number.isFinite(at)||at<=0)throw Error('PROVIDER_MESSAGE_ID_TIME_INVALID');
  normalized.push({id:localMessageIds.get(id)||await messageId(shop,id),provider_message_id:id,conversation_id:localId||cid,
   channel:'shopee',direction:s(m.from_id)===buyer?'inbound':'outbound',is_history:false,
   message_type:s(m.message_type),text_content:s(m.content?.text),media_url:s(m.content?.image_url),
   created_at:new Date(at).toISOString()});
 }
 normalized.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
 const facts={shop_id:shop,order_sn:orderSn,buyer_user_id:buyer,placed_at:new Date(placedMs).toISOString(),
  order_status:s(order.order_status),buyer_note:s(order.message_to_seller),
  messages:normalized.map(m=>[m.provider_message_id,m.direction,m.text_content,m.media_url])};
 const revision=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(facts)))),x=>x.toString(16).padStart(2,'0')).join('');
 const deliveries=await db('autobrief_followup_deliveries?shop_id=eq.'+shop+'&order_sn=eq.'+orderSn+'&select=phase,state,request_id,provider_message_id,sent_at,updated_at,error');
 const control=await db('autobrief_followup_control?singleton=eq.true&select=enabled&limit=1');
 return {ok:true,available:true,enabled:control[0]?.enabled===true,revision,deliveries,shop_id:shop,order_sn:orderSn,buyer_user_id:buyer,
  placed_at:new Date(placedMs).toISOString(),order_status:s(order.order_status),buyer_note:s(order.message_to_seller),
  due_at:Number.isFinite(deadlineAt(Number(order.ship_by_date)))?new Date(deadlineAt(Number(order.ship_by_date))).toISOString():null,
  product_items:(order.item_list||[]).map((x:Obj)=>({sku:s(x.item_sku||x.model_sku),product_id:s(x.item_id)})),
  conversation_id:cid,local_conversation_id:localId,messages:normalized,checked_at:new Date().toISOString()};
}
async function delivery(action:string,ctx:Obj,phase:string,body:Obj={}){
 return await db('rpc/icetak_autobrief_delivery',{p_action:action,p_shop:ctx.shop_id,p_order:ctx.order_sn,p_phase:phase,
  p_body:{buyer_id:ctx.buyer_user_id,text:phase==='first'?FIRST:DEADLINE,...body}});
}
function phaseGuard(ctx:Obj,phase:string,now=Date.now()){
 if(!ctx.enabled)return 'DISABLED';
 if(!['READY_TO_SHIP','PROCESSED'].includes(ctx.order_status))return 'ORDER_NOT_FULFILLABLE';
 if(now-Date.parse(ctx.placed_at)<900000)return 'WAIT_15_MINUTES';
 if(s(ctx.buyer_note))return 'BUYER_NOTE_PRESENT';
 const inbound=ctx.messages.filter((m:Obj)=>m.direction==='inbound');
 if(phase==='first'&&inbound.some((m:Obj)=>Date.parse(m.created_at)>=Date.parse(ctx.placed_at)))return 'CUSTOMER_REPLIED';
 if(phase==='deadline'){
  const due=Date.parse(ctx.due_at||'');
  if(!Number.isFinite(due)||now<due)return 'WAIT_1400_MYT';
  if(new Date(now+28800000).toISOString().slice(0,10)!==new Date(due+28800000).toISOString().slice(0,10))return 'DEADLINE_DAY_MISMATCH';
  if(Date.parse(ctx.placed_at)>=due)return 'ORDER_AFTER_DEADLINE';
  if(inbound.some((m:Obj)=>m.message_type!=='text'||!acknowledgement(s(m.text_content))))return 'CUSTOMER_DETAIL_REQUIRES_REVIEW';
  if(!ctx.deliveries.some((d:Obj)=>d.phase==='first'&&['sent','manual'].includes(d.state)))return 'FIRST_REQUEST_NOT_RECORDED';
 }
 return '';
}
async function send(input:Obj,config:Obj){
 const ctx=await inspect(input,config),phase=s(input.phase);
 if(!['first','deadline'].includes(phase))throw Error('INVALID_PHASE');
 if(!/^(?:CN|YS)\d{3,6}(?:\s+SG)?$/i.test(s(input.target_sku))||!ctx.product_items.some((x:Obj)=>x.sku===s(input.target_sku)))throw Error('TARGET_PRODUCT_NOT_VERIFIED');
 const text=phase==='first'?FIRST:DEADLINE;
 const existing=ctx.messages.filter((m:Obj)=>m.direction==='outbound'&&m.message_type==='text'&&canonical(s(m.text_content))===canonical(text)&&
  Date.parse(m.created_at)>=Date.parse(ctx.placed_at)&&(phase==='first'||Date.parse(m.created_at)>=Date.parse(ctx.due_at||''))).at(-1);
 if(existing)return out({ok:true,delivery:await delivery('observe',ctx,phase,{provider_message_id:existing.provider_message_id,conversation_id:ctx.conversation_id,sent_at:existing.created_at}),observed:true});
 if(phase==='first'&&input.manual_followup===true)return out({ok:true,delivery:await delivery('manual',ctx,phase),manual:true});
 const previous=ctx.deliveries.find((x:Obj)=>x.phase===phase);
 if(previous&&['sent','manual','unknown','sending'].includes(previous.state))return out({ok:['sent','manual'].includes(previous.state),delivery:previous,duplicate:true});
 const reason=phaseGuard(ctx,phase);
 if(reason)return out({ok:true,skipped:true,reason});
 if(s(input.revision)!==ctx.revision)return out({ok:true,skipped:true,reason:'ORDER_OR_CHAT_CHANGED'});
 const claimed=await delivery('claim',ctx,phase);
 if(!claimed.claimed)return out({ok:['sent','manual'].includes(claimed.state),delivery:claimed,duplicate:true});
 const record=async(state:string,extra:Obj={})=>await delivery('record',ctx,phase,{request_id:claimed.request_id,state,...extra});
 // All guards above use a fresh signed provider read immediately before claiming.
 // A lost/uncertain POST is never retried automatically; history can reconcile it.
 let response:Response;
 try{response=await shopeeRequest(config,'/api/v2/sellerchat/send_message',{
  to_id:Number(ctx.buyer_user_id),message_type:'text',content:{text}},'POST');}
 catch{return out({ok:false,delivery:await record('unknown',{error:'PROVIDER_RESPONSE_UNAVAILABLE'})});}
 const value=await response.text();let body:Obj;
 try{body=providerJSON(value);}catch{return out({ok:false,delivery:await record('unknown',{error:'PROVIDER_RESPONSE_INVALID'})});}
 const pid=s(body.response?.message_id||body.message_id);
 if(!response.ok||body.error){
  const state=response.status>=500?'unknown':'failed';
  return out({ok:false,delivery:await record(state,{error:'SHOPEE_'+(s(body.error).replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,70)||response.status)})});
 }
 if(!pid)return out({ok:false,delivery:await record('unknown',{error:'PROVIDER_MESSAGE_ID_MISSING'})});
 return out({ok:true,delivery:await record('sent',{provider_message_id:pid})});
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 try{
  const token=await db('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
  if(!req.headers.get('x-admin-window-token')||req.headers.get('x-admin-window-token')!==token[0]?.setting_value)return out({ok:false,error:'UNAUTHORIZED'},401);
  const input=await req.json(),shop=s(input.shop_id),order=s(input.order_sn),buyer=s(input.buyer_user_id);
  if(!/^\d{1,20}$/.test(shop)||!/^\d{1,15}$/.test(buyer)||!Number.isSafeInteger(Number(buyer))||!Number(buyer)||!/^[A-Z0-9]{10,24}$/.test(order))return out({ok:false,error:'INVALID_IDENTITY'},400);
  if(!['inspect','send'].includes(input.action))return out({ok:false,error:'UNSUPPORTED_ACTION'},400);
  const configRows=await db('private_runtime_settings?setting_key=eq.'+encodeURIComponent(shop==='188218638'?'shopee_chat_direct_config':'shopee_chat_direct_config:'+shop)+'&select=setting_value&limit=1');
  const config=JSON.parse(s(configRows[0]?.setting_value)||'{}');
  if(!config.enabled||s(config.shop_id)!==shop||config.environment!=='production'||!config.access_token||!config.partner_key)throw Error('SHOP_CONFIG_UNAVAILABLE');
  if(input.action==='send')return await send(input,config);
  return out(await inspect(input,config));
 }catch(e){return out({ok:false,available:false,error:s(e instanceof Error?e.message:e).slice(0,180)},503);}
});
