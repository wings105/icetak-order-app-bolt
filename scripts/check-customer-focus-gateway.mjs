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
const order={id:ids[0],kind:'shopee',reference:'QA-ORDER',master_id:master,status:'READY_TO_SHIP',payment_status:'paid',created_at:now,production_tasks:[{id:'qa-task',progress_stage:2,rule_matched:true,source_updated_at:now}]};
const chat={id:ids[1],channel:'shopee',name:'qa.username',inbound_revision:'r1',last_inbound_at:now,messages:[{direction:'inbound',message_type:'text',text_content:'Nama untuk QA-ORDER ialah Aina',created_at:now}]};
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
  else if(path.includes('/ai-dashboard-bridge'))data={rows:chats,total:chats.length};
  else if(path.includes('/rpc/icetak_customer_focus_snapshot'))data=structuredClone(snapshot);
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
 assert.equal((await request({action:'focus_bulk_save',updates:[]},false)).status,401);
 role='reader';assert.equal((await request({action:'focus_bulk_save',updates:[{}]})).status,403);assert.equal(events.size,0);role='owner';
 const initial=current()[0],saved=payload(initial);assert.equal((await request({action:'focus_bulk_save',updates:[]})).status,400);
 assert.equal((await request({action:'focus_bulk_save',updates:Array(51).fill(saved)})).status,400);
 assert.equal((await request({action:'focus_bulk_save',updates:[saved,saved]})).status,400);
 const bound={key:'chat:'+chat.id,state:{version:0,data:{}},source_fingerprint:'r1'};const reply=payload(bound);
 let res=await request({action:'focus_bulk_save',updates:[reply]});assert.equal(res.status,200);assert.equal(res.body.results[0].ok,true);
 assert.equal(events.size,1);assert.equal(snapshot.states[bound.key].updated_by,'trusted-admin');assert.equal(snapshot.states[bound.key].data.actor,undefined);assert.equal(snapshot.states[bound.key].data.payment_status,undefined);
 assert.equal(current().find(r=>r.kind==='shopee').category,'design');assert.equal(current().find(r=>r.kind==='shopee').chat.reply,false);assert.equal(current().find(r=>r.kind==='chat').manual_work,'handled');
 res=await request({action:'focus_bulk_save',updates:[reply]});assert.equal(res.body.results[0].ok,true);assert.equal(events.size,1,'lost-response retry must not double-write');
 const reopen=payload(current().find(r=>r.kind==='chat'),'reply');res=await request({action:'focus_bulk_save',updates:[reopen]});assert.equal(res.body.results[0].ok,true);assert.equal(current().find(r=>r.kind==='shopee').chat.reply,true);
 failSave=bound.key;const valid=payload(current().find(r=>r.kind==='shopee'),'design_done'),fail=payload({key:bound.key,state:snapshot.states[bound.key],source_fingerprint:'r1'});
 res=await request({action:'focus_bulk_save',updates:[valid,fail]});assert.deepEqual(res.body.results.map(r=>r.ok),[true,false]);assert.equal(current().find(r=>r.kind==='shopee').category,'production');
 failSave='';res=await request({action:'focus_bulk_save',updates:[fail]});assert.equal(res.body.results[0].ok,true);
 const stale={...payload(current().find(r=>r.kind==='shopee')),source_fingerprint:'old-source'};res=await request({action:'focus_bulk_save',updates:[stale]});assert.match(res.body.results[0].error,/SOURCE_CHANGED/);
 const conflict={...payload(current().find(r=>r.kind==='shopee')),expected_version:0};res=await request({action:'focus_bulk_save',updates:[conflict]});assert.match(res.body.results[0].error,/FOCUS_CHANGED/);
 const forged={...payload(current().find(r=>r.kind==='shopee')),row_key:'chat:'+ids[2]};res=await request({action:'focus_bulk_save',updates:[forged]});assert.match(res.body.results[0].error,/SOURCE_CHANGED/);
 assert(requests.filter(r=>r.body?.p_actor).every(r=>r.body.p_actor==='trusted-admin'));
 assert.equal(requests.some(r=>/send|outbox|order_update|payment_update/.test(r.path)),false);
 console.log('PASS: actual bulk gateway, auth/reader/bounds/dedup, exact bound chat, trusted actor/whitelist, exact retry, partial failure/retry, source/version guards, design still independent; no business sends/mutations.');
}finally{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;await rm(dir,{recursive:true,force:true});}
