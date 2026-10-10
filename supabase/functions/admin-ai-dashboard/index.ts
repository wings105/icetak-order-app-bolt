import { knowledgeReply } from '../_shared/reply-knowledge.ts';
import { attachDetailSources, orderDetails, validateDetailCheck } from './order-details.ts';
import { enrichContexts } from './enrich.ts';
import { focusRows, validateFocusUpdate } from './focus.ts';
import { orderOperation } from './operations.ts';
import { caseOrders, sessionKey } from './case.ts';
import { analyze, identity, intentLabels } from './analysis.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
};

type JsonObject = Record<string, unknown>;
type ForwardKind = "raw" | "order_id_phone";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
});

async function rest(path: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data?.message || data?.error || `REST ${response.status}`);
  return data;
}

async function currentAdmin(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const auth = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${token}` },
  });
  const user = await auth.json().catch(() => null);
  if (!auth.ok || !user?.id) return null;
  const admins = await rest(`admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=username,role&limit=1`);
  const admin = admins?.[0];
  if (!admin?.username) return null;
  const rows = await rest(`admin_permissions?username=eq.${encodeURIComponent(admin.username)}&select=permissions&limit=1`);
  const permissions = Array.isArray(rows?.[0]?.permissions) ? rows[0].permissions.map(String) : [];
  return { username: String(admin.username), role: String(admin.role || "staff"), permissions };
}

async function setting(key: string) {
  const rows = await rest(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&select=text_value,secret_value&limit=1`);
  return String(rows?.[0]?.secret_value || rows?.[0]?.text_value || "").trim();
}

async function privateSetting(key: string) {
  const rows = await rest(`private_runtime_settings?setting_key=eq.${encodeURIComponent(key)}&select=setting_value&limit=1`);
  return String(rows?.[0]?.setting_value || "").trim();
}


