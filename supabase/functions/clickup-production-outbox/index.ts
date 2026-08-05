import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const headers={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type,x-ap-secret','cache-control':'no-store'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const text=(v:unknown)=>v==null?'':String(v).trim();
const trimSlash=(v:string)=>v.replace(/\/+$/,'');
const digits=(v:unknown)=>text(v).replace(/\D/g,'');
const whatsapp=(v:unknown)=>digits(v)?`https://wa.me/${digits(v)}`:'';

async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function settings(){const [{data:clickup,error},{data:app},{data:manifest},{data:statuses,error:se}]=await Promise.all([
  db.from('clickup_integration_settings').select('value').eq('setting_key','black_box').single(),
  db.from('system_settings').select('value').eq('key','order_app').maybeSingle(),
  db.from('system_settings').select('value').eq('key','clickup_component_set_manifest').maybeSingle(),
  db.from('clickup_status_mapping').select('status_name').eq('active',true),
]);if(error)throw error;if(se)throw se;const b=text(Deno.env.get('ORDER_APP_BASE_URL'))||text(app?.value?.base_url);return{clickup:clickup?.value||{},baseUrl:b?trimSlash(b):'',manifest:manifest?.value||{},active:new Set((statuses||[]).map((r:any)=>text(r.status_name).toLowerCase()).filter(Boolean))}}
async function authorized(req:Request,hash:string){return!!hash&&await sha256(req.headers.get('x-ap-secret')||'')===hash}
function initialStatus(component:any,item:any,active:Set<string>){const combined=`${text(component.component_type)} ${text(component.label)} ${text(item.product_type)} ${text(item.title)}`.toLowerCase(),job=text(item.customization?.ai_job_type).toLowerCase(),review=Boolean(component.review_required??item.review_required);let desired='';if(job==='topper_new_design_glossy')desired='new custom';else if(job==='topper_editing_glossy')desired='design editing -topper';else if(combined.includes('mirror gold')||combined.includes('artpaper')||combined.includes('acrylic'))desired='acrylic';else if(combined.includes('wafer'))desired='wafer paper';else if(combined.includes('edible'))desired='design edible image';else if(combined.includes('topper')||combined.includes('printed'))desired=review?'design editing -topper':'ready stock';else desired=review?'design editing -topper':'ready stock';if(!active.has(desired.toLowerCase()))throw Error(`unmapped_initial_clickup_status:${desired}`);return desired}
function links(base:string,order:any,componentId?:string){const token=encodeURIComponent(text(order.public_token)),component=componentId?`&component=${encodeURIComponent(componentId)}`:'',hash=componentId?`#component-${encodeURIComponent(componentId)}`:'',customer=`/?order=${token}${hash}`,admin=`/?admin=1&order=${token}${component}`,history=`/?c=${encodeURIComponent(text(order.customer_token))}`;return{customer_order_path:customer,admin_order_path:admin,customer_history_path:history,customer_order_link:base?`${base}${customer}`:null,admin_order_link:base?`${base}${admin}`:null,customer_history_link:base?`${base}${history}`:null}}
function aiMeta(item:any){const c=item.customization&&typeof item.customization==='object'?item.customization:{};return{job_type:text(c.ai_job_type),pending:Boolean(c.ai_pending_confirmation),conversation_id:text(c.conversation_id),whatsapp_link:text(c.whatsapp_link),match_score:c.match_score??null,match_reason:c.match_reason??[],reference_message_ids:Array.isArray(c.reference_message_ids)?c.reference_message_ids:[],reference_media:Array.isArray(c.reference_media)?c.reference_media:[]}}
function description(base:string,order:any,component:any,item:any,total:number,payment:any){const snap=item.product_snapshot&&typeof item.product_snapshot==='object'?item.product_snapshot:{},a=aiMeta(item),l=links(base,order,text(component.id)),set=Number(component.set_index||0),wa=a.whatsapp_link||whatsapp(order.delivery_phone),lines=[
  `Order: ${text(order.order_no||order.order_id)}`,
  `Customer: ${text(order.delivery_name)}`,
  `Phone: ${text(order.delivery_phone)}`,
  wa?`WhatsApp: ${wa}`:'',
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
  text(snap.parent_sku)?`Parent SKU: ${text(snap.parent_sku)}`:'',
  text(item.catalog_slug)?`Catalog slug: ${text(item.catalog_slug)}`:'',
  text(item.catalog_clickup_task_id)?`Source design task: ${text(item.catalog_clickup_task_id)}`:'',
  text(item.size)?`Size: ${text(item.size)}`:'',
  text(item.style)?`Style: ${text(item.style)}`:'',
  text(item.wording||item.custom_text)?`Wording: ${text(item.wording||item.custom_text)}`:'',
  text(snap.image_url)?`Design image: ${text(snap.image_url)}`:'',
  a.reference_message_ids.length?`Reference Message IDs: ${a.reference_message_ids.join(', ')}`:'',
  `Quantity: ${Number(item.qty||1)}`,
  `Order item ID: ${text(component.order_item_id)}`,
  `Component ID: ${text(component.id)}`,
  text(order.admin_remark)?`Admin Remark:\n${text(order.admin_remark)}`:'',
  l.admin_order_link?`System Link: ${l.admin_order_link}`:`System Path: ${l.admin_order_path}`,
  l.customer_order_link?`Customer Link: ${l.customer_order_link}`:`Customer Path: ${l.customer_order_path}`,
];return lines.filter(Boolean).join('\n')}

Deno.serve(async(req:Request)=>{if(req.method==='OPTIONS')return new Response('ok',{headers});if(req.method!=='GET')return json({error:'method_not_allowed'},405);try{const s=await settings();if(!await authorized(req,text(s.clickup?.secret_sha256)))return json({error:'invalid_ap_secret'},401);const url=new URL(req.url),limit=Math.max(1,Math.min(Number(url.searchParams.get('limit')||1),10)),{data:events,error:ee}=await db.rpc('claim_clickup_production_outbox',{p_limit:limit});if(ee)throw ee;const results:any[]=[];
for(const event of events||[]){const [{data:order,error:oe},{data:payment,error:pe}]=await Promise.all([
  db.from('orders').select('*').eq('id',event.order_id).single(),
  db.from('payment_transactions').select('provider,transaction_id,amount,paid_at,sender_name,raw_payload').eq('order_id',event.order_id).order('paid_at',{ascending:false,nullsFirst:false}).limit(1).maybeSingle(),
]);if(oe){await db.from('integration_outbox').update({status:'retry',last_error:oe.message,next_attempt_at:new Date(Date.now()+60000).toISOString(),locked_at:null}).eq('id',event.id);continue}if(pe)console.error('payment lookup',pe.message);
const {data:all,error:ce}=await db.from('production_components').select('*,order_items(*)').eq('order_id',event.order_id).order('set_index',{ascending:true,nullsFirst:false}).order('created_at');if(ce)throw ce;const components=(all||[]).filter((c:any)=>!text(c.clickup_task_id));if(!components.length){await db.from('integration_outbox').update({status:'processed',processed_at:new Date().toISOString(),sent_at:new Date().toISOString(),locked_at:null,last_error:null,error:null}).eq('id',event.id);continue}
const total=(all||[]).length,ol=links(s.baseUrl,order),setField=text(s.manifest?.field_id),wa=whatsapp(order.delivery_phone);results.push({event_id:event.id,event_type:event.event_type,order:{id:order.id,order_no:order.order_no||order.order_id,public_token:order.public_token,customer_token:order.customer_token,date_needed:order.date_need,payment_status:order.payment_status,payment_method:order.payment_method,payment_transaction_id:payment?.transaction_id||order.payment_transaction_id,payment_amount:payment?.amount??order.total,payment_paid_at:payment?.paid_at||order.payment_verified_at,customer_confirmed:order.customer_confirmed,customer_name:order.delivery_name,customer_phone:order.delivery_phone,whatsapp_link:wa,delivery_method:order.delivery_method||order.delivery,delivery_address:order.delivery_address,delivery_city:order.delivery_city,delivery_postcode:order.delivery_postcode,delivery_state:order.delivery_state,admin_status:order.admin_status,admin_remark:order.admin_remark,total_components:total,shipping_guard:{required_components:total,block_until_all_components_ready:total>1,minimum_progress_stage:6},...ol},components:components.map((component:any,pendingIndex:number)=>{const item=component.order_items||{},word=text(item.wording||item.custom_text),orderNo=text(order.order_no||order.order_id),setIndex=Number(component.set_index||((all||[]).findIndex((r:any)=>r.id===component.id)+1)),setLabel=text(component.set_label)||`set${setIndex}`,setOption=text(component.clickup_set_option_id)||text(s.manifest?.options?.[String(setIndex)]),componentLinks=links(s.baseUrl,order,text(component.id)),a=aiMeta(item),customFields=setField&&setOption?[{id:setField,value:[setOption]}]:[];return{id:component.id,order_item_id:component.order_item_id,title:component.label||item.title||`Component ${pendingIndex+1}`,task_name:`${orderNo} — ${setLabel}/${total} — ${Number(item.qty||1)}x ${text(item.title||component.label||`Component ${pendingIndex+1}`)}${word?` — ${word}`:''}`,task_description:description(s.baseUrl,order,component,item,total,payment),task_external_key:`icetak-component:${component.id}`,component_type:component.component_type,quantity:item.qty||1,size:item.size||'',style:item.style||'',wording:word,wording_mode:item.wording_mode||'',catalog_slug:item.catalog_slug||'',catalog_clickup_task_id:item.catalog_clickup_task_id||'',product_id:item.product_id||null,product_snapshot:item.product_snapshot||{},customization:item.customization||{},review_required:Boolean(component.review_required??item.review_required),ai_pending_confirmation:a.pending,ai_job_type:a.job_type,ai_match_score:a.match_score,conversation_id:a.conversation_id,whatsapp_link:a.whatsapp_link||wa,payment_transaction_id:payment?.transaction_id||order.payment_transaction_id,payment_amount:payment?.amount??order.total,payment_paid_at:payment?.paid_at||order.payment_verified_at,reference_message_ids:a.reference_message_ids,reference_media:a.reference_media,initial_clickup_status:initialStatus(component,item,s.active),set_index:setIndex,set_label:setLabel,set_option_id:setOption||null,set_custom_field_id:setField||null,set_manifest_complete:Boolean(setField&&setOption),custom_fields:customFields,awb_primary:setIndex===1,webapp_order_id:order.id,webapp_component_id:component.id,...componentLinks}})});}
return json({ok:true,mode:s.clickup?.mode||'observe',order_app_configured:Boolean(s.baseUrl),count:results.length,events:results});}catch(e){console.error('clickup-production-outbox',e);return json({error:e instanceof Error?e.message:String(e)},500)}});
