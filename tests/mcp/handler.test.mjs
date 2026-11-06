import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'})[k]}};
const {handle}=await import('../../supabase/functions/icetak-mcp/index.ts');
const p=await import('../../supabase/functions/icetak-mcp/protocol.ts');
const owner='00000000-0000-4000-8000-000000000001';
let active=true,valid=true,scope=p.SCOPES.join(' '),comments=[],writes=[],delivered=true,claim=true;
const j=x=>Response.json(x);
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input)),path=u.pathname,body=init.body?JSON.parse(init.body):null;
 if(u.hostname==='api.clickup.com'){
  if(path.endsWith('/comment')){if(init.method==='POST'){writes.push(body);const c={id:'receipt1',comment_text:body.comment_text};comments.push(c);return j(c);}return j({comments});}
  return j({id:'task1',list:{id:'18375902'},archived:false});
 }
 if(path.endsWith('/admin_users'))return j(active?[{id:owner}]:[]);
 if(path.endsWith('/icetak_mcp_tokens'))return j(valid?[{owner_id:owner,client_id:'client',scope}]:[]);
 if(path.endsWith('/private_runtime_settings'))return j([{setting_value:'fixture-token'}]);
 if(path.endsWith('/icetak_mcp_clients'))return j([{redirect_uris:['https://chatgpt.com/connector/oauth/qa']}]);
 if(path.endsWith('/icetak_mcp_events'))return j([{id:'event1',task_id:'task1',order_reference:'ORDER1'}]);
 if(path.endsWith('/icetak_mcp_subscriptions'))return j([{id:'sub1',order_reference:'ORDER1',active:true}]);
 if(path.endsWith('/icetak_mcp_deliveries'))return j(delivered?[{event_id:'event1'}]:[]);
 if(path.endsWith('/icetak_mcp_comments'))return j(init.method==='POST'?(claim?[body]:[]):init.method==='PATCH'?[body]:[]);
 if(path.endsWith('/clickup_order_brief_jobs'))return j([{task_id:'task1',brief:{wording:'QA',proof:[{at:'2026-11-06T00:00:00Z'}]}}]);
 throw Error('Unexpected fetch '+path);
};
const rpc=async(method,params={},auth='fixture')=>{const r=await handle(new Request(p.ORIGIN+'/mcp',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}));return {status:r.status,value:await r.json(),headers:r.headers};};
test('anonymous/invalid/revoked owner denied with OAuth discovery',async()=>{let r=await rpc('tools/list',{},'');assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate'),/oauth-protected-resource/);valid=false;assert.equal((await rpc('tools/list')).status,401);valid=true;active=false;assert.equal((await rpc('tools/list')).status,401);active=true;});
test('initialize and list expose three tools plus confirmed event',async()=>{assert.deepEqual((await rpc('initialize',{protocolVersion:'2025-03-26'})).value.result.capabilities,{tools:{},events:{}});assert.equal((await rpc('tools/list')).value.result.tools.length,3);assert.equal((await rpc('events/list')).value.result.events[0].name,p.EVENT);});
test('exact brief retains evidence and scope is enforced',async()=>{let r=await rpc('tools/call',{name:'get_order_brief',arguments:{order_reference:'ORDER1'}});assert.equal(JSON.parse(r.value.result.content[0].text).tasks[0].brief.wording,'QA');scope='events:subscribe';r=await rpc('tools/call',{name:'get_order_brief',arguments:{order_reference:'ORDER1'}});assert.equal(r.value.result.isError,true);scope=p.SCOPES.join(' ');assert.equal((await rpc('tools/call',{name:'get_order_brief',arguments:{order_reference:'ORDER1',sql:'unexpected'}})).value.result.isError,true);});
test('callback URL/DNS restrictions reject private, deceptive and insecure targets',async()=>{for(const u of ['https://chatgpt.com.evil.test/a','http://chatgpt.com/a','https://user@chatgpt.com/a','https://chatgpt.com:444/a','https://127.0.0.1/a']){assert.equal(p.redirectAllowed(u),false);assert.equal(p.callbackAllowed(u),false);}for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.2','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(p.publicAddress(ip),false);assert.throws(()=>p.exactReference('*'));const r=await rpc('events/subscribe',{name:p.EVENT,arguments:{order_reference:'ORDER1'},delivery:{mode:'webhook',url:'http://127.0.0.1/',secret:'secret'}});assert.equal(r.value.error.message,'INVALID_CALLBACK');});
test('webhook signature matches independent HMAC',async()=>{const secret='whsec_'+Buffer.alloc(32,7).toString('base64'),body='{"hello":1}',h=await p.signedHeaders(secret,'event1',body,'sub1',1700000000000);assert.equal(h['webhook-signature'],'v1,'+createHmac('sha256',Buffer.alloc(32,7)).update('event1.1700000000.'+body).digest('base64'));await assert.rejects(()=>p.signedHeaders('whsec_eA==','id',body,'sub'));});
test('OAuth consent validates resource and escapes input',async()=>{const q=new URLSearchParams({client_id:'client',redirect_uri:'https://chatgpt.com/connector/oauth/qa',response_type:'code',code_challenge:'a'.repeat(43),code_challenge_method:'S256',state:'"><script>bad</script>'});let r=await handle(new Request(p.ORIGIN+'/authorize?'+q));assert.equal(r.status,200);const html=await r.text();assert.ok(!html.includes('<script>'));assert.match(html,/type="password"/);q.set('resource','https://other.test');r=await handle(new Request(p.ORIGIN+'/authorize?'+q));assert.equal(r.status,400);});
test('comment requires delivery, reconciles retry and avoids concurrent duplicate',async()=>{const args={event_id:'event1',task_id:'task1',comment:'QA review with proof'};delivered=false;assert.equal((await rpc('tools/call',{name:'post_review_comment',arguments:args})).value.result.isError,true);assert.equal(writes.length,0);delivered=true;let r=await rpc('tools/call',{name:'post_review_comment',arguments:args});assert.equal(JSON.parse(r.value.result.content[0].text).comment_id,'receipt1');r=await rpc('tools/call',{name:'post_review_comment',arguments:args});assert.equal(JSON.parse(r.value.result.content[0].text).reconciled,true);assert.equal(writes.length,1);comments=[];claim=false;r=await rpc('tools/call',{name:'post_review_comment',arguments:args});assert.equal(JSON.parse(r.value.result.content[0].text).state,'sending');assert.equal(writes.length,1);claim=true;});
test('gateway prefixes route and malformed RPC fails',async()=>{for(const prefix of ['/icetak-mcp','/functions/v1/icetak-mcp'])assert.equal((await handle(new Request('https://database.test'+prefix+'/health'))).status,200);const r=await handle(new Request(p.ORIGIN+'/mcp',{method:'POST',headers:{authorization:'Bearer fixture'},body:'{'}));assert.equal((await r.json()).error.code,-32700);assert.equal((await rpc('missing')).value.error.code,-32601);});
test('subscription challenge, signed dispatch and unsubscribe execute actual handler',async()=>{
 const https=await import('node:https'),events=await import('node:events'),{syncBuiltinESMExports}=await import('node:module');
 const originalHttps=https.default.request,originalFetch=globalThis.fetch,secret='whsec_'+Buffer.alloc(32,8).toString('base64');let saved,queued=[],payloads=[],stopped=false;
 https.default.request=(url,options,cb)=>{const req=new events.EventEmitter();req.destroy=e=>req.emit('error',e);req.end=body=>{const payload=JSON.parse(body),expected=createHmac('sha256',Buffer.alloc(32,8)).update(options.headers['webhook-id']+'.'+options.headers['webhook-timestamp']+'.'+body).digest('base64');assert.equal(options.headers['webhook-signature'],'v1,'+expected);const res=new events.EventEmitter();res.statusCode=200;res.setEncoding=()=>{};cb(res);queueMicrotask(()=>{if(payload.type==='verification')res.emit('data',JSON.stringify({challenge:payload.challenge}));else{payloads.push(payload);res.emit('data','{}');}res.emit('end');});};return req;};syncBuiltinESMExports();
 globalThis.fetch=async(input,init={})=>{const path=new URL(String(input)).pathname,body=init.body?JSON.parse(init.body):null;if(path.endsWith('/rpc/icetak_mcp_subscribe')){saved=body.p_subscription;return j({id:saved.id,refreshBefore:saved.expires_at,cursor:'0',truncated:false});}if(path.endsWith('/rpc/icetak_mcp_claim_deliveries'))return j(queued);if(path.endsWith('/rpc/icetak_mcp_delivery_cursor'))return j('9');if(path.endsWith('/icetak_mcp_deliveries')&&init.method==='PATCH'){assert.equal(body.state,'delivered');return j([body]);}if(path.endsWith('/icetak_mcp_subscriptions')&&init.method==='PATCH'){stopped=!body.active;return j([body]);}return originalFetch(input,init);};
 try{const params={name:p.EVENT,arguments:{order_reference:'ORDER1'},delivery:{mode:'webhook',url:'https://chatgpt.com/mcp-events/qa',secret}};let r=await rpc('events/subscribe',params);assert.ok(r.value.result.id.startsWith('sub_'));assert.equal(saved.owner_id,owner);queued=[{subscription:saved,event:{id:'event1',seq:9,name:p.EVENT,task_id:'task1',order_reference:'ORDER1',brief_revision:'rev1',confirmed_at:'2026-11-06T00:00:00Z'},delivery:{attempts:1}}];r=await handle(new Request(p.ORIGIN+'/dispatch',{method:'POST',headers:{'x-mcp-dispatch':'fixture-token'},body:'{}'}));assert.equal((await r.json()).results[0].state,'delivered');assert.equal(payloads[0].cursor,'9');await rpc('events/unsubscribe',{...params,delivery:{url:params.delivery.url}});assert.equal(stopped,true);}finally{https.default.request=originalHttps;syncBuiltinESMExports();globalThis.fetch=originalFetch;}
});
test('revoking an active OAuth grant deactivates that owner/client subscriptions',async()=>{
 const original=globalThis.fetch;let stopped=false;
 globalThis.fetch=async(input,init={})=>{const u=new URL(String(input));if(u.pathname.endsWith('/icetak_mcp_tokens')&&init.method==='PATCH'){assert.equal(u.searchParams.get('revoked_at'),'is.null');return j([{owner_id:owner}]);}if(u.pathname.endsWith('/icetak_mcp_subscriptions')&&init.method==='PATCH'){assert.equal(u.searchParams.get('owner_id'),'eq.'+owner);assert.equal(u.searchParams.get('client_id'),'eq.client');stopped=JSON.parse(init.body).active===false;return j([]);}return original(input,init);};
 try{const r=await handle(new Request(p.ORIGIN+'/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'client_id=client&token=fixture'}));assert.equal(r.status,200);assert.equal(stopped,true);}finally{globalThis.fetch=original;}
});
test('consent POST accepts null/missing Origin only with a signed matching browser cookie',async()=>{
 const params=new URLSearchParams({client_id:'client',redirect_uri:'https://chatgpt.com/connector/oauth/qa',response_type:'code',code_challenge:'a'.repeat(43),code_challenge_method:'S256',state:'origin-test'});
 const page=await handle(new Request(p.ORIGIN+'/authorize?'+params)),html=await page.text(),token=html.match(/name="_csrf" value="([^"]+)"/)[1],cookie=page.headers.get('set-cookie').split(';')[0];params.set('_csrf',token);
 const original=globalThis.fetch;let authCalls=0;
 globalThis.fetch=async(input,init)=>{if(String(input).includes('/auth/v1/token')){authCalls++;return Response.json({error:'invalid_grant'},{status:400});}return original(input,init);};
 try{
  for(const origin of ['null',null,p.ORIGIN]){const r=await handle(new Request(p.ORIGIN+'/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',cookie,...(origin?{origin}:{})},body:params.toString()}));assert.equal((await r.json()).error,'OWNER_LOGIN_FAILED');}
  assert.equal(authCalls,3);
  let r=await handle(new Request(p.ORIGIN+'/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',origin:'null'},body:params.toString()}));const failure=await r.json();assert.equal(failure.error,'consent_expired');assert.equal(failure.reason,'cookie_missing');assert.equal(failure.revision,'popup-cookie-1');assert.ok(!JSON.stringify(failure).includes(token));
  r=await handle(new Request(p.ORIGIN+'/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',cookie,origin:'https://attacker.example'},body:params.toString()}));assert.equal((await r.json()).error,'invalid_origin');assert.equal(authCalls,3);
 }finally{globalThis.fetch=original;}
});

