import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const strip=p=>stripTypeScriptTypes(readFileSync(p,'utf8').replace(/^import .*;\n/gm,''));
const order='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',session='bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',cid='cccccccc-1111-4111-8111-cccccccccccc',item='dddddddd-1111-4111-8111-dddddddddddd',taskId='qa-direct-topper';
const cf={word:'7c88d5cf-56e9-4108-86c5-b8e7baaf5bdc',review:'01cec4ef-a30b-443d-a43a-9ab09835b78c',confirmed:'afa87c64-3e48-4056-b720-cf8ea9b243e8',ai:'d84d57b3-41f3-473d-b502-4e7bf45ace0c'};
let task,scope,context,recorded,comments,writes,posts,forbidden;
const message=(text,at,id='m1')=>({id,conversation_id:cid,channel:'whatsapp',direction:'inbound',message_type:'text',is_history:false,text_content:text,created_at:at});
function reset(){
 task={id:taskId,list:{id:'18375902'},status:{status:'design editing -topper'},custom_fields:[{id:'sku',name:'SKU',value:'Cake Topper'},{id:cf.word,name:'Customize Name',value:''},{id:cf.review,name:'Review customer',value:''},{id:cf.confirmed,name:'confirmed',value:false}]};
 scope={eligible:true,order_id:order,order_no:'IC-QA-DIRECT',placed_at:'2026-11-01T01:00:00Z',source:'draft_engine',delivery:'pickup',payment_status:'cash_counter',session_id:session,draft_id:'eeeeeeee-1111-4111-8111-eeeeeeeeeeee',conversation_id:cid,start_at:'2026-10-28T01:00:00Z',end_at:'2026-11-02T00:00:00Z',target_item_id:item,single_item_scope:true,note:'',items:[{item_sku:'Cake Topper',title:'Cake Topper',quantity:1,provider_item_id:'ffffffff-1111-4111-8111-ffffffffffff',local_item_id:item}]};
 context={order_id:order,session_id:session,evidence_source:'exact_direct_session',scope_start:scope.start_at,scope_end:scope.end_at,bindings:[{id:cid,usable:true}],messages:[message('Nama: Sample Child\nUmur: 6','2026-10-29T01:00:00Z')],ambiguous:false,truncated:false,unavailable:false};
 recorded={};comments=[];writes=[];posts=0;forbidden=[];
}
const transport=async(raw,opts={})=>{
 const u=new URL(raw),p=u.pathname,b=opts.body?JSON.parse(opts.body):{},method=opts.method||'GET';
 if(u.hostname==='order.test'){
  if(p.endsWith('/private_runtime_settings'))return Response.json([{setting_value:'false'}]);
  if(p.endsWith('/ai_clickup_work_snapshots'))return Response.json([{task_id:taskId,task_name:'1x Cake Topper',list_id:'18375902',order_id:order,marketplace_order_id:null,clickup_status:'design editing -topper',order_reference:'Customer Pickup'}]);
  if(p.endsWith('/task_detail_automation'))return Response.json([{data:{missing:[{key:'wording'}],info_status:'missing'}}]);
  if(p.endsWith('/icetak_autobrief_direct_scope')){assert.equal(b.p_order_id,order);assert.equal(b.p_task_id,taskId);return Response.json(scope);}
  if(p.endsWith('/icetak_record_order_brief')){recorded=b;return Response.json({ok:true});}
 }
 if(p.endsWith('/task-brief-media')){assert.equal(b.action,'direct_context');assert.equal(b.scope.session_id,scope.session_id);return Response.json({ok:true,context});}
 if(u.hostname==='api.clickup.com'){
  if(p.endsWith('/task/'+taskId))return Response.json(task);
  if(p.endsWith('/task/'+taskId+'/comment')){
   if(method==='POST'){posts++;comments=[{id:'c1',comment:b.comment}];return Response.json({id:'c1'});}return Response.json({comments});
  }
  if(p.endsWith('/comment/c1')){comments=[{id:'c1',comment:b.comment}];return Response.json({});}
  if(p.includes('/field/')){const id=p.split('/').at(-1);task.custom_fields.find(x=>x.id===id).value=b.value;writes.push({id,value:b.value});return Response.json({});}
 }
 forbidden.push(u.origin+p);throw Error('Unexpected transport '+u.origin+p);
};
const worker=new Function('Deno','fetch',strip('supabase/functions/clickup-order-brief/index.ts')+';return {process,selectProof};')({env:{get:k=>k==='SUPABASE_URL'?'https://order.test':'synthetic'},serve:()=>{}},transport);
const run=()=>worker.process({task_id:taskId,source_fingerprint:'synthetic',comment_id:comments.length?'c1':null,brief:recorded.p_brief||{},field_receipts:recorded.p_brief?.field_receipts||{},checked_message_ids:recorded.p_brief?.checked_message_ids||[]},'synthetic','synthetic');
reset();let r=await run();assert.equal(r.error,'');assert.equal(task.custom_fields.find(x=>x.id===cf.word).value,'Sample Child 6');assert.equal(task.custom_fields.find(x=>x.id===cf.review).value,cf.ai);assert.equal(task.custom_fields.find(x=>x.id===cf.confirmed).value,true);assert.equal(recorded.p_brief.proof[0].channel,'whatsapp');assert.equal(recorded.p_brief.direct_session.session_id,session);assert.match(comments[0].comment.map(x=>x.text).join(''),/Order ID: IC-QA-DIRECT/);assert.equal(forbidden.length,0);await run();assert.equal(posts,1);
reset();context.messages=[message('Nama: Escaped Child\\nUmur: 8','2026-10-29T01:00:00Z')];await run();assert.equal(task.custom_fields.find(x=>x.id===cf.word).value,'Escaped Child 8');
reset();context.messages=[message('Happy birthday Sample Child\\n\\nNak Topper ambik 8/11','2026-10-29T01:00:00Z')];await run();assert.equal(task.custom_fields.find(x=>x.id===cf.word).value,'Happy birthday Sample Child');
reset();context.messages=[message('Happy birthday Sample Child\\nNak Topper ambik 8/11','2026-10-29T01:00:00Z'),message('Nak Topper 12/11\\nNama di kek: Other','2026-11-01T02:00:00Z','m2')];await run();assert.equal(writes.length,0,'new dated request cannot change previous order');
for(const mode of ['unavailable','ambiguous','truncated','old','future_session','outbound','history','wrong_conversation','unpaid','multi']){
 reset();
 if(['unavailable','ambiguous','truncated'].includes(mode))context[mode]=true;
 if(mode==='old')context.messages[0].created_at='2026-10-27T01:00:00Z';
 if(mode==='future_session')context.messages[0].created_at='2026-11-02T01:00:00Z';
 if(mode==='outbound')context.messages[0].direction='outbound';
 if(mode==='history')context.messages[0].is_history=true;
 if(mode==='wrong_conversation')context.messages[0].conversation_id='other';
 if(mode==='unpaid')scope.payment_status='unpaid';
 if(mode==='multi')scope.single_item_scope=false;
 await run();assert.equal(task.custom_fields.find(x=>x.id===cf.confirmed).value,false,mode);assert.equal(writes.some(x=>x.id===cf.word),false,mode);
}
reset();scope.payment_status='paid';scope.delivery='courier';await run();assert.equal(task.custom_fields.find(x=>x.id===cf.word).value,'Sample Child 6');assert.equal(recorded.p_brief.direct_session.draft_id,scope.draft_id);
reset();scope={eligible:false,reason:'ORDER_CLOSED'};r=await run();assert.equal(r.error,'ORDER_CLOSED');assert.equal(posts,0);assert.equal(writes.length,0);
reset();scope.source='customer';scope.delivery='courier';scope.payment_status='paid';scope.session_id=null;context.session_id=null;scope.draft_id=null;scope.start_at=scope.placed_at;context.scope_start=scope.start_at;context.messages=[message('Nama: Website Child\nUmur: 7','2026-11-01T02:00:00Z')];await run();assert.equal(task.custom_fields.find(x=>x.id===cf.word).value,'Website Child 7');
// New read-only bridge route uses the existing mandatory token; no send capability.
let handler,rpc=0;
new Function('Deno','fetch',strip('supabase/inbox-functions/task-brief-media/index.ts'))({env:{get:k=>k==='SUPABASE_URL'?'https://inbox.test':'synthetic'},serve:h=>handler=h},async(raw,opts={})=>{
 const p=new URL(raw).pathname;
 if(p.endsWith('/private_runtime_settings'))return Response.json([{setting_value:'private-test'}]);
 assert(p.endsWith('/icetak_autobrief_whatsapp_context'));rpc++;return Response.json(context);
});
const req=token=>handler(new Request('https://media.test',{method:'POST',headers:{'content-type':'application/json',...(token?{'x-admin-window-token':token}:{})},body:JSON.stringify({action:'direct_context',scope})}));
assert.equal((await req('')).status,401);assert.equal(rpc,0);assert.equal((await req('private-test')).status,200);assert.equal(rpc,1);
console.log('PASS direct WhatsApp AutoBrief: actual worker and bridge, pickup/cash-counter/prepaid-converted/website scope, pre-checkout session detail, canonical order/item proof, CF/Ai Check/Confirmed, replay, old/next-session/history/identity/unpaid/multi/closed/auth guards and no customer sends.');
