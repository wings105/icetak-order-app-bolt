import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source = fs.readFileSync('supabase/functions/shipping-pickup-digest/index.ts','utf8').replace(/^import .*;\n/gm,'');
async function run({date='2026-11-03T09:00:00Z',enabled='true',authorized=true,dryRun=false,method='POST',approved=true,syncFails=false}={}) {
  let handler; const calls=[],writes=[],fetches=[];
  const values={enabled,waba_id:'qa-waba',partner_key:'qa-partner'};
  const client={from(table){let field,criteria={};return {select(){return this},eq(k,v){criteria[k]=v;if(k==='key')field=v;return this},async maybeSingle(){return {data:table==='private_runtime_settings'?{setting_value:'qa-token'}:table==='whatsapp_settings'?{text_value:values[field]}:approved?{status:'APPROVED'}:null}},async upsert(value){writes.push(value);return {data:value}}}},async rpc(name,args){calls.push({name,args});return {data:name.endsWith('_snapshot')?{count:2,items:[]}:{status:enabled==='true'?'queued':'paused',count:2}}}};
  class Clock extends Date {constructor(...args){super(...(args.length?args:[date]));}static now(){return new Date(date).getTime();}}
  vm.runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}),{
    Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://qa.invalid':'qa-service'},serve:h=>handler=h},
    createClient:()=>client,Request,Response,AbortSignal,Date:Clock,Intl,
    fetch:async(url)=>{fetches.push(url);if(syncFails)throw Error('network');return Response.json({templates:[{name:'icetak_pending_pickup_digest_ms',language:'ms',status:'APPROVED',category:'UTILITY',components:[]}]});},
  });
  const response=await handler(new Request('https://qa.invalid',{method,headers:{'content-type':'application/json',...(authorized?{'x-pickup-digest-token':'qa-token'}:{})},...(method==='POST'?{body:JSON.stringify({dry_run:dryRun})}:{})}));
  return {status:response.status,body:await response.json(),calls,writes,fetches};
}
let r=await run({authorized:false});assert.equal(r.status,401);assert.equal(r.calls.length,0);
r=await run({method:'GET'});assert.equal(r.status,405);assert.equal(r.calls.length,0);
r=await run({dryRun:true});assert.equal(r.calls[0].name,'icetak_pending_pickup_snapshot');assert.equal(r.calls.length,1);assert.equal(r.writes.length+r.fetches.length,0);
r=await run({date:'2026-11-03T08:59:59Z'});assert.equal(r.body.status,'not_due');assert.equal(r.calls.length,0);
r=await run();assert.equal(r.body.status,'queued');assert.equal(r.calls[0].args.p_day,'2026-11-03');assert.equal(r.calls.length,1);
r=await run({date:'2026-11-03T16:00:00Z'});assert.equal(r.body.status,'not_due');assert.equal(r.calls.length,0);
r=await run({enabled:'false'});assert.equal(r.body.status,'paused');assert.equal(r.fetches.length,0);
r=await run({approved:false});assert.equal(r.writes[0].status,'APPROVED');assert.equal(r.calls[0].name,'icetak_pending_pickup_enqueue');
r=await run({approved:false,syncFails:true});assert.ok(r.body.template_warning);assert.equal(r.body.status,'queued');
console.log('PASS: actual digest handler auth, read-only preview, exact MYT boundary/date reset, master pause, template cache refresh/failure');

// Exercise the existing actual sender with mocked transports; all cases are dry-run.
const sender=fs.readFileSync('supabase/functions/whatsapp-send/index.ts','utf8').replace(/^import .*;\n/gm,'');
async function send({enabled='true',phone='60123456789',open=true,approved=true}={}) {
 let handler;const unexpected=[];
 vm.runInNewContext(ts.transpile(sender,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}),{
  Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://qa.invalid':'qa-service'},serve:h=>handler=h},Request,Response,AbortController,setTimeout,clearTimeout,Date,Intl,
  mirrorWhatsApp:async()=>false,buildPickupPaymentMessage:()=>null,isPickupOrder:()=>false,
  fetch:async(url,init={})=>{
   if(url.includes('whatsapp_settings?')){const key=new URL(url).searchParams.get('key').slice(3);return Response.json([{text_value:({enabled,admin_order_notify_phone:'60123456789',unified_inbox_24h_url:'https://window.invalid'})[key]||''}]);}
   if(url.includes('window.invalid'))return Response.json({can_send_freeform:open});
   if(url.includes('whatsapp_notification_rules?'))return Response.json([{enabled:true,freeform_enabled:true,template_enabled:true}]);
   if(url.includes('whatsapp_templates?'))return Response.json(approved?[{status:'APPROVED'}]:[]);
   unexpected.push(url);throw Error('Unexpected transport '+url);
  },
 });
 const response=await handler(new Request('https://qa.invalid',{method:'POST',headers:{authorization:'Bearer qa-service','content-type':'application/json'},body:JSON.stringify({phone,event_type:'admin_pending_pickup',mode:'auto',text:'Pending AWBs',template_name:'icetak_pending_pickup_digest_ms',template_language:'ms',template_params:['date','count','parcels'],vars:{date:'03/11/2026',count:'2',parcels:'MY01234567890B, MY09876543210C'},dry_run:true})}));
 return {status:response.status,body:await response.json(),unexpected};
}
r=await send({enabled:'false'});assert.equal(r.body.error,'admin_pickup_disabled');assert.equal(r.unexpected.length,0);
r=await send({phone:'60198765432'});assert.equal(r.body.error,'admin_pickup_recipient_mismatch');assert.equal(r.unexpected.length,0);
r=await send();assert.equal(r.body.mode,'text');assert.equal(r.body.message_preview,'Pending AWBs');assert.equal(r.unexpected.length,0);
r=await send({open:false});assert.equal(r.body.mode,'template');assert.equal(r.body.template_preview.components[0].parameters.length,3);assert.equal(r.unexpected.length,0);
r=await send({open:false,approved:false});assert.match(r.body.error,/template_not_approved/);assert.equal(r.unexpected.length,0);
console.log('PASS: actual sender admin/master guards, freeform-open/template-closed routing and approval; no provider sends or writes');
