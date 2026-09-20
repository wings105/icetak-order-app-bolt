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


async function rpc(name:string,body:unknown) {
 const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{
 method:'POST',headers:{apikey:SERVICE_ROLE_KEY,authorization:`Bearer ${SERVICE_ROLE_KEY}`,'content-type':'application/json'},
 body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
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
const isUuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''));
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
  if(!['list','detail','review','send','training','training_list','case_order'].includes(action))return json({ok:false,error:'Invalid action'},400);
  if(!['list','training_list'].includes(action)&&!isUuid(b.conversation_id))return json({ok:false,error:'Invalid conversation ID'},400);
  if(['review','send','training','case_order'].includes(action)&&!canManage)return json({ok:false,error:'Manage Customers permission required'},403);
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
  const globalSend=await enabled();
  const capabilities={can_manage:canManage,can_train:owner,whatsapp_api:globalSend&&source.capabilities?.whatsapp_api===true,
   shopee_api:false,send_reason:globalSend?'':'Penghantaran WhatsApp dimatikan dalam Control Center.'};
  if(action==='list')return json({ok:true,rows:source.rows.map((c:any)=>({...c,context:contexts[c.id],analysis:analyze(c,contexts[c.id]||{})})),
    has_more:source.rows.length===30,offset:source.offset,capabilities,fetched_at:source.fetched_at});
  const c=source.rows[0];if(!c)return json({ok:false,error:'Conversation not found'},404);
  const ctx=contexts[c.id]||{};
  if(action==='detail'){
   const recent=c.messages.filter((m:any)=>m.direction==='inbound').slice(-5).map((m:any)=>m.text_content||m.caption||'').join('\n');
   let semantic=null;try{if(recent)semantic=await inbox({action:'semantic',text:recent});}catch{/* deterministic SOP fallback is explicitly labelled */}
   const events=await rest(`ai_dashboard_events?conversation_id=eq.${c.id}&select=id,action,actor,created_at,after_state&order=created_at.desc&limit=10`);
   const training=await rest(`ai_dashboard_training?conversation_id=eq.${c.id}&select=*&order=created_at.desc&limit=20`);
   return json({ok:true,row:{...c,context:ctx,analysis:analyze(c,ctx,semantic)},events,training,capabilities,fetched_at:source.fetched_at});
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
   if(!capabilities.whatsapp_api)return json({ok:false,error:capabilities.send_reason||'Provider API tidak tersedia'},409);
   if(c.channel!=='whatsapp')return json({ok:false,error:'Shopee: gunakan balasan manual di Seller Chat.'},409);
   if(b.approved!==true||!response||response.length>4000)return json({ok:false,error:'Semak dan sahkan balasan dahulu.'},400);
   if(ctx.identity_status==='ambiguous')return json({ok:false,error:'Semak padanan CRM dahulu.'},409);
   const orderIds=(ctx.orders||[]).map((o:any)=>o.id).filter(isUuid);
   if(orderIds.length){
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
  return json({ok:false,error:message},/CHAT_CHANGED|REVIEW_CHANGED|TRAINING_CHANGED|CASE_CHANGED|Request ID conflict/.test(message)?409:500);}
});
