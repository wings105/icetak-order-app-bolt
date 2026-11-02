import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const stripped=path=>stripTypeScriptTypes(readFileSync(path,'utf8').replace(/^import .*;\n/gm,''));
const code=stripped('supabase/inbox-functions/autobrief-followup/index.ts');
const workerCode=stripped('supabase/functions/clickup-order-brief/index.ts');
const fixed=Date.parse('2026-11-02T05:00:00Z'),RealDate=Date;
let now=fixed;
globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const shop='111111111',buyer='222222222',order='QA000000000001',cid='123456789012345678',taskId='qa-followup';
const phaseKey=p=>shop+':'+order+':'+p;
let ledger=new Map(),history=[],sends=[],unknown=false,recorded={},comment='',commentPosts=0,fieldWrites=[];
let providerStatus='READY_TO_SHIP',buyerNote='',control=true,replyInserted=false,linkedReply=false;
const cf={name:'7c88d5cf-56e9-4108-86c5-b8e7baaf5bdc',review:'01cec4ef-a30b-443d-a43a-9ab09835b78c',confirmed:'afa87c64-3e48-4056-b720-cf8ea9b243e8',ai:'d84d57b3-41f3-473d-b502-4e7bf45ace0c',follow:'qa-follow-option'};
let task;
function reset(){
 now=fixed;ledger=new Map();history=[];sends=[];unknown=false;recorded={};comment='';commentPosts=0;fieldWrites=[];providerStatus='READY_TO_SHIP';buyerNote='';control=true;replyInserted=false;linkedReply=false;
 task={id:taskId,status:{status:'design editing -topper'},list:{id:'18375902'},custom_fields:[
  {id:'sku',name:'SKU',value:'CN1001'},{id:cf.name,name:'Customize Name',value:''},
  {id:cf.confirmed,name:'confirmed',value:false},{id:cf.review,name:'Review customer',value:'',type_config:{options:[{id:cf.ai,name:'Ai Check',orderindex:15},{id:cf.follow,name:'follow up1',orderindex:12}]}}
 ]};
}
const clone=x=>JSON.parse(JSON.stringify(x));
const providerMessage=(text,direction='inbound',id='987654321012345678')=>({message_id:id,conversation_id:cid,message_type:'text',content:{text},from_id:direction==='inbound'?buyer:'333333333',to_id:direction==='inbound'?'333333333':buyer,created_timestamp:Math.floor(now/1000)});
const provider=async(config,path,payload,method)=>{
 assert.equal(config.shop_id,shop);
 if(path.endsWith('/get_order_detail'))return Response.json({response:{order_list:[{order_sn:order,buyer_user_id:buyer,order_status:providerStatus,create_time:Math.floor(Date.parse('2026-11-02T00:00:00Z')/1000),ship_by_date:Math.floor(Date.parse('2026-11-02T15:59:59Z')/1000),message_to_seller:buyerNote,item_list:[{item_sku:task.custom_fields[0].value.replace(/ SG$/,''),item_id:'444444444'}]}]}});
 if(path.endsWith('/get_conversation_list'))return Response.json({response:{conversations:[{conversation_id:cid,to_id:buyer}]}});
 if(path.endsWith('/get_one_conversation'))return Response.json({response:{conversation_id:cid,to_id:buyer}});
 if(path.endsWith('/get_message'))return Response.json({response:{messages:clone(history)}});
 if(path.endsWith('/send_message')){
  assert.equal(method,'POST');assert.equal(payload.to_id,Number(buyer));sends.push(clone(payload));
  if(unknown)throw Error('lost response');
  const m=providerMessage(payload.content.text,'outbound',String(900000000000000000n+BigInt(sends.length)));history.push(m);
  return Response.json({response:{message_id:m.message_id}});
 }
 throw Error('Unexpected provider path '+path);
};
const inboxFetch=async(raw,opts={})=>{
 const u=new URL(raw),path=u.pathname,body=opts.body?JSON.parse(opts.body):{};
 if(path.endsWith('/private_runtime_settings'))return Response.json([{setting_value:u.searchParams.get('setting_key')==='eq.admin_window_bridge_token'?'bridge-test':JSON.stringify({enabled:true,shop_id:shop,environment:'production',access_token:'synthetic',partner_key:'synthetic'})}]);
 if(path.endsWith('/conversations')||path.endsWith('/messages'))return Response.json([]);
 if(path.endsWith('/autobrief_followup_context'))return Response.json([]);
 if(path.endsWith('/autobrief_followup_control'))return Response.json([{enabled:control}]);
 if(path.endsWith('/autobrief_followup_deliveries'))return Response.json([...ledger.values()].map(clone));
 if(path.endsWith('/icetak_autobrief_delivery')){
  const k=phaseKey(body.p_phase),b=body.p_body;let r=ledger.get(k);
  if(body.p_action==='claim'){
   if(r)return Response.json({...r,claimed:false});
   r={phase:body.p_phase,state:'sending',request_id:crypto.randomUUID(),buyer_id:buyer,text_content:b.text};ledger.set(k,r);return Response.json({...r,claimed:true});
  }
  if(body.p_action==='manual'||body.p_action==='observe'){
   r={...r,phase:body.p_phase,state:body.p_action==='manual'?'manual':'sent',request_id:r?.request_id||crypto.randomUUID(),provider_message_id:b.provider_message_id,sent_at:b.sent_at||new Date(now).toISOString()};ledger.set(k,r);return Response.json(r);
  }
  if(body.p_action==='record'){assert.equal(b.request_id,r.request_id);Object.assign(r,b,{sent_at:b.state==='sent'?new Date(now).toISOString():null});return Response.json(r);}
 }
 throw Error('Unexpected Inbox path '+path);
};
let inboxHandler;
const bridgeApi=new Function('Deno','fetch','shopeeRequest',code+'\nreturn {inspect,send,phaseGuard,deadlineAt,FIRST,DEADLINE,providerJSON};')(
 {env:{get:k=>k==='SUPABASE_URL'?'https://inbox.test':'synthetic'},serve:fn=>inboxHandler=fn},inboxFetch,provider);
