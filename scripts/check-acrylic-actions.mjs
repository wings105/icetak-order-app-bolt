import assert from 'node:assert/strict';
import {createAcrylicActionsHandler,acrylicDigest} from '../supabase/functions/acrylic-production-actions/handler.ts';
import {REVIEW_FIELD,reviewField,taskAttachments,clickUpAssetUrl,originalAttachment} from '../supabase/functions/task-clickup/panel.ts';
import {previewItem} from '../supabase/functions/awb-preview/preview.ts';

// Controlled provider/database transport. Never contacts ClickUp or a live database.
const taskId='qa-task',fileId='bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
const id=()=>crypto.randomUUID();
const reviewId='ecf21a74-be74-4126-b288-c2f3c4ff72b2',otherReview='b1970996-4d58-47ec-9add-32b6c32c65cf';
const reviewOptions=[{id:reviewId,name:'FINISHED product Printed',orderindex:0,color:'#000'},{id:otherReview,name:'AWB/address printed',orderindex:1,color:'#ee00ee'}];
async function fixture(){
 const capability='ap_'+ 'a'.repeat(64),digest=await acrylicDigest(capability);
 const state={role:'staff',permissions:['view_orders','edit_order'],token:'qa-not-a-real-token',enabled:true,active:true,inScope:true,receipts:new Map(),provider:[],projected:[],ingested:[],comments:[],status:'acrylic',review:null,updated:'1000',failVerify:false,failTaskRead:false,rejectField:false,attachmentUncertain:false,invalidFile:false,unauthorized:false,attachments:[]};
 const png=new Uint8Array([137,80,78,71,13,10,26,10]);
 const json=(data,status=200)=>Response.json(data,{status});
 const fetcher=async(input,options={})=>{
  const u=new URL(input),method=options.method||'GET',body=typeof options.body==='string'?JSON.parse(options.body):options.body;
  if(u.hostname==='api.clickup.com'){
   state.provider.push({path:u.pathname,method,body});assert.equal(options.headers.authorization,'qa-not-a-real-token');
   if(u.pathname.endsWith('/list/18375902'))return json({id:'18375902',statuses:[{status:'acrylic'},{status:'review'},{status:'complete',type:'closed'}]});
   if(u.pathname.includes('/field/')){if(state.rejectField)return json({},400);state.review=method==='DELETE'?null:body.value;state.updated=String(Number(state.updated)+1);return json({});}
   if(u.pathname.endsWith('/attachment')){assert(body instanceof FormData);const file=body.get('attachment');assert.equal(file.name,'final.png');assert.deepEqual(new Uint8Array(await file.arrayBuffer()),png);if(state.attachmentUncertain)return json({},503);const attachment={id:'attachment-1',title:'final.png',url:'https://attachments.clickup.com/qa/final.png'};state.attachments.push(attachment);return json(attachment);}
   if(u.pathname.endsWith('/comment')){
    if(method==='POST'){assert.equal(body.notify_all,false);const comment={id:String(state.comments.length+1),comment_text:body.comment_text};state.comments.unshift(comment);return json(comment);}
    if(state.failVerify){state.failVerify=false;throw Error('controlled readback timeout');}return json({comments:state.comments});
   }
   if(method==='PUT'){state.status=body.status;state.updated='1001';}
   if(state.failTaskRead){state.failTaskRead=false;return json({},429);}
   return json({id:taskId,name:'QA task',list:{id:'18375902'},status:{status:state.status},date_updated:state.updated,attachments:state.attachments,custom_fields:[{id:REVIEW_FIELD,name:'Review customer',type:'drop_down',value:state.review,type_config:{options:reviewOptions}}]});
  }
  assert.equal(u.hostname,'qa.supabase.co');
  if(u.pathname==='/auth/v1/user')return state.unauthorized?json({},401):json({id:'qa-user'});
  if(u.pathname.endsWith('/admin_users'))return json(state.active?[{username:'acrylic_station_12345678',role:state.role,auth_user_id:null}]:[]);
  if(u.pathname.endsWith('/admin_permissions'))return json([{permissions:state.permissions}]);
  if(u.pathname.endsWith('/rpc/icetak_acrylic_production_snapshot'))return json({rows:state.inScope?[{task_id:taskId,title:'1x Gold,A7',status:'acrylic',jobs:['Acrylic cake topper'],sets:[],order_reference:'QA',updated_at:new Date().toISOString()}]:[]});
  if(u.pathname.endsWith('/private_runtime_settings')&&u.searchParams.get('setting_key')==='eq.acrylic_production_station')return json([{setting_value:JSON.stringify({enabled:state.enabled,digest,actor:'acrylic_station_12345678'})}]);
  if(u.pathname.endsWith('/private_runtime_settings')){if(method==='POST'){assert(options.headers.prefer.includes('resolution=merge-duplicates'));state.token=body[0].setting_value;return json(body);}return json(state.token?[{setting_value:state.token}]:[]);}
  if(u.pathname.endsWith('/rpc/icetak_task_workspace_read'))return json({items:[{task_id:taskId,source_status:'acrylic'}]});
  if(u.pathname.endsWith('/rpc/icetak_project_clickup_work')){state.projected.push(body);return json({ok:true});}
  if(u.pathname.endsWith('/rpc/ingest_clickup_event')){assert.equal(body.p_event.raw_payload.task.id,taskId);state.ingested.push(body.p_event);return json({accepted:true});}
  if(u.pathname.endsWith('/rpc/icetak_claim_task_clickup_action')){
   const existing=state.receipts.get(body.p_request);
   if(existing){if(JSON.stringify(existing.payload)!==JSON.stringify(body.p_payload))return json({message:'REQUEST_CONFLICT'},409);return json({claimed:false,receipt:existing});}
   if([...state.receipts.values()].some(r=>r.fingerprint===body.p_fingerprint))return json({message:'DUPLICATE_ACTION'},409);
   if(state.invalidFile&&body.p_payload.file_id)return json({message:'INVALID_TASK_FILE'},409);
   const receipt={request_id:body.p_request,task_id:body.p_task,actor:body.p_actor,kind:body.p_kind,fingerprint:body.p_fingerprint,payload:body.p_payload,state:'processing',result:{}};
   state.receipts.set(body.p_request,receipt);return json({claimed:true,receipt});
  }
  if(u.pathname.endsWith('/task_clickup_actions')){
   const receipt=state.receipts.get(u.searchParams.get('request_id')?.slice(3));
   if(method==='PATCH'){Object.assign(receipt,body);return json([receipt]);}return json(receipt?[receipt]:[]);
  }
  if(u.pathname.endsWith('/task_workspace_files'))return json(state.invalidFile?[]:[{id:fileId,task_id:taskId,storage_path:'qa/final.png',name:'final.png',mime:'image/png'}]);
  if(u.pathname.includes('/storage/v1/object/task-workspace/'))return new Response(png,{headers:{'content-type':'image/png'}});
  throw Error('Unexpected controlled transport: '+u.pathname);
 };
 const handler=createAcrylicActionsHandler({url:'https://qa.supabase.co',key:'fixture-service-only',fetcher});
 const call=async(body,auth=true)=>{const result=await handler(new Request('https://qa.supabase.co/functions/v1/task-clickup',{method:'POST',headers:{...(!(body instanceof FormData)?{'content-type':'application/json'}:{}),...(auth?{authorization:'Bearer '+capability}:{})},body:body instanceof FormData?body:JSON.stringify(body)}));return {status:result.status,body:await result.json()};};
 return {state,call,handler,capability};
}

