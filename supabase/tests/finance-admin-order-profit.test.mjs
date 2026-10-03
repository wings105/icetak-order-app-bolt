import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../functions/finance-admin/index.ts',import.meta.url),'utf8').replace(/^import .*\n/,'');
let handler,role='owner',username='admin1',permissions=['view_finance','manage_finance'],authenticated=true;const calls=[];
vm.runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}),{Response,Request,JSON,Number,String,Math,Array,Error,Date,Intl,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://qa.invalid':'QA-NOT-A-REAL-KEY'},serve:fn=>{handler=fn}},fetch:async(url,options={})=>{
  if(url.endsWith('/auth/v1/user'))return Response.json(authenticated?{id:'qa-user'}:{},{status:authenticated?200:401});
  if(url.includes('/admin_users?'))return Response.json([{username,role}]);if(url.includes('/admin_permissions?'))return Response.json([{permissions}]);calls.push({url,body:JSON.parse(options.body||'{}')});return Response.json({ok:true});
}});
const send=async(body,token='qa-token')=>handler(new Request('https://qa.invalid/finance-admin',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)}));
assert.equal((await send({action:'order_profit_list'},'')).status,403);authenticated=false;assert.equal((await send({action:'material_cost_settings'})).status,403);authenticated=true;
role='staff';assert.equal((await send({action:'order_profit_list'})).status,403);role='owner';username='other-owner';assert.equal((await send({action:'order_profit_detail'})).status,403);username='admin1';
permissions=['view_finance'];assert.equal((await send({action:'material_cost_settings'})).status,200);assert.equal((await send({action:'material_cost_settings_save'})).status,403);permissions=['view_finance','manage_finance'];
assert.equal((await send({action:'order_profit_detail',order_id:'bad'})).status,400);assert.equal((await send({action:'order_profit_summaries',order_ids:Array(101).fill('00000000-0000-4000-8000-000000000001')})).status,400);
assert.equal((await send({action:'order_costs_save',order_id:'00000000-0000-4000-8000-000000000001',version:2,lines:[],extras:{},actor:'spoofed',reviewed:true,work_minutes:0})).status,200);assert.equal(calls.at(-1).body.p_actor,'admin1');assert.equal(calls.at(-1).body.p_work_minutes,0);
assert.equal((await send({action:'order_profit_list',query:'CN0546',category:'topper',state:'loss'})).status,200);assert.equal(calls.at(-1).body.p_filter.query,'CN0546');assert.equal(calls.at(-1).body.p_filter.currency,'MYR');
console.log('Finance gateway auth, owner/staff permissions, bounded input, actor and filters passed.');