const config={shop_id:shop};
const input={shop_id:shop,order_sn:order,buyer_user_id:buyer,target_sku:'CN1001',target_product_id:'444444444'};
const invoke=body=>inboxHandler(new Request('https://bridge.test',{method:'POST',headers:{'content-type':'application/json','x-admin-window-token':'bridge-test'},body:JSON.stringify({...input,...body})}));
reset();
assert.equal(bridgeApi.deadlineAt(Date.parse('2026-11-02T15:59:59Z')/1000),Date.parse('2026-11-02T06:00:00Z'));
await assert.rejects(bridgeApi.send({...input,phase:'first',target_product_id:'999'},config),/TARGET_PRODUCT_NOT_VERIFIED/);assert.equal(sends.length,0);
assert.equal(bridgeApi.providerJSON('{"conversation_id":123456789012345678}').conversation_id,cid);
let ctx=await bridgeApi.inspect(input,config);assert.equal(ctx.available,true);assert.equal(ctx.conversation_id,cid);
const firstRequest={...input,phase:'first',revision:ctx.revision};
await Promise.all([bridgeApi.send(firstRequest,config),bridgeApi.send(firstRequest,config)]);
assert.equal(sends.length,1,'concurrent duplicate must send once');assert.equal(sends[0].content.text,bridgeApi.FIRST);
await bridgeApi.send(firstRequest,config);assert.equal(sends.length,1);

reset();unknown=true;ctx=await bridgeApi.inspect(input,config);
await bridgeApi.send({...input,phase:'first',revision:ctx.revision},config);
await bridgeApi.send({...input,phase:'first',revision:ctx.revision},config);
assert.equal(sends.length,1);assert.equal(ledger.get(phaseKey('first')).state,'unknown');
history.push(providerMessage(bridgeApi.FIRST,'outbound'));unknown=false;
await bridgeApi.send({...input,phase:'first',revision:ctx.revision},config);
assert.equal(sends.length,1);assert.equal(ledger.get(phaseKey('first')).state,'sent','provider history repairs unknown without resend');