const {state,call,handler,capability}=await fixture();
assert.equal((await call({action:'options',task_id:taskId},false)).status,401);
state.enabled=false;assert.equal((await call({action:'options',task_id:taskId})).status,401);state.enabled=true;
state.active=false;assert.equal((await call({action:'options',task_id:taskId})).status,403);state.active=true;
state.permissions=['view_orders'];assert.equal((await call({action:'options',task_id:taskId})).status,403);state.permissions=['view_orders','edit_order'];
for(const action of ['connect','comment','direct_upload','attachments'])assert.equal((await call({action,task_id:taskId})).status,400);
state.inScope=false;assert.equal((await call({action:'options',task_id:taskId})).status,409);state.inScope=true;
let options=await call({action:'options',task_id:taskId});assert.equal(options.status,200);assert.equal(options.body.can_edit,true);assert.equal(options.body.fields,undefined);assert.equal(options.body.attachments,undefined);
for(const value of [reviewId,otherReview]){
 options=(await call({action:'options',task_id:taskId})).body;
 const payload={action:'field',task_id:taskId,request_id:id(),field_id:REVIEW_FIELD,value,expected_value:options.review.value,expected_updated_at:options.updated_at};
 const result=await call(payload);assert.equal(result.body.verified,true);assert.equal(state.review,value);assert.equal((await call({action:'receipt',task_id:taskId,request_id:payload.request_id})).body.verified,true);
}
assert.equal((await call({action:'field',task_id:taskId,request_id:id(),field_id:REVIEW_FIELD,value:'other'})).status,400);
assert.equal((await call({action:'status',task_id:taskId,status:'review',request_id:id()})).status,400);
options=(await call({action:'options',task_id:taskId})).body;
const complete={action:'status',task_id:taskId,status:'complete',expected_status:options.status,expected_updated_at:options.updated_at,request_id:id()};
assert.equal((await call(complete)).body.verified,true);assert.equal(state.status,'complete');
state.inScope=false;assert.equal((await call({action:'receipt',task_id:taskId,request_id:complete.request_id})).body.verified,true);
assert.equal(state.receipts.get(complete.request_id).actor,'acrylic_station_12345678');
assert(state.projected.length>=3);assert(state.ingested.length>=3);
assert.equal((await handler(new Request('https://qa.supabase.co',{method:'POST',headers:{origin:'https://evil.example',authorization:'Bearer '+capability,'content-type':'application/json'},body:'{}'}))).status,403);
console.log('Acrylic trusted PC: real shared ClickUp handler verified Printed, AWB and Complete with provider readback, projection/audit, receipt after removal, scoped actions, field/status restrictions, redaction, revoked/anonymous/inactive/permission denial.');