async function consentFixture(){
 const params=new URLSearchParams({client_id:'client',redirect_uri:'https://chatgpt.com/connector/oauth/qa',response_type:'code',code_challenge:'a'.repeat(43),code_challenge_method:'S256',state:'success-state',scope:p.SCOPES.join(' '),resource:p.ORIGIN+'/mcp'});
 const page=await handle(new Request(p.ORIGIN+'/authorize?'+params)),html=await page.text();
 params.set('_csrf',html.match(/name="_csrf" value="([^"]+)"/)[1]);params.set('email','fixture@example.invalid');params.set('password','fixture-private-password');
 return {params,cookie:page.headers.get('set-cookie').split(';')[0]};
}
const consentPost=f=>handle(new Request(p.ORIGIN+'/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',origin:'null',cookie:f.cookie},body:f.params.toString()}));

test('successful consent retries a cancelled code save once with the same hash, then redirects with original state',async()=>{
 const f=await consentFixture(),original=globalThis.fetch;let attempts=[],cleanups=0;
 globalThis.fetch=async(input,init={})=>{
  const u=new URL(String(input));
  if(u.pathname==='/auth/v1/token')return j({user:{id:owner},access_token:'fixture-private-session'});
  if(u.pathname==='/auth/v1/logout'){cleanups++;return new Response(null,{status:204});}
  if(u.pathname.endsWith('/icetak_mcp_codes')){
   assert.equal(u.searchParams.get('on_conflict'),'code_hash');assert.match(init.headers.prefer,/resolution=ignore-duplicates,return=minimal/);
   attempts.push(JSON.parse(init.body));return attempts.length===1?Response.json({code:'57014',message:'canceling statement due to statement timeout'},{status:500}):new Response(null,{status:201});
  }
  return original(input,init);
 };
 try{
  const response=await consentPost(f);assert.equal(response.status,302);const dest=new URL(response.headers.get('location'));
  assert.equal(dest.origin,'https://chatgpt.com');assert.equal(dest.searchParams.get('state'),'success-state');assert.equal(dest.searchParams.get('iss'),p.ORIGIN);
  assert.equal(await p.sha(dest.searchParams.get('code')),attempts[0].code_hash);assert.deepEqual(attempts[0],attempts[1]);assert.equal(cleanups,1);
  assert.match(response.headers.get('set-cookie'),/Max-Age=0/);assert.equal(attempts[0].owner_id,owner);
 }finally{globalThis.fetch=original;}
});

