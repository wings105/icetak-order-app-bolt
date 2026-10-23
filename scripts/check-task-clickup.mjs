import assert from 'node:assert/strict';
import {createTaskClickUpHandler} from '../supabase/functions/task-clickup/handler.ts';
import {REVIEW_FIELD,reviewField,taskAttachments,clickUpAssetUrl,originalAttachment} from '../supabase/functions/task-clickup/panel.ts';
import {previewItem} from '../supabase/functions/awb-preview/preview.ts';

// Controlled provider/database transport. Never contacts ClickUp or a live database.
const taskId='qa-task',fileId='bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
const id=()=>crypto.randomUUID();
const reviewId='ecf21a74-be74-4126-b288-c2f3c4ff72b2',otherReview='b1970996-4d58-47ec-9add-32b6c32c65cf';
const reviewOptions=[{id:reviewId,name:'FINISHED product Printed',orderindex:0,color:'#000'},{id:otherReview,name:'AWB/address printed',orderindex:1,color:'#ee00ee'}];
function fixture(){
 const state={role:'owner',permissions:[],token:'',receipts:new Map(),provider:[],projected:[],ingested:[],comments:[],status:'design edible image',review:null,updated:'1000',failVerify:false,failTaskRead:false,rejectField:false,attachmentUncertain:false,invalidFile:false,unauthorized:false,attachments:[]};
 const png=new Uint8Array([137,80,78,71,13,10,26,10]);
 const json=(data,status=200)=>Response.json(data,{status});
 const fetcher=async(input,options={})=>{
  const u=new URL(input),method=options.method||'GET',body=typeof options.body==='string'?JSON.parse(options.body):options.body;
  if(u.hostname==='api.clickup.com'){
   state.provider.push({path:u.pathname,method,body});assert.equal(options.headers.authorization,'qa-not-a-real-token');
   if(u.pathname.endsWith('/list/18375902'))return json({id:'18375902',statuses:[{status:'design edible image'},{status:'review'},{status:'complete',type:'closed'}]});
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
  if(u.pathname.endsWith('/admin_users'))return json([{username:'qa-designer',role:state.role}]);
  if(u.pathname.endsWith('/admin_permissions'))return json([{permissions:state.permissions}]);
  if(u.pathname.endsWith('/private_runtime_settings')){if(method==='POST'){assert(options.headers.prefer.includes('resolution=merge-duplicates'));state.token=body[0].setting_value;return json(body);}return json(state.token?[{setting_value:state.token}]:[]);}
  if(u.pathname.endsWith('/rpc/icetak_task_workspace_read'))return json({items:[{task_id:taskId,source_status:'design edible image'}]});
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
 const handler=createTaskClickUpHandler({url:'https://qa.supabase.co',key:'fixture-service-only',fetcher});
 const call=async(body,auth=true)=>{const result=await handler(new Request('https://qa.supabase.co/functions/v1/task-clickup',{method:'POST',headers:{...(!(body instanceof FormData)?{'content-type':'application/json'}:{}),...(auth?{authorization:'Bearer fixture-session'}:{})},body:body instanceof FormData?body:JSON.stringify(body)}));return {status:result.status,body:await result.json()};};
 return {state,call};
}
{
 const {state,call}=fixture();assert.equal((await call({action:'connection'},false)).status,401);
 state.role='staff';state.permissions=['view_orders'];assert.equal((await call({action:'connect',token:'qa-not-a-real-token'})).status,403);
 assert.equal((await call({action:'status',task_id:taskId,request_id:id()})).status,503);assert.equal(state.provider.length,0);
 const options=await call({action:'options',task_id:taskId});assert.equal(options.body.configured,false);assert.equal(state.provider.length,0);
 state.permissions=[];assert.equal((await call({action:'connection'})).status,403);
}
{
 const {state,call}=fixture();const connected=await call({action:'connect',token:'qa-not-a-real-token'});assert.equal(connected.status,200);assert(!JSON.stringify(connected).includes(state.token));
 const options=await call({action:'options',task_id:taskId});assert.equal(options.body.statuses.length,3);assert.equal(options.body.review.id,REVIEW_FIELD);
 const payload={action:'status',task_id:taskId,request_id:id(),status:'review',expected_status:'design edible image',expected_updated_at:'old'};
 assert.equal((await call(payload)).status,409);assert.equal(state.provider.filter(c=>c.method==='PUT').length,0);
 payload.expected_updated_at='1000';payload.request_id=id();assert.equal((await call(payload)).body.verified,true);assert.equal((await call(payload)).body.replayed,true);
 assert.equal(state.provider.filter(c=>c.method==='PUT').length,1);assert.equal(state.projected.length,1);assert.equal(state.receipts.get(payload.request_id).state,'succeeded');
 assert.equal((await call({...payload,status:'design edible image'})).status,409);
}
{
 const {state,call}=fixture();state.token='qa-not-a-real-token';state.invalidFile=true;
 const result=await call({action:'comment',task_id:taskId,request_id:id(),file_id:fileId,comment:'Final'});assert.equal(result.status,400);assert.equal(state.provider.length,0);
 state.invalidFile=false;const payload={action:'comment',task_id:taskId,request_id:id(),file_id:fileId,comment:'Final untuk set 1'};
 const sent=await call(payload);assert.equal(sent.body.verified,true);assert.equal(state.comments.length,1);assert(state.comments[0].comment_text.includes('https://attachments.clickup.com/qa/final.png'));assert(state.comments[0].comment_text.includes(payload.request_id));
 assert.equal((await call(payload)).body.replayed,true);assert.equal((await call({...payload,request_id:id()})).status,409);assert.equal(state.comments.length,1);assert.equal(state.provider.filter(c=>c.path.endsWith('/attachment')).length,1);
}
{
 const {state,call}=fixture();state.token='qa-not-a-real-token';state.failVerify=true;
 const payload={action:'comment',task_id:taskId,request_id:id(),file_id:null,comment:'Semak layout ini'};
 const uncertain=await call(payload);assert.equal(uncertain.body.uncertain,true);assert.equal(state.receipts.get(payload.request_id).state,'unknown');
 assert.equal((await call(payload)).status,409);assert.equal(state.comments.length,1);
 assert.equal((await call({action:'receipt',task_id:taskId,request_id:payload.request_id})).body.verified,true);assert.equal(state.receipts.get(payload.request_id).state,'succeeded');assert.equal(state.comments.length,1);
}
{
 const {state,call}=fixture();state.token='qa-not-a-real-token';state.attachmentUncertain=true;
 const payload={action:'comment',task_id:taskId,request_id:id(),file_id:fileId,comment:''};
 assert.equal((await call(payload)).body.uncertain,true);assert.equal((await call(payload)).status,409);
 assert.equal(state.provider.filter(c=>c.path.endsWith('/attachment')).length,1);assert.equal(state.comments.length,0);
}
{
 const {state,call}=fixture();state.token='qa-not-a-real-token';
 const payload={action:'field',task_id:taskId,request_id:id(),field_id:REVIEW_FIELD,value:reviewId,expected_value:null,expected_updated_at:'1000'};
 state.role='staff';state.permissions=['view_orders'];assert.equal((await call(payload)).status,403);state.role='owner';
 assert.equal((await call({...payload,field_id:otherReview})).status,400);
 assert.equal((await call({...payload,expected_updated_at:'old',request_id:id()})).status,409);assert.equal(state.provider.filter(x=>x.path.includes('/field/')).length,0);
 const result=await call(payload);assert.equal(result.body.review.value,reviewId);assert(result.body.verified);assert.equal((await call(payload)).body.replayed,true);assert.equal(state.provider.filter(x=>x.path.includes('/field/')).length,1);
 const cleared=await call({...payload,request_id:id(),value:null,expected_value:reviewId,expected_updated_at:'1001'});assert.equal(cleared.body.review.value,null);assert.equal(state.provider.filter(x=>x.method==='DELETE').length,1);
 const complete=await call({action:'status',task_id:taskId,request_id:id(),status:'complete',expected_status:'design edible image',expected_updated_at:'1002'});assert(complete.body.verified);assert.equal(state.status,'complete');
}
{
 const {state,call}=fixture();state.token='qa-not-a-real-token';
 const form=new FormData(),request=id();form.set('payload',JSON.stringify({action:'direct_upload',task_id:taskId,request_id:request,comment:'Direct binary'}));form.set('file',new File([new Uint8Array([137,80,78,71,13,10,26,10])],'final.png',{type:'image/png'}));
 assert.equal((await call(form)).body.verified,true);assert.equal((await call(form)).body.replayed,true);assert.equal(state.provider.filter(x=>x.path.endsWith('/attachment')).length,1);assert.equal(state.comments.length,1);assert.equal(state.projected.length,1);
 const raw=state.ingested[0].raw_payload,images=raw.history_items[0].comment.comment.map(c=>c.image);assert.equal(previewItem({attachments:raw.task.attachments,comment_images:images}).images[0].url,'https://attachments.clickup.com/qa/final.png');
}
assert.equal(reviewField({custom_fields:[{id:REVIEW_FIELD,value:0,type_config:{options:reviewOptions}}]}).value,reviewId);
const assets=taskAttachments({attachments:[{id:'one',title:'full.png',url:'https://attachments.clickup.com/full.png',thumbnail_small:'https://attachments.clickup.com/thumb.png',extension:'png'}],custom_fields:[{type:'attachment',name:'File',value:[{id:'native',title:'layers.psd',url:'https://attachments.clickup.com/layers.psd'}]}]},[{comment:[{type:'image',image:{id:'two',title:'older.png',url:'https://attachments.clickup.com/older.png'}},{image:{id:'one',url:'https://attachments.clickup.com/full.png?new=1'}}]}]);
assert.equal(assets.length,3);assert.equal(assets.find(a=>a.id==='one').url,'https://attachments.clickup.com/full.png');assert.equal(assets.find(a=>a.id==='one').thumbnail,'https://attachments.clickup.com/thumb.png');assert(!assets.find(a=>a.id==='native').is_image);
for(const url of ['https://evil.test/a','https://user:pass@attachments.clickup.com/a','https://attachments.clickup.com:444/a','http://attachments.clickup.com/a'])assert.equal(clickUpAssetUrl(url),'');
await assert.rejects(originalAttachment(assets[0],async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}})),/INVALID_ATTACHMENT_HOST/);
const native=new Uint8Array([56,66,80,83,0,1]);assert.deepEqual((await originalAttachment(assets.find(a=>a.id==='native'),async()=>new Response(native))).bytes,native);
console.log('PASS task ClickUp: auth, live dropdowns, review field allowlist/options/clear/stale/readback/replay, Complete task, direct binary upload without Storage, native-file bytes, paged-comment attachment parsing/dedup, thumbnail versus original, download host/redirect limits, existing upload/receipt guards. No live writes.');
