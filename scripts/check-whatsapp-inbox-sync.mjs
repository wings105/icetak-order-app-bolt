import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mirrorWhatsApp,flushWhatsAppInbox} from '../supabase/functions/_shared/whatsapp-inbox-sync.ts';
const row={id:'fixture-outbox',status:'sent',provider_message_id:'fixture-wamid',phone:'60123456789',sent_at:'2026-10-10T07:03:00Z',body:'Actual rendered message',mode:'text',inbox_sync_status:'pending',inbox_sync_attempts:0};
const updates=[];let calls=0;let failure=false;
const rest=async(path,init)=>{if(init){updates.push(JSON.parse(init.body));return [];}if(path.startsWith('private_runtime'))return [{setting_value:'fixture-private-bridge'}];return [row];};
const provider=async(url,init)=>{calls++;assert.equal(url,'https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/order-whatsapp-outbound');const b=JSON.parse(init.body);assert.equal(b.text,row.body);assert.equal(b.sent_at,row.sent_at);assert.equal(b.provider_message_id,row.provider_message_id);assert.equal(init.redirect,'error');return Response.json(failure?{ok:false}:{ok:true,message_id:'fixture-local'}, {status:failure?503:200});};
assert.equal(await mirrorWhatsApp(rest,{...row,status:'failed'},provider),false);assert.equal(calls,0);
assert.equal(await mirrorWhatsApp(rest,{...row,inbox_sync_status:'synced'},provider),false);assert.equal(calls,0);
assert.equal(await mirrorWhatsApp(rest,row,provider),true);assert.equal(updates.at(-1).inbox_sync_status,'synced');assert.ok(!('status' in updates.at(-1)));
failure=true;assert.equal(await mirrorWhatsApp(rest,row,provider),false);assert.equal(updates.at(-1).inbox_sync_status,'retry');assert.ok(!('status' in updates.at(-1)));assert.ok(!JSON.stringify(updates).includes('fixture-private-bridge'));
const old=globalThis.fetch;try{globalThis.fetch=provider;failure=false;assert.deepEqual(await flushWhatsAppInbox(rest),{processed:1,synced:1});}finally{globalThis.fetch=old;}
console.log('WhatsApp Inbox log-only sync checks passed: original text/time/ID, auth boundary, no provider sends, failure isolation and retry.');
// Exercise the real sender with a fake provider: log failure must not cause a re-send.
let handler;let audit=null;let sends=0;let mirrorFails=true;let auditFails=false;
globalThis.Deno={env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'fixture-service':'https://order.fixture'},serve:fn=>handler=fn};
const bundle=await build({entryPoints:['supabase/functions/whatsapp-send/index.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'jsr-fixture',setup(b){b.onResolve({filter:/^jsr:/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'',loader:'js'}));}}]});
await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.fetch=async(url,init={})=>{
 const u=new URL(url);
 if(u.hostname==='officialapi.wasapflow.com'){sends++;return Response.json({message_id:'fixture-real-sender-wamid'});}
 if(u.hostname==='uujcqcsfghqkukaydruc.supabase.co')return Response.json(mirrorFails?{ok:false}:{ok:true,message_id:'fixture-local'}, {status:mirrorFails?503:200});
 if(u.pathname.endsWith('whatsapp_notification_rules'))return Response.json([{}]);
 if(u.pathname.endsWith('whatsapp_settings')){const key=u.searchParams.get('key');const values={ 'eq.unified_inbox_24h_url':'https://window.fixture', 'eq.partner_key':'fixture-partner', 'eq.waba_id':'fixture-waba'};return Response.json([{text_value:values[key]||''}]);}
 if(u.hostname==='window.fixture')return Response.json({ok:true,can_send_freeform:true});
 if(u.pathname.endsWith('private_runtime_settings'))return Response.json([{setting_value:'fixture-bridge'}]);
 if(u.pathname.endsWith('whatsapp_outbox')){
  if(init.method==='POST'){if(auditFails)return Response.json({error:'fixture audit unavailable'},{status:503});audit={...JSON.parse(init.body),id:'e0363780-8d6c-4ec9-ab51-b31962718284'};return Response.json([audit]);}
  if(init.method==='PATCH'){audit={...audit,...JSON.parse(init.body)};return Response.json([audit]);}
  return Response.json(audit?.status==='sent'?[audit]:[]);
 }
 throw new Error('Unexpected fixture fetch '+u.pathname);
};
const request=()=>new Request('https://sender.fixture',{method:'POST',headers:{authorization:'Bearer fixture-service','content-type':'application/json'},body:JSON.stringify({phone:'60123456789',mode:'text',event_type:'manual',text:'Fixture message',idempotency_key:'fixture-sender-id'})});
try{
 const first=await handler(request());assert.equal(first.status,200);assert.equal(sends,1);assert.equal(audit.status,'sent');assert.equal(audit.inbox_sync_status,'retry');
 mirrorFails=false;const retry=await handler(request());assert.equal((await retry.json()).duplicate,true);assert.equal(sends,1);assert.equal(audit.inbox_sync_status,'synced');
 audit=null;auditFails=true;assert.equal((await handler(request())).status,503);assert.equal(sends,1);
 console.log('Real sender fixture passed: provider called once, mirror failure stays sent, duplicate repairs log, unavailable audit blocks send.');
}finally{globalThis.fetch=old;delete globalThis.Deno;}
