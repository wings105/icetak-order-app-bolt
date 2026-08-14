import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const headers={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type,x-ap-secret','cache-control':'no-store'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const text=(v:unknown)=>v==null?'':String(v).trim();
const trimSlash=(v:string)=>v.replace(/\/+$/,'');
const BSUID_RE=/^[A-Z]{2}\.\d+$/i;
const digits=(v:unknown)=>{const raw=text(v);if(!raw||BSUID_RE.test(raw))return'';return raw.replace(/\D/g,'')};
const whatsapp=(phone:unknown,username:unknown='')=>{const u=text(username).replace(/^@+/,'');if(u)return`https://wa.me/@${u}`;const d=digits(phone);return d?`https://wa.me/${d}`:''};
async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}

async function settings(){
  const [{data:clickup,error},{data:app},{data:manifest}]=await Promise.all([
    db.from('clickup_integration_settings').select('value').eq('setting_key','black_box').single(),
    db.from('system_settings').select('value').eq('key','order_app').maybeSingle(),
    db.from('system_settings').select('value').eq('key','clickup_component_set_manifest').maybeSingle()
  ]);
  if(error)throw error;
  const b=text(Deno.env.get('ORDER_APP_BASE_URL'))||text(app?.value?.base_url);
  return{clickup:clickup?.value||{},baseUrl:b?trimSlash(b):'',manifest:manifest?.value||{}};
}
async function authorized(req:Request,hash:string){const raw=req.headers.get('x-ap-secret')||'',provided=raw.trim(),ok=!!hash&&!!provided&&await sha256(provided)===hash;if(!ok)console.warn('clickup-production-outbox invalid_ap_secret',{has_header:Boolean(raw),raw_length:raw.length,trimmed_length:provided.length});return ok}

async function whatsappIdentity(order:any){
  let masterId='';
  if(order?.customer_id){
    const {data}=await db.from('customers').select('customer_master_id,phone').eq('id',order.customer_id).maybeSingle();
    masterId=text(data?.customer_master_id);if(!order.delivery_phone&&data?.phone)order.delivery_phone=data.phone;
  }
  let bsuid='',username='',lastPhone='';
  if(masterId){
    const {data}=await db.from('customer_identifiers_master').select('identifier_value,metadata,last_seen_at').eq('customer_master_id',masterId).eq('identifier_type','whatsapp_bsuid').eq('channel','whatsapp').order('last_seen_at',{ascending:false}).limit(1).maybeSingle();
    bsuid=BSUID_RE.test(text(data?.identifier_value))?text(data?.identifier_value).toUpperCase():'';
    username=text(data?.metadata?.current_username);lastPhone=text(data?.metadata?.last_phone_seen);
    if(!bsuid||!username){
      const {data:setting}=await db.from('whatsapp_settings').select('secret_value,text_value,value').eq('key','unified_inbox_24h_url').maybeSingle();
      const url=text(setting?.secret_value)||text(setting?.text_value)||text(setting?.value?.url);
      if(url){try{
        const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customer_master_id:masterId,phone:digits(order.delivery_phone)||undefined})});
        const resolved=await response.json();
        if(response.ok&&resolved?.ok!==false){
          bsuid=BSUID_RE.test(text(resolved.bsuid))?text(resolved.bsuid).toUpperCase():bsuid;username=text(resolved.username)||username;lastPhone=digits(resolved.phone)||lastPhone;
          if(bsuid){await db.from('customer_identifiers_master').upsert({customer_master_id:masterId,identifier_type:'whatsapp_bsuid',channel:'whatsapp',identifier_value:bsuid,normalized_value:bsuid,scope:'waba:939302461880264',is_verified:true,confidence:1,source_system:'icetak-unified-inbox',metadata:{current_username:username||null,last_phone_seen:lastPhone||null,lazy_synced_at:new Date().toISOString()},last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'identifier_type,normalized_value,scope'});}
        }
      }catch(e){console.error('whatsapp identity resolver',e)}}
    }
  }
  const phone=digits(order.delivery_phone)||digits(lastPhone);
  return{master_id:masterId||null,bsuid:bsuid||null,username:username||null,phone:phone||null,link:whatsapp(phone,username)||null};
}