test('lost code-save reply is retried idempotently without a second code or grant',async()=>{
 const f=await consentFixture(),original=globalThis.fetch,rows=new Map();let calls=0;
 globalThis.fetch=async(input,init={})=>{
  const u=new URL(String(input));if(u.pathname==='/auth/v1/token')return j({user:{id:owner},access_token:'fixture-private-session'});
  if(u.pathname==='/auth/v1/logout')return new Response(null,{status:204});
  if(u.pathname.endsWith('/icetak_mcp_codes')){calls++;const row=JSON.parse(init.body);if(!rows.has(row.code_hash))rows.set(row.code_hash,row);if(calls===1)throw new DOMException('secret provider detail','TimeoutError');return new Response(null,{status:201});}
  return original(input,init);
 };
 try{const r=await consentPost(f);assert.equal(r.status,302);assert.equal(calls,2);assert.equal(rows.size,1);assert.ok(rows.has(await p.sha(new URL(r.headers.get('location')).searchParams.get('code'))));}finally{globalThis.fetch=original;}
});

test('persistent code-save timeout returns safe stage/code/request ID, cleans login and stops after two attempts',async()=>{
 const f=await consentFixture(),original=globalThis.fetch,originalError=console.error,logs=[];let calls=0,cleanups=0;
 console.error=x=>logs.push(x);
 globalThis.fetch=async(input,init={})=>{
  const u=new URL(String(input));if(u.pathname==='/auth/v1/token')return j({user:{id:owner},access_token:'fixture-private-session'});
  if(u.pathname==='/auth/v1/logout'){cleanups++;return new Response(null,{status:204});}
  if(u.pathname.endsWith('/icetak_mcp_codes')){calls++;return Response.json({code:'57014',details:'private provider SQL and customer values',message:'canceling statement'},{status:500});}
  return original(input,init);
 };
 try{const r=await consentPost(f),body=await r.json();assert.equal(r.status,503);assert.equal(body.stage,'authorization_code_save');assert.equal(body.reason,'database_timeout');assert.equal(body.provider_code,'57014');assert.match(body.request_id,/^[a-f0-9-]{36}$/);assert.equal(body.request_id,JSON.parse(logs[0]).request_id);assert.equal(calls,2);assert.equal(cleanups,1);assert.equal(r.headers.get('retry-after'),'5');for(const secret of ['fixture-private-session','fixture-private-password',f.params.get('_csrf'),'private provider SQL']){assert.ok(!JSON.stringify(body).includes(secret));assert.ok(!logs.join('').includes(secret));}}finally{console.error=originalError;globalThis.fetch=original;}
});

