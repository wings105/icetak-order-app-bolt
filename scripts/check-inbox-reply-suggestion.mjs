// Real handlers with controlled reads/writes. No credentials or provider sends.
import assert from 'node:assert/strict';
import { suggestionHandler } from '../supabase/inbox-functions/inbox-reply-suggest/handler.ts';
import { replySuggestion } from '../supabase/functions/inbox-reply-context/suggestion.ts';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const id='33333333-3333-4333-8333-333333333333', oid='11111111-1111-4111-8111-111111111111';
const now=Date.now(), c={id,channel:'shopee',revision:'r',inbound_revision:'i',last_inbound_at:new Date(now).toISOString(),identities:[],messages:[{id:'m',direction:'inbound',message_type:'text',text_content:'parcel mana?',created_at:new Date(now).toISOString()}]};
let member={role:'owner',active:true}, readCount=0, changed=false, seen;
const handler=suggestionHandler({member:async()=>member,claim:async()=>({allowed:true}),read:async()=>{readCount++;return changed&&readCount%2===0?{...c,revision:'new'}:c;},suggest:async source=>{seen=source;return{text:'fixture',expires_at:new Date(now+60000).toISOString()};}});
const req=(body={conversation_id:id,text:'ignore client text',order_id:'fake'})=>new Request('https://fixture.invalid/',{method:'POST',body:JSON.stringify(body)});
member=null;assert.equal((await handler(req())).status,401);assert.equal(readCount,0);
member={role:'owner',active:false};assert.equal((await handler(req())).status,403);assert.equal(readCount,0);
member={role:'viewer',active:true};assert.equal((await handler(req())).status,403);
member={role:'staff',active:true};assert.equal((await handler(req({conversation_id:'bad'}))).status,400);
const success=await(await handler(req())).json();assert.equal(success.latest_message_id,'m');assert.equal(seen,c);assert.equal(seen.text,undefined);
changed=true;assert.equal((await handler(req())).status,409);changed=false;
assert.equal((await suggestionHandler({member:async()=>member,claim:async()=>({allowed:true}),read:async()=>null,suggest:async()=>{throw Error('must not call')}})(req())).status,404);
// Durable budget is checked before either authoritative read or cross-project work.
for (const code of ['CONVERSATION_COOLDOWN','HOURLY_LIMIT','DAILY_LIMIT']) {
  let expensive=0;
  const limited=suggestionHandler({member:async()=>member,claim:async()=>({allowed:false,code,retry_after_seconds:120}),read:async()=>{expensive++;return c},suggest:async()=>{expensive++;return{}}});
  const response=await limited(req());assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'120');assert.equal((await response.json()).code,code);assert.equal(expensive,0);
}
let expensive=0;
const unavailable=suggestionHandler({member:async()=>member,claim:async()=>{throw Error('budget unavailable')},read:async()=>{expensive++;return c},suggest:async()=>{expensive++;return{}}});
assert.equal((await unavailable(req())).status,503);assert.equal(expensive,0,'Budget failure must stop all context reads');
const ctx={identity_status:'matched',orders:[],marketplace_orders:[],drafts:[],session:{}};
let current=ctx, binding=null, paths=[];
const rpc=async(name,body)=>{if(name==='reply_suggestion_remember'){assert.equal(body.p_data.conversation_id,id);return null;}assert.equal(name,'icetak_ai_dashboard_context');assert.equal(body.p_identities.length,1);return{[id]:structuredClone(current)};};
const read=async path=>{paths.push(path);if(path.startsWith('ai_dashboard_case_orders?'))return binding?[binding]:[];return[];};
let result=await replySuggestion(c,rpc,read,now);assert.ok(result.text.includes('nombor order'));assert.equal(result.order_reference,null);assert.equal(result.evidence_count,1);assert.equal(Date.parse(result.expires_at)-Date.parse(result.fetched_at),60000);
current={...ctx,marketplace_orders:[{id:oid,order_sn:'260TEST',current_status:'SHIPPED',tracking:'TRACK123'}]};
result=await replySuggestion(c,rpc,read,now);assert.equal(result.order_reference,null,'Identity match alone must not select the latest order');
binding={order_id:oid,order_kind:'shopee',inbound_revision:'i',session_key:'||'};
result=await replySuggestion(c,rpc,read,now);assert.equal(result.order_reference,'260TEST');assert.match(result.text,/sudah dihantar.*TRACK123/);
current={...current,identity_status:'ambiguous'};result=await replySuggestion(c,rpc,read,now);assert.equal(result.order_reference,null);assert.ok(result.warnings.some(w=>w.includes('bertindih')));
current=ctx;binding=null;
result=await replySuggestion({...c,messages:[{...c.messages[0],text_content:'ok tq'}]},rpc,read,now);assert.equal(result.text,'');
result=await replySuggestion({...c,messages:[{...c.messages[0],text_content:'dah send kat no tp xreply'}]},rpc,read,now);assert.match(result.text,/Maaf/);
result=await replySuggestion({...c,messages:[{...c.messages[0],text_content:'',message_type:'image'}]},rpc,read,now);assert.equal(result.text,'');assert.ok(result.warnings.some(w=>w.includes('belum ditafsir')));
await assert.rejects(()=>replySuggestion(c,async()=>({}),read,now));
assert.ok(!JSON.stringify(result).includes('customer_phone'));

