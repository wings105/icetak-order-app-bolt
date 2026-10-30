import assert from 'node:assert/strict';
import {handleActionRequest,signActionGrant,actionAvailability} from '../supabase/functions/awb-preview/actions.ts';
import {REVIEW_FIELD} from '../supabase/functions/task-clickup/panel.ts';
const version='2026-10-22T19:04:44.942+00:00',secret='controlled-key';
let configured=true,claim='claimed',finish,projects=[],writes=[],fail='',taskId='TASK123',order='ORDER123',listId='18375902',fieldValue=null,status='printing';
const options=[{id:'address-option',name:'AWB/address printed',orderindex:0},{id:'finished-option',name:'FINISHED product Printed',orderindex:1}];
let reviewOptions=options;
const task=()=>({id:taskId,name:'Synthetic task',list:{id:listId},date_updated:'12345',status:{status},custom_fields:[{id:REVIEW_FIELD,type_config:{options:reviewOptions},value:fieldValue},{name:'order id / customer name',value:order}]});
const db={from(){return {select(){return this},eq(){return this},async maybeSingle(){return {data:{setting_value:configured?'private-test-token':'',updated_at:version}}}}},async rpc(name,args){
 if(name==='claim_awb_preview_action')return {data:{state:claim}};
 if(name==='finish_awb_preview_action'){finish=args;return {};}
 projects.push(name);if(fail==='projection')return {error:Error('projection unavailable')};return {};
}};
const fetcher=async(url,init)=>{
 assert.ok(url.startsWith('https://api.clickup.com/api/v2/'));assert.equal(init.headers.authorization,'private-test-token');assert.equal(init.redirect,'error');
 const method=init.method;
 if(method==='GET'){
  if(fail==='readback'&&writes.length)return new Response(null,{status:503});
  if(url.endsWith('/list/18375902'))return Response.json({statuses:[{status:'complete',type:'closed'}]});
  return Response.json(task());
 }
 writes.push({url,method,body:JSON.parse(init.body)});
 if(fail==='timeout')throw Error('timeout');
 if(fail==='reject')return new Response(null,{status:401});
 if(fail==='provider500')return new Response(null,{status:503});
 if(method==='POST')fieldValue=JSON.parse(init.body).value;else status=JSON.parse(init.body).status;
 if(fail==='mismatch')fieldValue=null;
 return Response.json({});
};
const grant=await signActionGrant(secret,{order_id:'ORDER123',task_ids:['TASK123'],version:'native-clickup-v1:'+version,expires:Date.now()+60000});
const req=(buton,extra={})=>new Request('https://test.invalid',{method:'POST',body:JSON.stringify({buton,order_id:'ORDER123',task_id_clickup:'TASK123',request_id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',action_token:grant,...extra})});
function reset(){writes=[];projects=[];finish=null;fail='';claim='claimed';fieldValue=null;status='printing';taskId='TASK123';order='ORDER123';listId='18375902';reviewOptions=options;}
for(const [buton,value] of [[1,'address-option'],[2,'finished-option'],[3,'complete']]){
 reset();const r=await handleActionRequest(req(buton),db,secret,fetcher);assert.equal(r.body.verified,true);assert.equal(finish.p_state,'sent');assert.equal(writes.length,1);
 assert.deepEqual(writes[0],buton===3?{url:'https://api.clickup.com/api/v2/task/TASK123',method:'PUT',body:{status:value}}:{url:'https://api.clickup.com/api/v2/task/TASK123/field/'+REVIEW_FIELD,method:'POST',body:{value}});
 assert.deepEqual(projects,['icetak_project_clickup_work','ingest_clickup_event']);
 const repeated=await handleActionRequest(req(buton),db,secret,fetcher);assert.equal(repeated.body.unchanged,true);assert.equal(writes.length,1);
}
for(const error of ['timeout','provider500','readback','mismatch','projection']){reset();fail=error;const r=await handleActionRequest(req(1),db,secret,fetcher);assert.equal(r.body.uncertain,true,error);assert.equal(finish.p_state,'unknown');}
reset();fail='reject';assert.equal((await handleActionRequest(req(1),db,secret,fetcher)).body.retryable,true);assert.equal(finish.p_state,'failed');
for(const invalid of ['task','order','list','option']){reset();if(invalid==='task')taskId='OTHER';if(invalid==='order')order='OTHER';if(invalid==='list')listId='OTHER';if(invalid==='option')reviewOptions=[];assert.equal((await handleActionRequest(req(1),db,secret,fetcher)).body.ok,false);assert.equal(writes.length,0);}
for(const extra of [{action_token:'bad'},{task_id_clickup:'OTHER'},{order_id:'OTHER'},{buton:4}]){reset();assert.ok((await handleActionRequest(req(1,extra),db,secret,fetcher)).status>=400);assert.equal(writes.length,0);}
for(const state of ['sent','pending','unknown','rejected']){reset();claim=state;const r=await handleActionRequest(req(1),db,secret,fetcher);assert.equal(r.status,state==='sent'?200:409);assert.equal(writes.length,0);}
reset();status='complete';listId='901612769752';assert.equal((await handleActionRequest(req(3),db,secret,fetcher)).body.unchanged,true);assert.equal(writes.length,0);
reset();configured=false;assert.deepEqual(await actionAvailability(db,secret,'ORDER123',['TASK123']),{enabled:false,token:null});assert.equal((await handleActionRequest(req(1),db,secret,fetcher)).status,409);
console.log('PASS: native AWB 1/2/3 exact provider writes, readback/projection, no-op, guards, duplicate and uncertain outcomes');