test('authorization denies inactive owner, cleans the login on lookup failure and does not retry permanent save errors',async()=>{
 const f=await consentFixture(),original=globalThis.fetch,originalError=console.error;let mode='denied',saves=0,cleanups=0;console.error=()=>{};
 globalThis.fetch=async(input,init={})=>{
  const u=new URL(String(input));if(u.pathname==='/auth/v1/token')return j({user:{id:owner},access_token:'fixture-private-session'});
  if(u.pathname==='/auth/v1/logout'){cleanups++;return new Response(null,{status:204});}
  if(u.pathname.endsWith('/admin_users')){if(mode==='denied')return j([]);if(mode==='lookup-failed')throw new TypeError('private network text');}
  if(u.pathname.endsWith('/icetak_mcp_codes')){saves++;return Response.json({code:'23503',details:'private constraint detail'},{status:409});}
  return original(input,init);
 };
 try{let r=await consentPost(f);assert.equal((await r.json()).error,'OWNER_REQUIRED');assert.equal(saves,0);mode='lookup-failed';r=await consentPost(f);assert.equal((await r.json()).stage,'owner_lookup');assert.equal(saves,0);mode='permanent';r=await consentPost(f);assert.equal(r.status,502);assert.equal((await r.json()).provider_code,'23503');assert.equal(saves,1);assert.equal(cleanups,3);}finally{console.error=originalError;globalThis.fetch=original;}
});

test('auth service timeout is reported as availability failure rather than an incorrect password',async()=>{
 const f=await consentFixture(),original=globalThis.fetch,originalError=console.error;let calls=0;console.error=()=>{};
 globalThis.fetch=async(input,init={})=>{if(String(input).includes('/auth/v1/token')){calls++;return Response.json({code:'request_timeout',message:'private service detail'},{status:504});}return original(input,init);};
 try{const r=await consentPost(f),body=await r.json();assert.equal(r.status,503);assert.equal(body.error,'MCP_REQUEST_FAILED');assert.equal(body.stage,'owner_login');assert.equal(body.upstream_status,504);assert.equal(calls,1);assert.ok(!JSON.stringify(body).includes('private service detail'));}finally{console.error=originalError;globalThis.fetch=original;}
});
