import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicConfig, readiness, shopeeRequest, sha256, checkConnection } from '../supabase/inbox-functions/_shared/shopee-direct.ts';
import { sendShopee } from '../supabase/inbox-functions/_shared/shopee-send.ts';

const dir = await mkdtemp(join(tmpdir(), 'icetak-shopee-'));
let checks = 0;
const c = { partner_id: '123', shop_id: '456', partner_key: 'fixture-partner', access_token: 'fixture-access', enabled: true, token_expires_at: new Date(Date.now()+3600000).toISOString(), credential_version: 2, checked_credential_version: 2, check_ok: true, webhook_key_hash: 'fixture-hash' };
const oldFetch = globalThis.fetch;
try {
  const clean = JSON.stringify(publicConfig(c));
  for (const secret of [c.partner_key,c.access_token,c.webhook_key_hash]) assert.ok(!clean.includes(secret));
  assert.equal(readiness(c),'READY'); assert.equal(readiness(c,'999'),'SHOP_MISMATCH'); assert.equal(readiness({...c,enabled:false}),'DISABLED'); assert.equal(readiness({...c,token_expires_at:new Date(0).toISOString()}),'TOKEN_EXPIRED'); assert.equal(readiness({...c,checked_credential_version:1}),'CHECK_REQUIRED'); checks+=6;
  await shopeeRequest(c,'/api/v2/sellerchat/send_message',{to_id:789,message_type:'text',content:{text:'Hello'}},'POST',async(url,init)=>{
    const u=new URL(url);
    assert.equal(u.origin,'https://partner.shopeemobile.com');
    assert.equal(u.searchParams.get('sign'),createHmac('sha256',c.partner_key).update(`${c.partner_id}${u.pathname}${u.searchParams.get('timestamp')}${c.access_token}${c.shop_id}`).digest('hex'));
    assert.deepEqual(JSON.parse(init.body),{to_id:789,message_type:'text',content:{text:'Hello'}}); assert.equal(init.redirect,'error');
    return Response.json({response:{message_id:'fixture-message'}});
  }); checks++;
  let record;
  const checkDb={from:()=>({select(){return this},eq(){return this},order(){return this},limit:async()=>({data:[{metadata:{shop_id:'456'},external_conversation_id:'conv-provider'}]})}),rpc:async(name,args)=>{record=args.p_body;return {data:{...c,check_ok:record.ok,checked_credential_version:record.credential_version}}}};
  await checkConnection(checkDb,c,'owner',async()=>Response.json({response:{conversation_id:'conv-provider'}}));assert.equal(record.ok,true);
  await checkConnection(checkDb,c,'owner',async()=>Response.json({response:{}}));assert.equal(record.ok,false);
  await checkConnection(checkDb,c,'owner',async()=>Response.json({error:'bad_token',message:c.access_token}));assert.equal(record.code,'SHOPEE_bad_token');checks+=3;
  const unknownExpiry={...c,token_expires_at:null};
  assert.equal(readiness(unknownExpiry),'READY');
  assert.equal(readiness({...c,token_expires_at:'bad-date'}),'TOKEN_EXPIRED');
  let unknownReads=0;
  await checkConnection(checkDb,unknownExpiry,'owner',async()=>{unknownReads++;return Response.json({response:{conversation_id:'conv-provider'}})});
  assert.equal(unknownReads,1);assert.equal(record.ok,true);checks+=3;
  let claims=0, sends=0, status='sending', mode='success', config={...c};
  const conversation={id:'00000000-0000-0000-0000-000000000001',channel:'shopee',external_customer_id:'789',metadata:{shop_id:'456'},external_conversation_id:'conv-provider'};
  const updates=[];
  const db={from(table){return {select(){return this},eq(){return this},in(){return this},single:async()=>({data:conversation}),then(resolve,reject){return Promise.resolve({data:[{setting_key:'shopee_chat_direct_config',setting_value:JSON.stringify(config)}]}).then(resolve,reject)},update(value){updates.push({table,value});return this},insert:async()=>({error:null})}},rpc:async()=>{claims++;return {data:{claimed:claims===1,attempt:{id:'attempt',status,local_message_id:'local',provider_message_id:status==='sent'?'fixture-message':null}}}}};
  globalThis.fetch=async()=>{sends++;return Response.json(mode==='success'?{response:{message_id:'fixture-message'}}:{error:'permission_denied'})};
  const sendBody={conversation_id:conversation.id,text:'Hello',request_id:'00000000-0000-0000-0000-000000000002'};
  const actor={id:'owner',label:'owner'};
  config.token_expires_at=new Date(0).toISOString(); assert.equal((await sendShopee(db,sendBody,actor)).status,503); assert.equal(claims,0); assert.equal(sends,0); checks++;
  config={...c}; assert.equal((await sendShopee(db,sendBody,actor)).status,200); assert.equal(sends,1); assert.ok(updates.some(x=>x.table==='messages'&&x.value.provider_message_id==='fixture-message')); checks++;
  status='sent'; assert.equal((await sendShopee(db,sendBody,actor)).status,200);assert.equal(sends,1);checks++;
  claims=0; mode='error'; assert.equal((await sendShopee(db,{...sendBody,request_id:'00000000-0000-0000-0000-000000000003'},actor)).status,502);assert.ok(updates.some(x=>x.table==='messages'&&x.value.status==='failed'));checks++;
  async function handler(file, fixtureDb){
    globalThis.fixtureDB=fixtureDb;
    let fn; globalThis.Deno={env:{get:()=> 'https://fixture.supabase.co'},serve:value=>fn=value};
    const output=join(dir,`${Math.random()}.mjs`);
    await build({entryPoints:[file],outfile:output,bundle:true,platform:'node',format:'esm',plugins:[{name:'runtime-fixture',setup(b){b.onResolve({filter:/^(https:\/\/esm.sh|jsr:)/},args=>({path:args.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.startsWith('jsr:')?'':'export function createClient(){return globalThis.fixtureDB}',loader:'js'}));}}]});
    await import(pathToFileURL(output).href); return fn;
  }
  const request=(action,header='')=>new Request('https://fixture.example',{method:'POST',headers:{'content-type':'application/json',...(header?{authorization:header}:{})},body:JSON.stringify({action})});
  let role='owner', bridgeCalls=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url).includes('/auth/v1/user'))return Response.json({id:'owner-user'});
    if(String(url).includes('admin_users?'))return Response.json([{username:'trusted-owner',role}]);
    if(String(url).includes('private_runtime_settings?'))return Response.json([{setting_value:'fixture-bridge'}]);
    assert.equal(String(url),'https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-chat-config');assert.equal(JSON.parse(init.body).actor,'trusted-owner');bridgeCalls++;return Response.json({ok:true,config:publicConfig(c)});
  };
  const gateway=await handler('supabase/functions/shopee-chat-settings/index.ts',null);
  assert.equal((await gateway(request('get'))).status,401); role='admin'; assert.equal((await gateway(request('save','Bearer fixture'))).status,403);assert.equal(bridgeCalls,0);role='owner';assert.equal((await gateway(request('get','Bearer fixture'))).status,200);checks+=3;
  const hookKey='fixture-rotation-key-that-is-at-least-forty-characters', hash=await sha256(hookKey);
  let rotationCalls=0;
  let rotationBody;
  const rotationDb={rpc:async(name,args)=>args.p_action==='get'?{data:{...c,webhook_key_hash:hash}}:(rotationCalls++,rotationBody=args.p_body,assert.equal(args.p_body.webhook_key_hash,hash),{data:{...c,duplicate:true}})};
  const rotation=await handler('supabase/inbox-functions/shopee-token-rotate/index.ts',rotationDb);
  assert.equal((await rotation(request('get'))).status,401);assert.equal(rotationCalls,0);
  const response=await rotation(new Request('https://fixture.example',{method:'POST',headers:{'x-icetak-shopee-key':hookKey},body:JSON.stringify({partner_id:'123',shop_id:'456',access_token:'fixture-new-token',rotated_at:new Date().toISOString(),expires_at:c.token_expires_at})}));
  assert.equal(response.status,200);const body=await response.text();assert.ok(!body.includes(c.access_token));assert.ok(!body.includes(hookKey));assert.equal(rotationCalls,1);checks+=2;
  for(const optional of [{},{rotated_at:'',expires_at:''}]){
    const r=await rotation(new Request('https://fixture.example',{method:'POST',headers:{'x-icetak-shopee-key':hookKey},body:JSON.stringify({partner_id:'123',shop_id:'456',access_token:'fixture-new-token',...optional})}));
    assert.equal(r.status,200);assert.equal(rotationBody.access_token,'fixture-new-token');checks++;
  }
  // Unknown expiry requires a fresh provider read; a failed read creates no outbox claim.
  let readAllowed=true, preflights=0, unknownClaims=0, unknownSends=0;
  const unknownDb={from(table){return {select(){return this},eq(){return this},in(){return this},order(){return this},single:async()=>({data:conversation}),limit:async()=>({data:[conversation]}),then(resolve,reject){return Promise.resolve({data:[{setting_key:'shopee_chat_direct_config',setting_value:JSON.stringify(unknownExpiry)}]}).then(resolve,reject)},update(){return this},insert:async()=>({})}},rpc:async(name,args)=>{
    if(name==='icetak_shopee_chat_config')return {data:{...unknownExpiry,check_ok:args.p_body.ok,checked_credential_version:args.p_body.credential_version}};
    unknownClaims++;return {data:{claimed:unknownClaims===1,attempt:{id:'attempt',status:'sending',local_message_id:'local'}}};
  }};
  globalThis.fetch=async(url)=>{if(new URL(url).pathname.endsWith('get_one_conversation')){preflights++;return Response.json(readAllowed?{response:{conversation_id:'conv-provider'}}:{error:'bad_token'})}unknownSends++;return Response.json({response:{message_id:'fixture-message'}})};
  readAllowed=false;assert.equal((await sendShopee(unknownDb,sendBody,actor)).status,503);assert.equal(unknownClaims,0);assert.equal(unknownSends,0);checks++;
  readAllowed=true;assert.equal((await sendShopee(unknownDb,sendBody,actor)).status,200);assert.equal(preflights,2);assert.equal(unknownSends,1);checks++;
  await sendShopee(unknownDb,sendBody,actor);assert.equal(unknownSends,1);checks++;
  const inactiveDb={auth:{getUser:async()=>({data:{user:{id:'inactive-staff'}}})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{display_name:'Inactive',role:'staff',active:false}})})};
  const staffSend=await handler('supabase/inbox-functions/shopee-chat-send/index.ts',inactiveDb);
  assert.equal((await staffSend(new Request('https://fixture.example',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify(sendBody)}))).status,403);checks++;
  console.log(`${checks} Shopee direct checks passed: signing, redaction, expiry/shop guards, read diagnostics, outbox idempotency, owner-only gateway and scoped rotation.`);
} finally {globalThis.fetch=oldFetch;delete globalThis.Deno;delete globalThis.fixtureDB;await rm(dir,{recursive:true,force:true});}