async function canonicalInitialStatus(component:any,item:any){
  const c=item?.customization&&typeof item.customization==='object'?item.customization:{};
  const {data,error}=await db.rpc('icetak_clickup_initial_status_v2',{
    p_component_type:text(component?.component_type)||null,
    p_label:text(component?.label)||null,
    p_product_type:text(item?.product_type||item?.k)||null,
    p_title:text(item?.title)||null,
    p_process:text(c?.admin_process||item?.process)||null,
    p_review_required:Boolean(component?.review_required??item?.review_required),
    p_ai_job_type:text(c?.ai_job_type)||null,
    p_style:text(item?.style)||null
  });
  if(error)throw Error(`canonical_clickup_status:${error.message}`);
  const status=text(data);
  if(!status)throw Error('canonical_clickup_status_empty');
  return status;
}

function links(base:string,order:any,componentId?:string){const token=encodeURIComponent(text(order.public_token)),component=componentId?`&component=${encodeURIComponent(componentId)}`:'',hash=componentId?`#component-${encodeURIComponent(componentId)}`:'',customer=`/?order=${token}${hash}`,admin=`/?admin=1&order=${token}${component}`,history=`/?c=${encodeURIComponent(text(order.customer_token))}`;return{customer_order_path:customer,admin_order_path:admin,customer_history_path:history,customer_order_link:base?`${base}${customer}`:null,admin_order_link:base?`${base}${admin}`:null,customer_history_link:base?`${base}${history}`:null}}
function aiMeta(item:any){const c=item.customization&&typeof item.customization==='object'?item.customization:{};return{job_type:text(c.ai_job_type),pending:Boolean(c.ai_pending_confirmation),conversation_id:text(c.conversation_id),whatsapp_link:text(c.whatsapp_link),match_score:c.match_score??null,match_reason:c.match_reason??[],reference_message_ids:Array.isArray(c.reference_message_ids)?c.reference_message_ids:[],reference_media:Array.isArray(c.reference_media)?c.reference_media:[]}}
function itemProcess(item:any){return text(item?.customization?.admin_process||item?.process)||'Pre-order'}
function itemReview(component:any,item:any){return Boolean(component?.review_required??item?.review_required)?'Need Review':'No Review'}
function itemReference(item:any){return text(item?.customization?.reference_url||item?.product_snapshot?.image_url||item?.design_preview_url)}

