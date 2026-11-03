import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=fs.readFileSync('supabase/functions/shipping-pickup-reconcile/index.ts','utf8').replace(/^import .*;\n/gm,'');
async function run({authorized=true,dryRun=false,busy=false,providerError=false,mismatch=false,method='POST'}={}) {
 let handler;const calls=[],requests=[];
 const db={from(){return {select(){return this},eq(){return this},async maybeSingle(){return {data:{setting_value:'qa-token'}}}}},async rpc(name,args){calls.push({name,args});return {data:name.endsWith('_claim')?!busy:name.endsWith('_candidates')?[{id:'qa-shipment',tracking_no:'MY01234567890B'}]:{status:'cancelled'}}}};
 vm.runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}),{Deno:{env:{get:k=>({SUPABASE_URL:'https://qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-service',PARCELDAILY_TOKEN:'qa-provider',PARCELDAILY_MERCHANT_ID:'qa-merchant',PARCELDAILY_BASE_URL:'https://api.parceldaily.com'})[k]},serve:h=>handler=h},createClient:()=>db,crypto,Request,Response,AbortSignal,fetch:async(url,init)=>{requests.push({url,init});if(providerError)return Response.json({error:'unauthorized'},{status:401});return Response.json({consign_no:mismatch?'WRONG':'MY01234567890B',status:'Pickup request has been cancelled',statusGroup:'Canceled'});}});
 const res=await handler(new Request('https://qa.invalid',{method,headers:{'content-type':'application/json',...(authorized?{'x-pickup-reconcile-token':'qa-token'}:{})},...(method==='POST'?{body:JSON.stringify({dry_run:dryRun})}:{})}));
 return {status:res.status,body:await res.json(),calls,requests};
}
let r=await run({authorized:false});assert.equal(r.status,401);assert.equal(r.calls.length+r.requests.length,0);
r=await run({method:'GET'});assert.equal(r.status,405);
r=await run({dryRun:true});assert.equal(r.body.checked,1);assert.deepEqual(r.calls.map(x=>x.name),['icetak_pending_pickup_poll_candidates']);
r=await run({busy:true});assert.equal(r.body.status,'busy');assert.equal(r.requests.length,0);
r=await run();assert.equal(r.body.status,'checked');assert.equal(r.requests[0].url,'https://api.parceldaily.com/v2/partner/track/');assert.equal(r.requests[0].init.headers.merchantid,'qa-merchant');assert.equal(JSON.parse(r.requests[0].init.body).connote,'MY01234567890B');assert.equal(r.calls.find(x=>x.name==='icetak_apply_pending_pickup_check').args.p_observation.statusGroup,'Canceled');assert.equal(r.calls.at(-1).name,'icetak_pending_pickup_poll_release');
r=await run({providerError:true});assert.equal(r.calls.find(x=>x.name==='icetak_apply_pending_pickup_check').args.p_observation.error,'PROVIDER_HTTP_401');
r=await run({mismatch:true});assert.equal(r.calls.find(x=>x.name==='icetak_apply_pending_pickup_check').args.p_observation.error,'PROVIDER_IDENTITY_MISMATCH');
console.log('PASS: actual worker auth, read-only provider/preview, identity/error isolation, canonical status evidence and single-worker lease; no messaging endpoint');
