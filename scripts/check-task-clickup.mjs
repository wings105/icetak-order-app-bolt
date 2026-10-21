import assert from 'node:assert/strict';
import {createTaskClickUpHandler} from '../supabase/functions/task-clickup/handler.ts';

// Controlled provider/database transport. Never contacts ClickUp or a live database.
const taskId='qa-task',fileId='bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
const id=()=>crypto.randomUUID();
function fixture(){
 const state={role:'owner',permissions:[],token:'',receipts:new Map(),provider:[],projected:[],comments:[],status:'design edible image',updated:'1000',failVerify:false,attachmentUncertain:false,invalidFile:false,unauthorized:false};
 const png=new Uint8Array([137,80,78,71,13,10,26,10]);
 const json=(data,status=200)=>Response.json(data,{status});
 const fetcher=async(input,options={})=>{
  const u=new URL(input),method=options.method||'GET',body=typeof options.body==='string'?JSON.parse(options.body):options.body;
  if(u.hostname==='api.clickup.com'){
   state.provider.push({path:u.pathname,method,body});assert.equal(options.headers.authorization,'qa-not-a-real-token');
   if(u.pathname.endsWith('/list/18375902'))return json({id:'18375902',statuses:[{status:'design edible image'},{status:'review'}]});
   if(u.pathname.endsWith('/attachment')){assert(body instanceof FormData);const file=body.get('attachment');assert.equal(file.name,'final.png');assert.deepEqual(new Uint8Array(await file.arrayBuffer()),png);if(state.attachmentUncertain)return json({},503);return json({id:'attachment-1',url:'https://attachments.clickup.com/qa/final.png'});}
   if(u.pathname.endsWith('/comment')){
    if(method==='POST'){assert.equal(body.notify_all,false);const comment={id:String(state.comments.length+1),comment_text:body.comment_text};state.comments.unshift(comment);return json(comment);}
    if(state.failVerify){state.failVerify=false;throw Error('controlled readback timeout');}return json({comments:state.comments});
   }
   if(method==='PUT'){state.status=body.status;state.updated='1001';}
   return json({id:taskId,list:{id:'18375902'},status:{status:state.status},date_updated:state.updated});
  }
  assert.equal(u.hostname,'qa.supabase.co');
  if(u.pathname==='/auth/v1/user')return state.unauthorized?json({},401):json({id:'qa-user'});
  if(u.pathname.endsWith('/admin_users'))return json([{username:'qa-designer',role:state.role}]);
  if(u.pathname.endsWith('/admin_permissions'))return json([{permissions:state.permissions}]);
  if(u.pathname.endsWith('/private_runtime_settings')){if(method==='POST'){assert(options.headers.prefer.includes('resolution=merge-duplicates'));state.token=body[0].setting_value;return json(body);}return json(state.token?[{setting_value:state.token}]:[]);}
  if(u.pathname.endsWith('/rpc/icetak_task_workspace_read'))return json({items:[{task_id:taskId,source_status:'design edible image'}]});
  if(u.pathname.endsWith('/rpc/icetak_project_clickup_work')){state.projected.push(body);return json({ok:true});}
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
 const call=async(body,auth=true)=>{const result=await handler(new Request('https://qa.supabase.co/functions/v1/task-clickup',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer fixture-session'}:{})},body:JSON.stringify(body)}));return {status:result.status,body:await result.json()};};
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
 const options=await call({action:'options',task_id:taskId});assert.equal(options.body.statuses.length,2);
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
console.log('PASS task ClickUp: auth, owner connection, live options, stale status, readback, replay, file ownership/bytes, duplicate suppression, timeout reconciliation, no resend after uncertain upload. No live writes.');
