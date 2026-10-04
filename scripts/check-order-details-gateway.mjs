// Execute the real gateway with controlled external reads/saves. No production writes.
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {focusRows} from '../supabase/functions/admin-ai-dashboard/focus.ts';
const dir=await mkdtemp(join(tmpdir(),'focus-gateway-')),sourceDir=new URL('../supabase/functions/admin-ai-dashboard/',import.meta.url);
const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;
let handler,role='owner',failSave='',requests=[],events=new Map();
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const now=new Date().toISOString(),master='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const order={id:ids[0],kind:'shopee',reference:'QA-ORDER',master_id:master,status:'READY_TO_SHIP',payment_status:'paid',created_at:now,items:[{id:'line0',title:'[CUSTOM NAME] Happy Birthday Cake Topper',sku:'CN0270',quantity:1}],production_tasks:[{id:'qa-task',progress_stage:2,rule_matched:true,source_updated_at:now}]};
const chat={id:ids[1],channel:'shopee',name:'qa.username',inbound_revision:'r1',last_inbound_at:now,messages:[{direction:'inbound',message_type:'text',text_content:'Aina\n7 tahun',created_at:now}]};
const chats=[chat],identities={[chat.id]:{master_id:master,identity_status:'matched'}},snapshot={orders:[order],states:{},reviews:{}};
function payload(row,work='handled',request_id=crypto.randomUUID()){return {row_key:row.key,expected_version:row.state.version,source_fingerprint:row.source_fingerprint,request_id,data:{...row.state.data,detail_status:'unknown',work_state:work,note:'Replied externally',actor:'spoofed',payment_status:'paid'}};}
function current(){return focusRows(snapshot,chats,identities);}
async function request(body,auth=true){const res=await handler(new Request('https://fixture.local',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer fixture-only'}:{})},body:JSON.stringify(body)}));return {status:res.status,body:await res.json()};}
try{
 const input=(await readFile(new URL('index.ts',sourceDir),'utf8')).replace(/import "jsr:[^\n]+\n/,'').replaceAll("from './",`from '${sourceDir.href}`);
 await writeFile(join(dir,'index.mjs'),ts.transpileModule(input,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 globalThis.Deno={env:{get:()=> 'fixture-only'},serve:fn=>{handler=fn;}};
 globalThis.fetch=async(url,options={})=>{
  const path=String(url),body=options.body?JSON.parse(options.body):null;requests.push({path,body});let data;
  if(path.includes('/auth/v1/user'))data={id:'fixture-admin'};
  else if(path.includes('admin_users?'))data=[{username:'trusted-admin',role}];
  else if(path.includes('admin_permissions?'))data=[{permissions:role==='reader'?['view_customers']:[]}];
  else if(path.includes('private_runtime_settings?'))data=[{setting_value:'fixture-only-bridge'}];
  else if(path.includes('/ai-dashboard-bridge'))data=body.action==='order_details'?{contexts:Object.fromEntries(body.orders.map(o=>[o.key,{bindings:[{id:chat.id,usable:true,revision:chat.inbound_revision,start_at:now}],messages:chat.messages}]))}:{rows:chats,total:chats.length};
  else if(path.includes('order_sessions?'))data=[];
  else if(path.includes('customer_focus_events?')){const id=path.match(/request_id=eq\.([^&]+)/)[1],e=events.get(id);data=e?[{row_key:e.state.row_key,actor:e.state.updated_by,input:e.state.data,result:e.state}]:[];}
  else if(path.includes('/rpc/icetak_customer_focus_orders'))data=structuredClone(snapshot);
  else if(path.includes('/rpc/icetak_customer_focus_drafts'))data={rows:[],total:0};
  else if(path.includes('/rpc/icetak_customer_focus_identities'))data=identities;
  else if(path.includes('/rpc/icetak_order_detail_sources'))data={tasks:{},links:{}};
  else if(path.includes('/rpc/icetak_customer_focus_save')){
   if(body.p_key===failSave)return Response.json({message:'fixture save unavailable'},{status:503});
   const old=events.get(body.p_request),input=JSON.stringify(body);
   if(old){if(old.input!==input)return Response.json({message:'REQUEST_CONFLICT'},{status:409});data=old.state;}
   else{
    if((snapshot.states[body.p_key]?.version||0)!==body.p_version)return Response.json({message:'FOCUS_CHANGED'},{status:409});
    data={row_key:body.p_key,version:body.p_version+1,data:body.p_data,updated_by:body.p_actor,updated_at:new Date().toISOString()};snapshot.states[body.p_key]=structuredClone(data);events.set(body.p_request,{input,state:data});
   }
  }else throw Error('Unexpected route '+path);
  return Response.json(data);
 };
 await import(pathToFileURL(join(dir,'index.mjs')).href);

 assert.equal((await request({action:'order_details',keys:['shopee:'+order.id]},false)).status,401);
 let res=await request({action:'order_details',keys:['shopee:'+order.id]});assert.equal(res.status,200);assert.equal(res.body.rows.length,1);let row=res.body.rows[0];assert.equal(row.kind,'shopee');assert.equal(row.detail_collection.status,'complete');assert.equal(row.detail_collection.items[0].values.name,'Aina');assert.equal(res.body.capabilities.shopee_send,false);
 function detailPayload(row){return {action:'order_detail_save',row_key:row.key,expected_version:row.state.version,source_fingerprint:row.source_fingerprint,request_id:crypto.randomUUID(),detail_check:{signature:row.detail_collection.signature,items:{line0:{rule:'name_age',values:{name:'Aina',age:'7'},same_design:false}},bindings:[],deadline:null}};}
 const save=detailPayload(row);res=await request(save);assert.equal(res.status,200);assert.equal(res.body.state.updated_by,'trusted-admin');assert.equal(events.size,1);
 res=await request(save);assert.equal(res.status,200);assert.equal(res.body.duplicate,true);assert.equal(events.size,1,'retry after lost response must preserve one event');
 res=await request({...save,detail_check:{...save.detail_check,deadline:'2026-10-05T03:00:00Z'}});assert.equal(res.status,409);assert.match(res.body.error,/REQUEST_CONFLICT/);
 res=await request({...save,request_id:crypto.randomUUID()});assert.equal(res.status,409);assert.match(res.body.error,/FOCUS_CHANGED/);
 res=await request({action:'order_details',keys:['shopee:'+order.id]});row=res.body.rows[0];const follow=detailPayload(row);follow.detail_check.mark_followup=true;
 res=await request(follow);assert.equal(res.status,200);assert.equal(res.body.state.data.detail_check.followup.source,'manual_external');assert.match(res.body.state.data.detail_check.followup.revision,/r1/);
 res=await request({action:'order_details',keys:['shopee:'+order.id]});row=res.body.rows[0];
 const forged=detailPayload(row);forged.detail_check.bindings=[{conversation_id:ids[2],start_at:now}];res=await request(forged);assert.equal(res.status,400);assert.match(res.body.error,/padanan identiti/);
 const stale=detailPayload(row);stale.source_fingerprint='old';res=await request(stale);assert.equal(res.status,409);assert.match(res.body.error,/SOURCE_CHANGED/);
 role='reader';res=await request({action:'order_details',keys:['shopee:'+order.id]});assert.equal(res.status,200);assert.equal(res.body.capabilities.can_manage,false);res=await request(detailPayload(row));assert.equal(res.status,403);role='owner';
 chat.inbound_revision='r2';chat.messages=[{...chat.messages[0],text_content:'Aina\n8 tahun',created_at:new Date(Date.now()+1000).toISOString()}];res=await request({action:'order_details',keys:['shopee:'+order.id]});row=res.body.rows[0];assert.equal(row.detail_collection.status,'review');
 const correction=detailPayload(row);correction.detail_check.items.line0.values.age='8';res=await request(correction);assert.equal(res.status,200);assert.equal(res.body.detail_collection.status,'complete');
 order.production_tasks[0].progress_stage=5;res=await request({action:'order_details',keys:['shopee:'+order.id]});row=res.body.rows[0];assert.equal(row.detail_collection.locked,true);const locked=detailPayload(row);locked.detail_check.items.line0.values={name:'Aina'};res=await request(locked);assert.equal(res.status,400);assert.match(res.body.error,/production/i);
 assert.equal(requests.some(r=>/send|outbox|order_update|payment_update/.test(r.path)),false);
 console.log('PASS: real detail gateway isolates requested orders; session extraction/save/reload, trusted actor, exact retry/conflicting retry/version/source guards, manual followup revision, identity/reader guards, new correction review and production deletion guard; no business sends/mutations.');
}finally{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;await rm(dir,{recursive:true,force:true});}
