import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const source=(path)=>stripTypeScriptTypes(fs.readFileSync(new URL(path,import.meta.url),'utf8').replace(/^import .*;\n/gm,''));
let checks=0;
function finance(options={}){
 let handler;const calls=[];
 vm.runInNewContext(source('../supabase/functions/finance-admin/index.ts'),{
  Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://order.test':'service-test'},serve:fn=>{handler=fn;}},Response,Request,console,
  fetch:async(url,init={})=>{
   const p=new URL(url).pathname;
   if(p==='/auth/v1/user')return response({id:'owner-auth'});
   if(p==='/rest/v1/admin_users')return response([{username:options.username||'admin1',role:'owner'}]);
   if(p==='/rest/v1/admin_permissions')return response([{permissions:options.permissions||['view_finance','manage_finance']}]);
   if(p.startsWith('/rest/v1/rpc/')){calls.push({name:p.split('/').pop(),body:JSON.parse(init.body)});return response({rows:[],saved:true});}
   throw Error(`Unexpected gateway request ${p}`);
  },
 });
 return {calls,invoke:async(body,auth=true)=>{const r=await handler(new Request('https://order.test/finance-admin',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer owner-test'}:{})},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}};
}
{
 const f=finance();assert.equal((await f.invoke({action:'billing_snapshot'})).status,200);assert.equal(f.calls[0].name,'finance_billing_snapshot');checks++;
 assert.equal((await f.invoke({action:'billing_action',operation:'save_bill',payload:{title:'Fixture'},actor:'attacker'})).status,200);
 assert.equal(f.calls[1].body.p_actor,'admin1');assert.equal(f.calls[1].body.p_action,'save_bill');checks++;
}
for(const config of [{username:'other-owner'}, {permissions:[]}] ){
 const f=finance(config);assert.equal((await f.invoke({action:'billing_snapshot'})).status,403);assert.equal(f.calls.length,0);checks++;
}
{
 const f=finance({permissions:['view_finance']});assert.equal((await f.invoke({action:'billing_snapshot'})).status,200);assert.equal((await f.invoke({action:'billing_action',operation:'pay'})).status,403);checks++;
 const noAuth=finance();assert.equal((await noAuth.invoke({action:'billing_snapshot'},false)).status,403);assert.equal(noAuth.calls.length,0);checks++;
}
function sender(options={}){
 let handler;let providers=0;
 vm.runInNewContext(source('../supabase/functions/whatsapp-send/index.ts'),{
  Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://order.test':'service-test'},serve:fn=>{handler=fn;}},Response,Request,console,AbortController,setTimeout,clearTimeout,
  fetch:async(url)=>{
   const u=new URL(url),p=u.pathname.replace('/rest/v1/','');
   if(u.origin==='https://window.test')return response({ok:true,can_send_freeform:options.window!==false});
   if(p==='whatsapp_settings')return response([{text_value:{enabled:options.master===false?'false':'true',unified_inbox_24h_url:'https://window.test'}[u.searchParams.get('key')?.slice(3)]||''}]);
   if(p==='rpc/finance_billing_dispatch_allowed')return response(options.allowed!==false);
   if(p==='whatsapp_notification_rules')return response([{enabled:true,freeform_enabled:true,template_enabled:false}]);
   providers++;throw Error('Provider must not be called in dry run');
  },
 });
 return {invoke:async()=>{const r=await handler(new Request('https://order.test/send',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer service-test'},body:JSON.stringify({phone:'60123456789',event_type:'finance_bill_reminder',vars:{bill_id:'fixture'},text:'Billing fixture',dry_run:true,mode:'auto'})}));return {status:r.status,body:await r.json(),providers};}};
}
for(const [options,error] of [[{master:false},'billing_master_disabled'],[{allowed:false},'billing_closed_or_paused'],[{window:false},'billing_window_closed']]){
 const r=await sender(options).invoke();assert.equal(r.status,409);assert.equal(r.body.error,error);assert.equal(r.providers,0);checks++;
}
{
 const r=await sender().invoke();assert.equal(r.status,200);assert.equal(r.body.message_preview,'Billing fixture');assert.equal(r.body.mode,'text');assert.equal(r.providers,0);checks++;
}
console.log(`PASS: ${checks} actual-handler Finance auth, owner/read-only checks, trusted actor, billing window/master/closed guards and dry-run checks; no live services called.`);