reset();task.custom_fields[3].value=cf.follow;
history=[providerMessage(bridgeApi.FIRST.replace(/\n/g,'\\n').replace(/"/g,'\\"'),'outbound')];
ctx=await bridgeApi.inspect(input,config);
await bridgeApi.send({...input,phase:'first',manual_followup:true,revision:ctx.revision},config);
assert.equal(sends.length,0);assert.equal(ledger.get(phaseKey('first')).state,'sent','prior escaped manual API message is adopted');

const original=clone(ledger.get(phaseKey('first')));
now=Date.parse('2026-11-02T05:59:59Z');ctx=await bridgeApi.inspect(input,config);
let response=await (await bridgeApi.send({...input,phase:'deadline',revision:ctx.revision},config)).json();assert.equal(response.reason,'WAIT_1400_MYT');assert.equal(sends.length,0);
now=Date.parse('2026-11-02T06:00:00Z');ctx=await bridgeApi.inspect(input,config);
await bridgeApi.send({...input,phase:'deadline',revision:ctx.revision},config);
assert.equal(sends.length,1);assert.equal(sends[0].content.text,bridgeApi.DEADLINE);
await bridgeApi.send({...input,phase:'deadline',revision:ctx.revision},config);assert.equal(sends.length,1);

for(const scenario of ['reply','note','unpaid','cancelled','revision','disabled']){
 reset();ledger.set(phaseKey('first'),clone(original));now=Date.parse('2026-11-02T06:00:00Z');
 if(scenario==='reply')history=[providerMessage('Nama: Sample Child\nUmur: 6')];
 if(scenario==='note')buyerNote='Sample Child turns 6';
 if(scenario==='unpaid')providerStatus='UNPAID';
 if(scenario==='cancelled')providerStatus='CANCELLED';
 if(scenario==='disabled')control=false;
 ctx=await bridgeApi.inspect(input,config);
 response=await (await bridgeApi.send({...input,phase:'deadline',revision:scenario==='revision'?'stale':ctx.revision},config)).json();
 assert.equal(response.skipped,true,scenario+JSON.stringify(response));assert.equal(sends.length,0,scenario);
}
reset();now=Date.parse('2026-11-02T00:14:59.999Z');ctx=await bridgeApi.inspect(input,config);
assert.equal(bridgeApi.phaseGuard(ctx,'first'),'WAIT_15_MINUTES');
now=Date.parse('2026-11-02T00:15:00Z');assert.equal(bridgeApi.phaseGuard(ctx,'first'),'');
assert.equal((await inboxHandler(new Request('https://bridge.test',{method:'POST',body:'{}'}))).status,401);

// Execute the real Order worker and real Inbox handler together with synthetic
// database/ClickUp/provider boundaries. Verify actual CF and comment outcomes.
const orderFetch=async(raw,opts={})=>{
 const u=new URL(raw),path=u.pathname,b=opts.body?JSON.parse(opts.body):{},method=opts.method||'GET';
 if(u.hostname==='order.test'){
  if(path.endsWith('/private_runtime_settings'))return Response.json([{setting_value:u.searchParams.get('setting_key')==='eq.order_brief_followup_enabled'?'true':'bridge-test'}]);
  if(path.endsWith('/ai_clickup_work_snapshots'))return Response.json(u.searchParams.has('task_id')?[{task_id:taskId,task_name:'1x CN1001',list_id:'18375902',marketplace_order_id:'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',clickup_status:'design editing -topper',order_reference:order}]:[{task_id:taskId,task_name:'1x CN1001'}]);
  if(path.endsWith('/task_detail_automation'))return Response.json([{data:{missing:[{key:'wording'}],info_status:'missing'}}]);
  if(path.endsWith('/marketplace_orders'))return Response.json(u.searchParams.has('buyer_user_id')?[]:[{buyer_message:'',placed_at:'2026-11-02T00:00:00Z',current_status:providerStatus,buyer_user_id:buyer,shop_id:shop,order_sn:order}]);
  if(path.endsWith('/marketplace_order_items'))return Response.json([{item_sku:task.custom_fields[0].value.replace(/ SG$/,''),title:'Synthetic Topper',quantity:1,provider_item_id:'444444444'}]);
  if(path.endsWith('/icetak_record_order_brief')){recorded=b;return Response.json({ok:true});}
 }
 if(path.endsWith('/autobrief-followup'))return await invoke(b);
 if(path.endsWith('/task-brief-media'))return Response.json(b.action==='buyer_note'?{ok:true,available:true,order_sn:order,shop_id:shop,buyer_note:'',buyer_user_id:buyer}:{ok:true,matched:true,conversation_id:'local',messages:linkedReply?[{id:'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',conversation_id:'local',direction:'inbound',channel:'whatsapp',is_history:false,message_type:'text',text_content:'Boleh pos esok?',created_at:new Date(now).toISOString()}]:[]});
 if(u.hostname==='api.clickup.com'){
  if(path.endsWith('/task/'+taskId))return Response.json(clone(task));
  if(path.endsWith('/task/'+taskId+'/comment')){
   if(method==='POST'){commentPosts++;comment=b.comment_text;return Response.json({id:'comment1'});}return Response.json({comments:comment?[{id:'comment1',comment:[{text:comment}]}]:[]});
  }
  if(path.endsWith('/comment/comment1')){comment=b.comment_text;return Response.json({});}
  if(path.includes('/field/')){const id=path.split('/').at(-1),f=task.custom_fields.find(x=>x.id===id);assert(f);f.value=b.value;fieldWrites.push({id,value:b.value});return Response.json({});}
 }
 throw Error('Unexpected Order path '+u.origin+path);
};
const worker=new Function('Deno','fetch',workerCode+'\nreturn {process};')({env:{get:k=>k==='SUPABASE_URL'?'https://order.test':'synthetic'},serve:()=>{}},orderFetch);
const run=async(expectedError='')=>{
 const previous=recorded.p_brief||{};
 const result=await worker.process({task_id:taskId,source_fingerprint:'synthetic',state:'processing',brief:previous,comment_id:comment?'comment1':null,checked_message_ids:previous.checked_message_ids||[],field_receipts:previous.field_receipts||{}},'synthetic','bridge-test');
 assert.equal(result.error,expectedError,JSON.stringify(result));return result;
};
reset();await run();assert.equal(sends.length,1);assert.equal(task.custom_fields[3].value,cf.follow);assert.equal(task.custom_fields[1].value,'');assert.match(comment,/Order ID: QA000000000001/);
await run();assert.equal(sends.length,1);assert.equal(commentPosts,1);
history.push(providerMessage('Sample Child 6 tahun'));await run();
assert.equal(task.custom_fields[1].value,'Sample Child 6 tahun');assert.equal(task.custom_fields[3].value,cf.ai);assert.equal(task.custom_fields[2].value,true);assert.equal(sends.length,1);assert.equal(recorded.p_brief.confirmed,true);

reset();await run();now=Date.parse('2026-11-02T06:00:00Z');await run();
assert.equal(sends.length,2);assert.equal(task.custom_fields[1].value,'hb');assert.equal(task.custom_fields[2].value,false,'default only changes requested wording, not customer confirmation');assert.equal(task.custom_fields[3].value,cf.follow);assert.equal(recorded.p_brief.followup.defaulted,true);
await run();assert.equal(sends.length,2);assert.equal(commentPosts,1);
history.push(providerMessage('Nama: Sample Late\nUmur: 7'));await run();assert.equal(task.custom_fields[1].value,'Sample Late 7');assert.equal(task.custom_fields[3].value,cf.ai);assert.equal(task.custom_fields[2].value,true);
reset();linkedReply=true;await run();assert.equal(sends.length,0,'linked WhatsApp reply stops first request');
reset();await run();linkedReply=true;now=Date.parse('2026-11-02T06:00:00Z');await run();assert.equal(sends.length,1,'linked WhatsApp detail/question stops default');assert.equal(task.custom_fields[1].value,'');
reset();task.custom_fields[1].value='Staff Provided Name';await run();assert.equal(sends.length,0);assert.equal(task.custom_fields[1].value,'Staff Provided Name');
reset();task.custom_fields[0].value='CN1001 SG';await run();assert.equal(sends.length,1,'SG SKU suffix uses the same verified provider product');assert.equal(task.custom_fields[3].value,cf.follow);
reset();const oldMessage=providerMessage('Old Customer Name turns 4');oldMessage.created_timestamp=Date.parse('2026-11-01T23:59:00Z')/1000;history=[oldMessage];ctx=await bridgeApi.inspect(input,config);assert.equal(ctx.messages.length,0,'provider fallback never reuses pre-order history');
reset();task.status.status='cake topper - printing';await run('OUT_OF_SCOPE_TOPPER_ONLY');assert.equal(sends.length,0);assert.equal(fieldWrites.length,0);
globalThis.Date=RealDate;
console.log('PASS AutoBrief follow-up: actual bridge/worker, 15-minute and 14:00 MYT boundaries, exact text, manual adoption, duplicate/concurrent/lost-response/reconciliation, reply/note/status/revision/auth guards, follow up1→Ai Check, hb-only default, late reply, protected production and stable comment.');
