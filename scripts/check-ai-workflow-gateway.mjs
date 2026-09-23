// Controlled request/response smoke: production handler, mocked external reads, no live mutations.
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'icetak-gateway-'));
const sourceDir=new URL('../supabase/functions/admin-ai-dashboard/',import.meta.url);
let handler,role='owner',failRead=false,requests=[];
const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;
const orderId='11111111-1111-4111-8111-111111111111',conversationId='33333333-3333-4333-8333-333333333333';
const c={id:conversationId,channel:'whatsapp',inbound_revision:'r',revision:'r',messages:[{direction:'inbound',message_type:'text',text_content:'Semak perkembangan order',created_at:'2026-09-23T09:00:00Z'}]};
const ctx={identity_status:'matched',session:{},orders:[{id:orderId,order_no:'IC-TEST',status:'Ready to Process',payment_status:'paid'}],drafts:[]};
try{
 const input=(await readFile(new URL('index.ts',sourceDir),'utf8')).replace(/import "jsr:[^\n]+\n/,'').replaceAll("from './",`from '${sourceDir.href}`);
 const compiled=ts.transpileModule(input,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 await writeFile(join(dir,'index.mjs'),compiled);
 globalThis.Deno={env:{get:()=> 'fixture-only'},serve:fn=>{handler=fn;}};
 globalThis.fetch=async(url,options={})=>{
  const path=String(url);requests.push({path,method:options.method||'GET'});
  let data;
  if(path.includes('/auth/v1/user'))data={id:'fixture-admin'};
  else if(path.includes('admin_users?'))data=[{username:'test-admin',role}];
  else if(path.includes('admin_permissions?'))data=[{permissions:[]}];
  else if(path.includes('private_runtime_settings?'))data=[{setting_value:'test-only-bridge'}];
  else if(path.includes('/ai-dashboard-bridge'))data={rows:[c],capabilities:{},fetched_at:'2026-09-23T12:00:00Z'};
  else if(path.includes('/rpc/icetak_ai_dashboard_context'))data={[conversationId]:structuredClone(ctx)};
  else if(path.includes('ai_dashboard_case_orders?'))data=[{conversation_id:conversationId,order_id:orderId,order_kind:'icetak',inbound_revision:'r',session_key:'||'}];
  else if(path.includes('production_components?')){
   assert.ok(path.includes(`order_id=in.(${orderId})`));
   if(failRead)return Response.json({message:'fixture read unavailable'},{status:503});
   data=[{id:'component',order_id:orderId,review_required:true,review_status:'waiting_customer_review'}];
  }else if(path.includes('whatsapp_settings?'))data=[{value:false}];
  else if(path.includes('ai_dashboard_events?')||path.includes('ai_dashboard_training?'))data=[];
  else throw Error(`Unexpected request ${path}`);
  return Response.json(data);
 };
 await import(pathToFileURL(join(dir,'index.mjs')).href);
 const request=(action='list',auth=true)=>handler(new Request('https://fixture.invalid/admin-ai-dashboard',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer fixture-user'}:{})},body:JSON.stringify({action,conversation_id:conversationId})}));
 assert.equal((await request('list',false)).status,401);assert.equal(requests.length,0);
 role='staff';assert.equal((await request()).status,403);assert.ok(!requests.some(r=>r.path.includes('production_components')));
 role='owner';requests=[];
 for(const action of ['list','detail']){
  const response=await request(action);assert.equal(response.status,200);const body=await response.json();const row=body.row||body.rows[0];
  assert.equal(row.analysis.case.title,'Semak kelulusan pelanggan');assert.equal(row.analysis.workflow.decision,true);assert.equal(row.context.orders[0].production_reviews.length,1);assert.ok(row.context.workflow_checked_at);assert.equal(body.capabilities.whatsapp_api,false);
 }
 assert.ok(requests.every(r=>r.method==='GET'||r.path.includes('/rpc/icetak_ai_dashboard_context')||r.path.includes('/ai-dashboard-bridge')),'Read actions must not issue mutation RPCs');
 failRead=true;const failed=await request();assert.equal(failed.status,500);assert.equal((await failed.json()).ok,false,'Missing source must not masquerade as successful fresh data');
 console.log('PASS: actual gateway list/detail responses include current review action; auth, permission and read-failure guards preserved; no mutation calls.');
}finally{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;await rm(dir,{recursive:true,force:true});}
