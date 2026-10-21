import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const compile=path=>stripTypeScriptTypes(readFileSync(path,'utf8').replace(/^import .*;\n/gm,''));
let handler,ready=false,recentFailure=false,providerCalls=0,validUser=true,userChecks=0;
const privateToken='fixture-private-token';
const fetcher=async(url,options={})=>{
 const path=new URL(url).pathname;
 if(path.endsWith('/private_runtime_settings'))return Response.json([{setting_value:privateToken}]);
 if(path.endsWith('/message_media')){const isReady=new URL(url).searchParams.get('download_status');return Response.json(isReady?(ready?[{storage_path:'test/original.png',mime_type:'image/png'}]:[]):[{download_status:recentFailure?'failed':'queued',updated_at:new Date().toISOString()}]);}
 if(path.endsWith('/wasapflow-media')){providerCalls++;assert.equal(options.headers['x-admin-window-token'],privateToken);assert.equal(new URL(url).searchParams.get('id'),'123');ready=true;return new Response(new Uint8Array([0x89,0x50,0x4e,0x47]),{headers:{'content-type':'image/png'}});}
 if(path.includes('/storage/v1/object/sign/'))return Response.json({signedURL:'/object/sign/whatsapp-media/test?token=fixture'});
 throw Error('Unexpected '+path);
};
await new Function('Deno','fetch',`return (async()=>{${compile('supabase/inbox-functions/task-brief-media/index.ts')}})()` )({env:{get:k=>k==='SUPABASE_URL'?'https://qa.supabase.co':'fixture-service-key'},serve:fn=>handler=fn},fetcher);
const call=(body,token=privateToken)=>handler(new Request('https://qa.example',{method:'POST',headers:{'content-type':'application/json','x-admin-window-token':token},body:JSON.stringify(body)}));
assert.equal((await call({ids:['123']},'wrong')).status,401);assert.equal((await call({action:'prepare',ids:['123','124','125','126','127']})).status,400);assert.equal((await call({action:'prepare',ids:['../other']})).status,400);
let response=await (await call({ids:['123']})).json();assert.equal(response.media['wasapflow-media://123'].available,false);assert.equal(providerCalls,0,'normal signer/list reads never fetch provider');
response=await (await call({action:'prepare',ids:['123']})).json();assert.equal(response.media['wasapflow-media://123'].available,true);assert.equal(providerCalls,1);await call({action:'prepare',ids:['123']});assert.equal(providerCalls,1,'cached original is reused');
ready=false;recentFailure=true;await call({action:'prepare',ids:['123']});assert.equal(providerCalls,1,'failed downloads have five-minute cooldown');
const admin={from(table){return {select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},maybeSingle:async()=>({data:table==='private_runtime_settings'?{setting_value:privateToken}:{storage_path:'test/original.png',mime_type:'image/png',download_status:'ready'}})};},storage:{from(){return {download:async()=>({data:new Blob([new Uint8Array([0x89,0x50,0x4e,0x47])],{type:'image/png'})})};}}};
const createClient=(_url,_key,options)=>options?.global?{auth:{getUser:async()=>{userChecks++;return {data:{user:validUser?{id:'fixture-staff'}:null},error:validUser?null:{message:'invalid'}};}}}:admin;
await new Function('Deno','createClient','fetch',`return (async()=>{${compile('supabase/inbox-functions/wasapflow-media/index.ts')}})()` )({env:{get:()=> 'fixture-key'},serve:fn=>handler=fn},createClient,()=>{throw Error('cached test must not call provider');});
const get=(headers={},id='123')=>handler(new Request('https://qa.example/?id='+encodeURIComponent(id),{headers}));
assert.equal((await get()).status,401);assert.equal((await get({'x-admin-window-token':'wrong'})).status,401);assert.equal((await get({'x-admin-window-token':privateToken},'../unsafe')).status,400);
assert.equal((await get({'x-admin-window-token':privateToken})).status,200);assert.equal(userChecks,0,'server bridge does not reuse a staff JWT from another project');
assert.equal((await get({authorization:'Bearer valid-fixture'})).status,200);assert.equal(userChecks,1);validUser=false;assert.equal((await get({authorization:'Bearer invalid-fixture'})).status,401);
console.log('PASS bounded on-demand original recovery: private bridge and original JWT auth, unknown/invalid input denial, max four IDs, no provider calls during normal signing/list reads, cache reuse and failed-download cooldown.');