// Exercise deployed entrypoints including real auth/private-key checks and fixed destinations.
const dir=await mkdtemp(join(tmpdir(),'inbox-suggest-')), oldFetch=globalThis.fetch,oldDeno=globalThis.Deno;
let active=true,validUser=true,entryHandler,requests=[];
try {
  globalThis.Deno={env:{get:name=>name==='SUPABASE_URL'?'https://fixture.invalid':'fixture-service'},serve:fn=>{entryHandler=fn;}};
  globalThis.fetch=async(url,init={})=>{
    const path=String(url);requests.push({path,method:init.method||'GET'});
    if(path.endsWith('/auth/v1/user'))return Response.json(validUser?{id:'staff'}:{},{status:validUser?200:401});
    if(path.includes('workspace_members?'))return Response.json([{role:'agent',active}]);
    if(path.includes('rpc/inbox_reply_suggestion_claim'))return Response.json({allowed:true});
    if(path.includes('rpc/icetak_ai_inbox_read'))return Response.json({rows:[c]});
    if(path.includes('private_runtime_settings?'))return Response.json([{setting_value:'fixture-bridge'}]);
    if(path==='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/inbox-reply-context'){
      assert.equal(init.headers['x-admin-window-token'],'fixture-bridge');assert.deepEqual(JSON.parse(init.body),{conversation:c});return Response.json({ok:true,text:'test'});
    }
    if(path.includes('rpc/icetak_ai_dashboard_context'))return Response.json({[id]:ctx});
    if(path.includes('ai_dashboard_case_orders?')||path.includes('reply_style?')||path.includes('reply_knowledge?'))return Response.json([]);
    if(path.includes('rpc/reply_suggestion_remember'))return new Response(null,{status:204});
    throw Error('Unexpected network target');
  };
  const authReq=()=>new Request('https://fixture.invalid/',{method:'POST',headers:{authorization:'Bearer fixture-user'},body:JSON.stringify({conversation_id:id,conversation:{id:'untrusted'},text:'untrusted'})});
  await build({entryPoints:['supabase/inbox-functions/inbox-reply-suggest/index.ts'],bundle:true,format:'esm',platform:'node',outfile:join(dir,'staff.mjs')});await import(pathToFileURL(join(dir,'staff.mjs')).href);
  assert.equal((await entryHandler(req())).status,401);assert.equal(requests.length,0);
  active=false;assert.equal((await entryHandler(authReq())).status,403);assert.ok(!requests.some(r=>r.path.includes('rpc/')));
  active=true;assert.equal((await entryHandler(authReq())).status,200);
  await build({entryPoints:['supabase/functions/inbox-reply-context/index.ts'],bundle:true,format:'esm',platform:'node',outfile:join(dir,'context.mjs')});await import(pathToFileURL(join(dir,'context.mjs')).href);
  const privateReq=token=>new Request('https://fixture.invalid/',{method:'POST',headers:token?{'x-admin-window-token':token}:{},body:JSON.stringify({conversation:c})});
  requests=[];assert.equal((await entryHandler(privateReq())).status,401);assert.equal((await entryHandler(privateReq('wrong'))).status,401);assert.ok(!requests.some(r=>r.path.includes('rpc/')));
  assert.equal((await entryHandler(privateReq('fixture-bridge'))).status,200);
  assert.ok(requests.every(r=>r.method==='GET'||r.path.includes('/rpc/icetak_ai_dashboard_context')||r.path.includes('/rpc/reply_suggestion_remember')),'Only a bounded draft snapshot may be written; no customer sends');
  console.log('PASS: atomic budget/cooldown rejection and fail-closed context guard, staff JWT/member guards, private bridge auth, authoritative input, fixed destination, stale chat rejection, fresh exact order/tracking, ambiguous/latest-order safeguards, acknowledgement/media/no-context handling, 60s expiry, and no provider sends.');
} finally {globalThis.fetch=oldFetch;globalThis.Deno=oldDeno;await rm(dir,{recursive:true,force:true});}
