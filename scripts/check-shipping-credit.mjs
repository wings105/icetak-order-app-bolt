import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=fs.readFileSync('supabase/functions/shipping-credit/index.ts','utf8').replace(/^import .*createClient.*;\n/,'');
async function run({enabled='true',sendError=false,authorized=true,permission=true,action='sync',method='POST'}={}){
 let handler;const sent=[],outcomes=[];
 const settings={enabled,admin_order_notify_phone:'60123456789'};
 const client={auth:{getUser:async()=>authorized?{data:{user:{id:'qa-user'}}}:{error:'denied',data:{user:null}}},from(table){let field;return{select(){return this},eq(k,v){if(k==='key'||k==='setting_key')field=v;return this},async maybeSingle(){return{data:table==='private_runtime_settings'?{setting_value:'qa-token'}:table==='whatsapp_settings'?{text_value:settings[field]}:{status:'APPROVED'}}}}},async rpc(name,args){
 if(name==='icetak_admin_can_manage_shipping_messages')return {data:permission};
 if(name==='icetak_credit_claim')return {data:true};
 if(name==='icetak_credit_snapshot')return {data:{success:true}};
 if(name==='icetak_credit_claim_alert')return {data:{episode:'qa-episode',balance:12.5}};
 if(name==='icetak_credit_alert_result')outcomes.push(args);
 return {data:{account:{balance:12.5},entries:[]}};
 }};
 vm.runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}),{Deno:{env:{get:k=>({SUPABASE_URL:'https://qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-service',SUPABASE_ANON_KEY:'qa-public',PARCELDAILY_BASE_URL:'https://api.parceldaily.com',PARCELDAILY_TOKEN:'qa-provider',PARCELDAILY_MERCHANT_ID:'qa-merchant'})[k]},serve:h=>handler=h},createClient:()=>client,Request,Response,AbortSignal,Date,Intl,fetch:async(url,init)=>{if(url.includes('account-info'))return Response.json({data:{credit:'12.50'}});sent.push(JSON.parse(init.body));if(sendError)throw Error('network timeout');return Response.json({ok:true,message_id:'qa-message'});}});
 const response=await handler(new Request('https://qa.invalid',{method,headers:{'content-type':'application/json',...(authorized?{'x-credit-token':'qa-token'}:{authorization:'Bearer invalid'})},...(method==='OPTIONS'?{}:{body:JSON.stringify({action})})}));
 return {response,sent,outcomes};
}
let r=await run();assert.equal(r.response.status,200);assert.equal(r.sent.length,1);assert.equal(r.sent[0].phone,'60123456789');assert.equal(r.sent[0].mode,'auto');assert.equal(r.sent[0].template_name,'icetak_parceldaily_credit_low_ms');assert.equal(r.sent[0].vars.balance,'12.50');assert.equal(r.outcomes[0].p_status,'sent');
r=await run({enabled:'false'});assert.equal(r.sent.length,0);
r=await run({sendError:true});assert.equal(r.outcomes[0].p_status,'unknown');
r=await run({authorized:false});assert.equal(r.response.status,401);
r=await run({action:'classify'});assert.equal(r.response.status,403);
console.log('PASS: actual shipping-credit handler sync, recipient, auto/window/template routing, master pause, unknown-send guard, auth and classification guard');

r=await run({method:'OPTIONS',authorized:false});assert.equal(r.response.status,200);for(const h of ['authorization','apikey','content-type','x-client-info'])assert.ok(r.response.headers.get('access-control-allow-headers').split(',').includes(h));assert.ok(r.response.headers.get('access-control-allow-methods').split(',').includes('POST'));assert.equal(r.sent.length,0);console.log('PASS: browser SDK CORS preflight headers and POST method; zero sends');