function description(base:string,order:any,component:any,item:any,total:number,payment:any){
  const snap=item.product_snapshot&&typeof item.product_snapshot==='object'?item.product_snapshot:{},a=aiMeta(item),l=links(base,order,text(component.id)),set=Number(component.set_index||0),wa=a.whatsapp_link||text(order.__whatsapp_link)||whatsapp(order.delivery_phone),process=itemProcess(item),review=itemReview(component,item),reference=itemReference(item);
  const lines=[
    `Order: ${text(order.order_no||order.order_id)}`,
    `Customer: ${text(order.delivery_name)}`,
    `Phone: ${text(order.delivery_phone)}`,
    wa?`WhatsApp: ${wa}`:'',
    text(order.__whatsapp_username)?`WhatsApp Username: @${text(order.__whatsapp_username)}`:'',
    text(order.__whatsapp_bsuid)?`WhatsApp BSUID: ${text(order.__whatsapp_bsuid)}`:'',
    `Payment: RM${Number(payment?.amount??order.total??0).toFixed(2)} | ${text(payment?.transaction_id||order.payment_transaction_id)} | ${text(payment?.paid_at||order.payment_verified_at)}`,
    `Payment Method: ${text(order.payment_method||payment?.provider)}`,
    `AI Review: ${a.pending?'PENDING CONFIRMATION — confirm atau delete task':'Normal order'}`,
    a.job_type?`AI Job Type: ${a.job_type}`:'',
    a.match_score!=null?`AI Match: ${Math.round(Number(a.match_score)*100)}%`:'',
    a.conversation_id?`Conversation ID: ${a.conversation_id}`:'',
    `Date Need: ${text(order.date_need)||'Not provided'}`,
    `Delivery: ${text(order.delivery_method||order.delivery)}`,
    set?`Order Component: set${set} of ${total}`:`Order Components: ${total}`,
    `Product: ${text(item.title||component.label)}`,
    `Process: ${process}`,
    `Review: ${review}`,
    text(snap.parent_sku)?`Parent SKU: ${text(snap.parent_sku)}`:'',
    text(item.catalog_slug)?`Catalog slug: ${text(item.catalog_slug)}`:'',
    text(item.catalog_clickup_task_id)?`Source design task: ${text(item.catalog_clickup_task_id)}`:'',
    text(item.size)?`Size: ${text(item.size)}`:'',
    text(item.style)?`Style: ${text(item.style)}`:'',
    text(item.wording||item.custom_text)?`Wording: ${text(item.wording||item.custom_text)}`:'',
    reference?`Reference: ${reference}`:'',
    a.reference_message_ids.length?`Reference Message IDs: ${a.reference_message_ids.join(', ')}`:'',
    `Quantity: ${Number(item.qty||1)}`,
    `Order item ID: ${text(component.order_item_id)}`,
    `Component ID: ${text(component.id)}`,
    text(order.admin_remark)?`Admin Remark:\n${text(order.admin_remark)}`:'',
    l.admin_order_link?`System Link: ${l.admin_order_link}`:`System Path: ${l.admin_order_path}`,
    l.customer_order_link?`Customer Link: ${l.customer_order_link}`:`Customer Path: ${l.customer_order_path}`
  ];
  return lines.filter(Boolean).join('\n');
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='GET')return json({error:'method_not_allowed'},405);
  try{
    const s=await settings();
    if(!await authorized(req,text(s.clickup?.secret_sha256)))return json({error:'invalid_ap_secret'},401);
    const url=new URL(req.url),limit=Math.max(1,Math.min(Number(url.searchParams.get('limit')||1),10));
    const {data:events,error:ee}=await db.rpc('claim_clickup_production_outbox',{p_limit:limit});
    if(ee)throw ee;
    const results:any[]=[];

    for(const event of events||[]){
      const [{data:order,error:oe},{data:payment,error:pe}]=await Promise.all([
        db.from('orders').select('*').eq('id',event.order_id).single(),
        db.from('payment_transactions').select('provider,transaction_id,amount,paid_at,sender_name,raw_payload').eq('order_id',event.order_id).order('paid_at',{ascending:false,nullsFirst:false}).limit(1).maybeSingle()
      ]);
      if(oe){await db.from('integration_outbox').update({status:'retry',last_error:oe.message,next_attempt_at:new Date(Date.now()+60000).toISOString(),locked_at:null}).eq('id',event.id);continue}
      if(pe)console.error('payment lookup',pe.message);

      const wai=await whatsappIdentity(order);order.__whatsapp_link=wai.link;order.__whatsapp_username=wai.username;order.__whatsapp_bsuid=wai.bsuid;
      const {data:all,error:ce}=await db.from('production_components').select('*,order_items(*)').eq('order_id',event.order_id).order('set_index',{ascending:true,nullsFirst:false}).order('created_at');
      if(ce)throw ce;
      const components=(all||[]).filter((c:any)=>!text(c.clickup_task_id));
      if(!components.length){await db.from('integration_outbox').update({status:'processed',processed_at:new Date().toISOString(),sent_at:new Date().toISOString(),locked_at:null,last_error:null,error:null}).eq('id',event.id);continue}

      const total=(all||[]).length,ol=links(s.baseUrl,order),wa=text(wai.link),setField=text(s.manifest?.field_id),mapped:any[]=[];
      for(let pendingIndex=0;pendingIndex<components.length;pendingIndex++){
        const component=components[pendingIndex],item=component.order_items||{},word=text(item.wording||item.custom_text),orderNo=text(order.order_no||order.order_id),setIndex=Number(component.set_index||((all||[]).findIndex((r:any)=>r.id===component.id)+1)),setLabel=text(component.set_label)||`set${setIndex}`,setOption=text(component.clickup_set_option_id)||text(s.manifest?.options?.[String(setIndex)]),componentLinks=links(s.baseUrl,order,text(component.id)),a=aiMeta(item),customFields=setField&&setOption?[{id:setField,value:[setOption]}]:[],reviewRequired=Boolean(component.review_required??item.review_required),process=itemProcess(item),reference=itemReference(item),initialStatus=await canonicalInitialStatus(component,item);
        mapped.push({
          id:component.id,order_item_id:component.order_item_id,title:component.label||item.title||`Component ${pendingIndex+1}`,
          task_name:`${orderNo} — ${setLabel}/${total} — ${Number(item.qty||1)}x ${text(item.title||component.label||`Component ${pendingIndex+1}`)}${word?` — ${word}`:''}`,
          task_description:description(s.baseUrl,order,component,item,total,payment),task_external_key:`icetak-component:${component.id}`,
          component_type:component.component_type,quantity:item.qty||1,size:item.size||'',style:item.style||'',wording:word,wording_mode:item.wording_mode||'',
          process,review:reviewRequired?'Need Review':'No Review',reference_url:reference||null,due_date:order.date_need||null,
          catalog_slug:item.catalog_slug||'',catalog_clickup_task_id:item.catalog_clickup_task_id||'',product_id:item.product_id||null,product_snapshot:item.product_snapshot||{},customization:item.customization||{},review_required:reviewRequired,
          ai_pending_confirmation:a.pending,ai_job_type:a.job_type,ai_match_score:a.match_score,conversation_id:a.conversation_id,whatsapp_link:a.whatsapp_link||wa,whatsapplink:a.whatsapp_link||wa,whatsapp_username:wai.username,whatsapp_bsuid:wai.bsuid,
          payment_transaction_id:payment?.transaction_id||order.payment_transaction_id,payment_amount:payment?.amount??order.total,payment_paid_at:payment?.paid_at||order.payment_verified_at,reference_message_ids:a.reference_message_ids,reference_media:a.reference_media,
          initial_clickup_status:initialStatus,status_source:'icetak_clickup_initial_status_v2',set_index:setIndex,set_label:setLabel,set_option_id:setOption||null,set_custom_field_id:setField||null,set_manifest_complete:Boolean(setField&&setOption),custom_fields:customFields,awb_primary:setIndex===1,webapp_order_id:order.id,webapp_component_id:component.id,...componentLinks
        });
      }

      results.push({event_id:event.id,event_type:event.event_type,order:{id:order.id,order_no:order.order_no||order.order_id,public_token:order.public_token,customer_token:order.customer_token,date_needed:order.date_need,payment_status:order.payment_status,payment_method:order.payment_method,payment_transaction_id:payment?.transaction_id||order.payment_transaction_id,payment_amount:payment?.amount??order.total,payment_paid_at:payment?.paid_at||order.payment_verified_at,customer_confirmed:order.customer_confirmed,customer_name:order.delivery_name,customer_phone:order.delivery_phone,whatsapp_link:wa,whatsapplink:wa,whatsapp_username:wai.username,whatsapp_bsuid:wai.bsuid,customer_master_id:wai.master_id,delivery_method:order.delivery_method||order.delivery,delivery_address:order.delivery_address,delivery_city:order.delivery_city,delivery_postcode:order.delivery_postcode,delivery_state:order.delivery_state,admin_status:order.admin_status,admin_remark:order.admin_remark,total_components:total,shipping_guard:{required_components:total,block_until_all_components_ready:total>1,minimum_progress_stage:6},...ol},components:mapped});
    }
    return json({ok:true,mode:s.clickup?.mode||'observe',order_app_configured:Boolean(s.baseUrl),status_contract:'canonical-db-v2',count:results.length,events:results});
  }catch(e){console.error('clickup-production-outbox',e);return json({error:e instanceof Error?e.message:String(e)},500)}
});