// Share only overlapping read calls. Nothing survives completion; saves always read fresh.
const pendingReads=new Map<string,Promise<any>>();
async function sharedRead(key:string,read:()=>Promise<any>){
 let pending=pendingReads.get(key);if(!pending){pending=read();pendingReads.set(key,pending);void pending.finally(()=>{if(pendingReads.get(key)===pending)pendingReads.delete(key)}).catch(()=>{});}
 return structuredClone(await pending);
}
async function rpc(name:string,body:unknown) {
 const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{
 method:'POST',headers:{apikey:SERVICE_ROLE_KEY,authorization:`Bearer ${SERVICE_ROLE_KEY}`,'content-type':'application/json'},
 body:JSON.stringify(body),signal:AbortSignal.timeout(name.startsWith('icetak_customer_focus')?60000:20000)});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||'Database operation failed');return data;
}
async function inbox(body:unknown) {
 const token=await privateSetting('admin_window_bridge_token');
 if(!token)throw new Error('Inbox bridge configuration missing');
 // Fixed destination: admin input cannot redirect the service credential.
 const response=await fetch('https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/ai-dashboard-bridge',{
 method:'POST',headers:{'content-type':'application/json','x-admin-window-token':token},
 body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 const result=await response.json().catch(()=>({}));
 if(!response.ok||result.ok===false)throw new Error(result.error||'Inbox request failed');return result;
}
async function enabled(){
 const rows=await rest('whatsapp_settings?key=eq.enabled&select=value,text_value&limit=1');
 const value=rows?.[0]?.text_value||rows?.[0]?.value;
 return value===true||value==='true'||value==='1'||value==='on';
}
async function detailContexts(rows:any[],source:any,identities:any){
 const requests=rows.map(r=>{
  const approved=new Set((r.conversations||[]).filter((x:any)=>identities[x.id]?.identity_status!=='ambiguous').map((x:any)=>x.id));
  const saved=r.state?.data?.detail_check?.bindings||[];
  return {key:r.key,reference:r.reference,closed:r.work?.shipped||r.work?.closed||false,bindings:saved.filter((x:any)=>approved.has(x.conversation_id)),binding_invalid:saved.some((x:any)=>!approved.has(x.conversation_id))};
 });
 const contexts:any={};
 for(let i=0;i<requests.length;i+=250){const batch=requests.slice(i,i+250);const results=await Promise.all(Array.from({length:Math.ceil(batch.length/50)},(_,j)=>inbox({action:'order_details',orders:batch.slice(j*50,j*50+50)})));for(const r of results)Object.assign(contexts,r.contexts||{});}
 for(const r of requests){const c=contexts[r.key]||{};if(r.binding_invalid){c.ambiguous=true;c.bindings=[];c.messages=[];}c.media=(c.messages||[]).filter((m:any)=>m.direction==='inbound'&&m.media_url).map((m:any)=>({url:m.media_url,caption:m.caption,id:m.id,at:m.created_at}));contexts[r.key]=c;}
 return contexts;
}
const isUuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''));
const stable=(v:any):string=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):v);
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
 if(req.method!=='POST')return json({ok:false,error:'POST required'},405);
 try {
  const admin=await currentAdmin(req);
  if(!admin)return json({ok:false,error:'Sila log masuk sebagai admin.'},401);
  const owner=admin.role==='owner'||admin.permissions.includes('manage_admins');
  const canRead=owner||admin.permissions.includes('view_customers')||admin.permissions.includes('manage_customers');
  const canManage=owner||admin.permissions.includes('manage_customers');
  if(!canRead)return json({ok:false,error:'Akses CRM diperlukan.'},403);
  const b=await req.json();const action=String(b.action||'list');
  if(!['order_details','order_detail_save','focus','focus_save','focus_bulk_save','list','work','detail','review','send','training','training_list','case_order'].includes(action))return json({ok:false,error:'Invalid action'},400);
  if(!['order_details','order_detail_save','focus','focus_save','focus_bulk_save','list','work','training_list'].includes(action)&&!isUuid(b.conversation_id))return json({ok:false,error:'Invalid conversation ID'},400);
  if(['review','send','training','case_order'].includes(action)&&!canManage)return json({ok:false,error:'Manage Customers permission required'},403);
  if(action==='order_details'||action==='order_detail_save'){
   if(action==='order_detail_save'&&!canManage)return json({ok:false,error:'Manage Customers permission required'},403);
   if(action==='order_detail_save'){
    if(!isUuid(b.request_id))return json({ok:false,error:'Invalid request ID'},400);
    const previous=await rest(`customer_focus_events?request_id=eq.${b.request_id}&select=row_key,actor,input,result&limit=1`);
    if(previous[0]){const e=previous[0],payload={row_key:b.row_key,expected_version:b.expected_version,source_fingerprint:b.source_fingerprint,detail_check:b.detail_check};
     if(e.row_key!==b.row_key||e.actor!==admin.username||!e.input.detail_request||stable(e.input.detail_request)!==stable(payload))return json({ok:false,error:'REQUEST_CONFLICT'},409);
     return json({ok:true,state:e.result,duplicate:true});
    }
   }
   const keys=action==='order_detail_save'?[b.row_key]:b.keys;
   if(!Array.isArray(keys)||!keys.length||keys.length>50||keys.some(k=>!/^((icetak|shopee):[0-9a-f-]{36})$/.test(String(k))))return json({ok:false,error:'Pilih 1 hingga 50 order'},400);
   const [snapshot,source,details]=await Promise.all([rpc('icetak_customer_focus_orders',{p_keys:keys}),action==='order_details'?sharedRead('focus-chats',()=>inbox({action:'focus'})):inbox({action:'focus'}),rpc('icetak_order_detail_sources',{p_keys:keys})]);
   snapshot.orders=snapshot.orders.filter((o:any)=>keys.includes(`${o.kind}:${o.id}`));attachDetailSources(snapshot,details);
   const identityInput={p_identities:source.rows.map(identity)};
   const identities=action==='order_details'?await sharedRead('identities:'+JSON.stringify(identityInput),()=>rpc('icetak_customer_focus_identities',identityInput)):await rpc('icetak_customer_focus_identities',identityInput);
   let rows=focusRows(snapshot,source.rows,identities).filter((r:any)=>keys.includes(r.key));
   const candidates=(row:any)=>source.rows.filter((c:any)=>row.conversations.some((x:any)=>x.id===c.id)).map((c:any)=>({id:c.id,name:c.name,channel:c.channel,ambiguous:identities[c.id]?.identity_status==='ambiguous',last_inbound_at:c.last_inbound_at,boundary_at:'2020-01-01T00:00:00Z'}));
   if(action==='order_detail_save'){
    const row=rows.find((r:any)=>r.key===b.row_key);if(!row||!isUuid(b.request_id)||!Number.isInteger(b.expected_version)||b.expected_version<0)return json({ok:false,error:'Order / request tidak sah'},400);
    if(row.source_fingerprint!==b.source_fingerprint)return json({ok:false,error:'SOURCE_CHANGED: Muat semula order'},409);
    const eligible=candidates(row);
    for(const binding of b.detail_check?.bindings||[]){
     if(!isUuid(binding.conversation_id))return json({ok:false,error:'Invalid conversation ID'},400);
     const candidate=eligible.find((c:any)=>c.id===binding.conversation_id);if(!candidate)continue;
     const previous=await rest(`order_sessions?conversation_id=eq.${binding.conversation_id}&closed_at=lt.${encodeURIComponent(row.created_at)}&select=closed_at,order_id&order=closed_at.desc&limit=5`);
     const boundary=previous.find((s:any)=>s.order_id!==row.id&&s.order_id!==row.internal_order_id);
     if(boundary)candidate.boundary_at=boundary.closed_at;
    }
    const context={candidates:eligible,revision:b.revision};
    // Lock decision comes from actual task state, never the browser.
    const existingContexts=await detailContexts([row],source,identities);
    row.detail_collection=orderDetails(row,existingContexts[row.key]||{});
    let detailCheck:any;
    try{detailCheck=validateDetailCheck(b.detail_check||{},row,context);}catch(error){const message=error instanceof Error?error.message:String(error);return json({ok:false,error:message},message.includes('SOURCE_CHANGED')?409:400);}
    // Never let an arbitrary browser revision masquerade as a recorded customer response.
    const checked=await inbox({action:'order_details',orders:[{key:row.key,reference:row.reference,closed:row.work?.shipped||row.work?.closed||false,bindings:detailCheck.bindings}]});
    const actualContext=checked.contexts?.[row.key]||{};
    detailCheck.chat_revision=JSON.stringify((actualContext.bindings||[]).map((x:any)=>[x.id,x.revision]));
    if(b.detail_check?.mark_followup===true)detailCheck.followup.revision=JSON.stringify((actualContext.bindings||[]).map((x:any)=>[x.id,x.revision]));
    row.state={...row.state,data:{...row.state.data,detail_check:detailCheck}};
    const result=orderDetails(row,actualContext);
    const panel=validateFocusUpdate({...b,data:{...row.state.data,detail_status:result.status==='review'?'unknown':result.status,missing_details:result.missing.join(', ')}},row);
    panel.detail_request={row_key:b.row_key,expected_version:b.expected_version,source_fingerprint:b.source_fingerprint,detail_check:b.detail_check};
    const state=await rpc('icetak_customer_focus_save',{p_key:row.key,p_actor:admin.username,p_version:b.expected_version,p_request:b.request_id,p_data:panel});
    return json({ok:true,state,detail_collection:result});
   }
   const contexts=await detailContexts(rows,source,identities);
   rows=rows.map((r:any)=>{const ctx=contexts[r.key]||{};
    return {...r,detail_collection:orderDetails(r,ctx),detail_candidates:candidates(r)};});
   return json({ok:true,rows,capabilities:{can_manage:canManage,shopee_send:false},fetched_at:new Date().toISOString()});
  }
  if(action==='focus'||action==='focus_save'||action==='focus_bulk_save'){
   if(action!=='focus'&&!canManage)return json({ok:false,error:'Manage Customers permission required'},403);
   if(action==='focus_bulk_save'&&(!Array.isArray(b.updates)||b.updates.length<1||b.updates.length>50||new Set(b.updates.map((u:any)=>u?.row_key)).size!==b.updates.length))return json({ok:false,error:'Pilih 1 hingga 50 rekod unik.'},400);
   const [snapshot,source,drafts]=await Promise.all([rpc('icetak_customer_focus_snapshot',{}),inbox({action:'focus'}),rpc('icetak_customer_focus_drafts',{})]);snapshot.drafts=drafts.rows||[];
   const [identities,detailSources]=await Promise.all([rpc('icetak_customer_focus_identities',{p_identities:source.rows.map(identity)}),rpc('icetak_order_detail_sources',{p_keys:[]})]);attachDetailSources(snapshot,detailSources);
   const initialRows=focusRows(snapshot,source.rows,identities);
   const current=initialRows.filter((r:any)=>['icetak','shopee'].includes(r.kind)&&!r.history&&r.work.active);
   const contexts=await detailContexts(current,source,identities);
   for(const o of snapshot.orders||[])o.detail_context=contexts[`${o.kind}:${o.id}`]||{};
   const rows=focusRows(snapshot,source.rows,identities).filter((r:any)=>r.kind==='chat'||r.work.active||r.chat.reply||(r.history&&r.chat.id&&r.chat.order_confirmed));
   if(action==='focus_bulk_save'){
    const targets=new Map<string,any>(rows.map((r:any)=>[r.key,r]));
    // Exact source conversation permits marking a bound chat without completing its order.
    for(const c of source.rows){const key=`chat:${c.id}`;if(!targets.has(key))targets.set(key,{key,kind:'chat',source_fingerprint:c.inbound_revision,chat:{revision:c.inbound_revision}});}
    const requests=b.updates.map((u:any)=>{
     try{
      if(!u||!isUuid(u.request_id)||!/^((icetak|shopee|draft|chat):[0-9a-f-]{36})$/.test(String(u.row_key||'')))throw Error('Invalid focus identity');
      const row=targets.get(u.row_key);if(!row)throw Error('SOURCE_CHANGED: Rekod tiada lagi. Muat semula.');
      return {update:u,data:validateFocusUpdate(u,row)};
     }catch(e){return {update:u,error:e instanceof Error?e.message:String(e)};}
    });
    const results:any[]=[];
    // Independent audited saves; bounded concurrency, explicit partial results, no false all-success.
    for(let i=0;i<requests.length;i+=5){results.push(...await Promise.all(requests.slice(i,i+5).map(async (p:any)=>{
     if(p.error)return {row_key:p.update?.row_key,ok:false,error:p.error};
     try{const state=await rpc('icetak_customer_focus_save',{p_key:p.update.row_key,p_actor:admin.username,p_version:p.update.expected_version,p_request:p.update.request_id,p_data:p.data});return {row_key:p.update.row_key,ok:true,state};}
     catch(e){return {row_key:p.update.row_key,ok:false,error:e instanceof Error?e.message:String(e)};}
    })));}
    return json({ok:true,results});
   }
   if(action==='focus_save'){
    if(!isUuid(b.request_id)||!/^((icetak|shopee|draft|chat):[0-9a-f-]{36})$/.test(String(b.row_key||'')))return json({ok:false,error:'Invalid focus identity'},400);
    const row=rows.find((r:any)=>r.key===b.row_key);if(!row)return json({ok:false,error:'Row changed or unavailable. Muat semula.'},409);
    const data=validateFocusUpdate(b,row);
    const state=await rpc('icetak_customer_focus_save',{p_key:row.key,p_actor:admin.username,p_version:b.expected_version,p_request:b.request_id,p_data:data});
    return json({ok:true,state});
   }
   return json({ok:true,rows,capabilities:{can_manage:canManage},fetched_at:new Date().toISOString(),coverage:{orders:snapshot.order_total,drafts:drafts.total,chats:source.total,
    truncated:snapshot.orders_truncated||source.truncated||drafts.truncated,chat_messages:6,clickup:snapshot.clickup,
    inbox_checked_at:source.fetched_at,order_checked_at:snapshot.checked_at}});
  }
  if(action==='work'){
   const data=await rpc('icetak_ai_order_work_queue',{});
   const rows=(data.rows||[]).map((o:any)=>({...o,work:orderOperation(o)})).filter((o:any)=>o.work.active)
    .sort((a:any,b:any)=>b.work.priority-a.work.priority||(Date.parse(a.deadline)||Infinity)-(Date.parse(b.deadline)||Infinity)||a.reference.localeCompare(b.reference));
   return json({ok:true,...data,rows,active_total:rows.length,fetched_at:new Date().toISOString()});
  }
  if(action==='training_list'){
   const channel=['whatsapp','shopee'].includes(b.channel)?b.channel:'whatsapp';
   const intent=intentLabels[b.intent]?b.intent:'other';
   const scope=`channel=eq.${channel}&intent=eq.${intent}`;
   // Cross-customer suggestions expose only explicitly authored reusable SOP, never chat/order facts.
   const examples=await rest(`ai_dashboard_training?${scope}&state=eq.approved&select=id,lesson,reusable_response,reviewed_by,reviewed_at,version&order=reviewed_at.desc&limit=20`);
   return json({ok:true,examples});
  }
  const source=await inbox(action==='list'?{action:'list',channel:['whatsapp','shopee'].includes(b.channel)?b.channel:null,
   search:String(b.search||'').slice(0,100),offset:Math.max(0,Math.min(100000,Number(b.offset)||0)),limit:30}:
   {action:'detail',conversation_id:b.conversation_id,limit:1});
  const contexts=await rpc('icetak_ai_dashboard_context',{p_identities:source.rows.map(identity)});
  const conversationIds=source.rows.map((c:any)=>c.id).filter(isUuid);
  if(conversationIds.length){
   const bindings=await rest(`ai_dashboard_case_orders?conversation_id=in.(${conversationIds.join(',')})&select=*`);
   for(const binding of bindings){if(contexts[binding.conversation_id])contexts[binding.conversation_id].case_order=binding;}
  }
  if(action==='list'||action==='detail')await enrichContexts(contexts,rest);
  const globalSend=await enabled();
  const capabilities={can_manage:canManage,can_train:owner,whatsapp_api:globalSend&&source.capabilities?.whatsapp_api===true,
   shopee_api:source.capabilities?.shopee_api===true,send_reason:globalSend?'':'Penghantaran WhatsApp dimatikan dalam Control Center.'};
  if(action==='list')return json({ok:true,rows:source.rows.map((c:any)=>({...c,context:contexts[c.id],analysis:analyze(c,contexts[c.id]||{})})),
    has_more:source.rows.length===30,offset:source.offset,capabilities,fetched_at:source.fetched_at});
  const c=source.rows[0];if(!c)return json({ok:false,error:'Conversation not found'},404);
  const ctx=contexts[c.id]||{};
  if(action==='detail'){
   const recent=c.messages.filter((m:any)=>m.direction==='inbound').slice(-5).map((m:any)=>m.text_content||m.caption||'').join('\n');
   let semantic=null;try{if(recent)semantic=await inbox({action:'semantic',text:recent});}catch{/* deterministic SOP fallback is explicitly labelled */}
   const events=await rest(`ai_dashboard_events?conversation_id=eq.${c.id}&select=id,action,actor,created_at,after_state&order=created_at.desc&limit=10`);
   const training=await rest(`ai_dashboard_training?conversation_id=eq.${c.id}&select=*&order=created_at.desc&limit=20`);
   const analysis=analyze(c,ctx,semantic);
   const reply=await knowledgeReply(c,analysis,rest,rpc);
   analysis.suggestion=reply.text;analysis.response_text=ctx.review?.inbound_revision===c.inbound_revision&&ctx.review?.response_text?ctx.review.response_text:reply.text;analysis.engine=reply.engine;
   return json({ok:true,row:{...c,context:ctx,analysis:{...analysis,knowledge_sources:reply.knowledge_sources,style_version:reply.style_version}},events,training,capabilities,fetched_at:source.fetched_at});
  }
  if(b.inbound_revision!==c.inbound_revision||b.revision!==c.revision)return json({ok:false,error:'CHAT_CHANGED: Ada mesej baharu. Muat semula sebelum tindakan.'},409);
  if((Number(ctx.review?.version)||0)!==Number(b.expected_version))return json({ok:false,error:'REVIEW_CHANGED: Admin lain telah mengemas kini kad ini.'},409);
  if(!isUuid(b.request_id))return json({ok:false,error:'Request ID required'},400);
  const response=String(b.response_text||'').trim();
  if(action==='case_order'){
   if(!Number.isInteger(b.case_version)||b.case_version<0)return json({ok:false,error:'Invalid case version'},400);
   if(ctx.identity_status==='ambiguous')return json({ok:false,error:'Semak identiti CRM sebelum padankan order.'},409);
   const selected=b.order_id?caseOrders(ctx).find((o:any)=>o.id===b.order_id&&o.kind===b.order_kind):null;
   if(b.order_id&&!selected)return json({ok:false,error:'Order tidak berada dalam konteks pelanggan ini.'},400);
   const result=await rpc('icetak_ai_case_order',{p_actor:admin.username,p_request_id:b.request_id,p_data:{
    conversation_id:c.id,inbound_revision:c.inbound_revision,session_key:sessionKey(ctx),expected_version:Number(b.case_version),
    order_kind:selected?.kind||null,order_id:selected?.id||null,order_reference:selected?.reference||null}});
   return json({ok:true,...result});
  }
  if(action==='training'){
   const trainingAction=String(b.training_action||'capture');
   if(!['capture','approve','reject'].includes(trainingAction))return json({ok:false,error:'Invalid training action'},400);
   if(trainingAction!=='capture'&&!owner)return json({ok:false,error:'Owner diperlukan untuk meluluskan SOP.'},403);
   let data:any;
   if(trainingAction==='capture'){
    if(!['accepted','corrected','rejected'].includes(b.verdict)||String(b.lesson||'').trim().length<3||String(b.lesson||'').length>2000||response.length>4000||String(b.reusable_response||'').length>4000)return json({ok:false,error:'Semak penilaian dan nota latihan.'},400);
    if(b.verdict!=='rejected'&&!response)return json({ok:false,error:'Balasan yang dinilai diperlukan.'},400);
    const analysis=analyze(c,ctx);
    data={conversation_id:c.id,inbound_revision:c.inbound_revision,channel:c.channel,
     intent:intentLabels[b.intent_override]?b.intent_override:analysis.intent,verdict:b.verdict,
     evidence:analysis.evidence,original_response:analysis.suggestion,corrected_response:response,
     lesson:String(b.lesson).trim(),reusable_response:String(b.reusable_response||'').trim(),engine:analysis.engine,confidence:analysis.confidence};
   }else{
    if(!isUuid(b.training_id))return json({ok:false,error:'Invalid training ID'},400);
    const existing=await rest(`ai_dashboard_training?id=eq.${b.training_id}&conversation_id=eq.${c.id}&select=id&limit=1`);
    if(!existing.length)return json({ok:false,error:'Training example not found'},404);
    data={id:b.training_id,expected_version:Number(b.training_version)};
   }
   return json({ok:true,...await rpc('icetak_ai_dashboard_training',{p_action:trainingAction,p_actor:admin.username,p_request_id:b.request_id,p_data:data})});
  }
  if(action==='send'){
   if(c.channel==='whatsapp'&&!capabilities.whatsapp_api)return json({ok:false,error:capabilities.send_reason||'Provider API tidak tersedia'},409);
   if(c.channel==='shopee'&&!capabilities.shopee_api)return json({ok:false,error:'Shopee Chat belum disambung.'},503);
   if(b.approved!==true||!response||response.length>4000)return json({ok:false,error:'Semak dan sahkan balasan dahulu.'},400);
   if(ctx.identity_status==='ambiguous')return json({ok:false,error:'Semak padanan CRM dahulu.'},409);
   const orderIds=(ctx.orders||[]).map((o:any)=>o.id).filter(isUuid);
   if(c.channel==='whatsapp'&&orderIds.length){
    const optouts=await rest(`orders?id=in.(${orderIds.join(',')})&whatsapp_opt_in=eq.false&select=id&limit=1`);
    if(optouts.length)return json({ok:false,error:'Ada order pelanggan ini dengan WhatsApp opt-out. Semak order sebelum hantar API.'},409);
   }
   const result=await inbox({action:'send_text',conversation_id:c.id,request_id:b.request_id,
    actor:admin.username,text:response,revision:c.revision,approved:true});
   return json({...result,capabilities});
  }
  if(b.intent_override&&!intentLabels[b.intent_override])return json({ok:false,error:'Invalid intent'},400);
  const result=await rpc('icetak_ai_dashboard_review',{
   p_conversation_id:c.id,p_inbound_revision:c.inbound_revision,p_expected_version:Number(b.expected_version),
   p_actor:admin.username,p_request_id:b.request_id,p_action:b.review_action,
   p_response:response,p_note:String(b.note||''),p_intent:b.intent_override||null,
   p_snoozed_until:b.review_action==='snooze'?new Date(Date.now()+24*3600000).toISOString():null});
  return json({ok:true,...result});
 }catch(error){const message=error instanceof Error?error.message:String(error);
  console.error(JSON.stringify({event:'admin_dashboard_error',message}));
  return json({ok:false,error:message},/FOCUS_CHANGED|SOURCE_CHANGED|REQUEST_CONFLICT|CHAT_CHANGED|REVIEW_CHANGED|TRAINING_CHANGED|CASE_CHANGED|Request ID conflict/.test(message)?409:500);}
});
