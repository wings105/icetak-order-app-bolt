import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

const source=readFileSync('supabase/functions/clickup-order-brief/index.ts','utf8').replace(/^import .*;\n/gm,'');
let handler;
const load=fetcher=>new Function('Deno','fetch',stripTypeScriptTypes(source)+
 '\nreturn {labelledProductWordingRule,productReferences,targetProduct,aiAnalyzeOrder,briefText,process};')(
 {env:{get:k=>({SUPABASE_URL:'https://order.test',SUPABASE_SERVICE_ROLE_KEY:'test-service',OPENAI_API_KEY:'test-ai'})[k]||''},serve:fn=>handler=fn},fetcher);
const items=[
 {item_sku:'CN1001',title:'CUSTOM NAME Spiderman Cake Topper',provider_item_id:'1111111111',quantity:1},
 {item_sku:'CN1002',title:'CUSTOM NAME Frozen Elsa Anna Cake Topper',provider_item_id:'2222222222',quantity:1},
 {item_sku:'CN1003',title:'CUSTOM NAME Kuromi Cake Topper',provider_item_id:'3333333333',quantity:1}
];
const note='Spiderman - Sample Alpha turn 8\nKuromi - Sample Beta turn 3\nFrozen - Sample Gamma turn 1';
const base={note,existingWord:note,sku:'CN1001',items,siblingTasks:items.map(x=>({task_name:'1x '+x.item_sku})),messages:[],context:{}};
const api=load(async()=>{throw Error('unexpected network')});
assert.equal(api.labelledProductWordingRule(base).wording,'Sample Alpha turn 8');
assert.equal(api.labelledProductWordingRule({...base,sku:'CN1002'}).wording,'Sample Gamma turn 1');
assert.equal(api.labelledProductWordingRule({...base,sku:'CN1003',items:[items[2],items[0],items[1]]}).wording,'Sample Beta turn 3');
for(const input of [
 {...base,items:[items[0],{...items[1],title:'Frozen and Spiderman Topper'},items[2]]},
 {...base,note:'Spiderman - Sample Alpha turn 8\nSpiderman - Other turn 3\nFrozen - Sample Gamma turn 1'},
 {...base,note:'Spiderman - Sample Alpha turn 8\nUnknown - Sample Beta turn 3\nFrozen - Sample Gamma turn 1'},
 {...base,note:'Spiderman - Sample Alpha turn 8\nFrozen - Sample Gamma turn 1'},
 {...base,existingWord:'Staff Approved Name'},
 {...base,context:{unavailable:true}},
 {...base,siblingTasks:base.siblingTasks.slice(0,2)},
 {...base,messages:[{text_content:'Tukar nama kepada Other'}]},
 {...base,items:[items[0],{...items[1],item_sku:'EI1002'},items[2]]},
 {...base,items:[items[0],{...items[1],provider_item_id:''},items[2]]},
 {...base,note:note.replace('Sample Alpha turn 8','tolong tukar warna merah')}
])assert.equal(api.labelledProductWordingRule(input).eligible,false,JSON.stringify(input));
assert.equal(api.labelledProductWordingRule({...base,existingWord:'',note:'CN1001: Sample Alpha turn 8\n3333333333: Sample Beta turn 3\nFrozen: Sample Gamma turn 1'}).eligible,true);
assert.equal(api.labelledProductWordingRule({...base,note:note.toLowerCase()}).eligible,true,'case-insensitive matching');
assert.equal(api.labelledProductWordingRule({...base,note:note.toLowerCase(),existingWord:note.toLowerCase()}).eligible,true);
assert.equal(api.targetProduct('CN1001',items).product_id,'1111111111');
assert.match(api.briefText('test','CN1001','Sample Alpha turn 8','','',false,true,95,note,[],api.targetProduct('CN1001',items)),/Product ID \(Shopee\): 1111111111/);

// Execute the actual AI request builder: title + product ID must reach Responses,
// including the exact target; model output remains advisory and SKU checked.
let aiPayload;
const ai=load(async(url,opts)=>{
 assert.equal(url,'https://api.openai.com/v1/responses');aiPayload=JSON.parse(opts.body);
 return Response.json({model:'test-model',output:[{content:[{type:'output_text',text:JSON.stringify({wording:'Sample Alpha turn 8',item_sku:'CN1001',confidence:95,needs_review:false})}]}]});
});
assert.equal((await ai.aiAnalyzeOrder({note,sku:'CN1001',items,messages:[],vision:false})).ok,true);
const input=JSON.parse(aiPayload.input[0].content[0].text);
assert.equal(input.target_product.title,items[0].title);
assert.equal(input.target_product.product_id,'1111111111');
assert.equal(input.order_items[2].title,items[2].title);
assert.equal(input.order_items[2].product_id,'3333333333');

// Run the actual worker handler against controlled provider/database transports.
// Verify persisted brief, exact CF updates, preserved comment and repeated-run
// idempotency; no title/ID is copied into printable Customize Name.
const taskId='synthetic-task',orderId='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
let stored={},comments=[],writes=0,posts=0,aiCalls=0,unpaid=false;
const task={id:taskId,list:{id:'18375902'},status:{status:'design editing -topper'},custom_fields:[
 {id:'sku',name:'SKU',value:'CN1001'},
 {id:'7c88d5cf-56e9-4108-86c5-b8e7baaf5bdc',name:'Customize Name',value:note},
 {id:'afa87c64-3e48-4056-b720-cf8ea9b243e8',name:'confirmed',value:false},
 {id:'01cec4ef-a30b-443d-a43a-9ab09835b78c',name:'Review customer',value:''}
]};
const transport=async(raw,opts={})=>{
 const url=new URL(raw),body=opts.body?JSON.parse(opts.body):{},method=opts.method||'GET';
 if(url.hostname==='api.openai.com'){aiCalls++;throw Error('deterministic match must not call AI');}
 if(url.hostname==='order.test'){
  const path=url.pathname;
  if(path.endsWith('/private_runtime_settings'))return Response.json([{setting_value:'test-worker'}]);
  if(path.endsWith('/clickup_order_brief_settings'))return Response.json([{enabled:true}]);
  if(path.endsWith('/ai_clickup_work_snapshots'))return Response.json(url.searchParams.get('select').includes('task_name')&&!url.searchParams.has('task_id')?base.siblingTasks:
   [{task_id:taskId,task_name:'1x CN1001',list_id:'18375902',marketplace_order_id:orderId,clickup_status:'design editing -topper',order_reference:'QA_ONLY'}]);
  if(path.endsWith('/task_detail_automation'))return Response.json([{data:{missing:[],info_status:'ready'}}]);
  if(path.endsWith('/marketplace_orders'))return Response.json([{buyer_message:note,placed_at:'2026-10-31T00:00:00Z',current_status:unpaid?'UNPAID':'READY_TO_SHIP'}]);
  if(path.endsWith('/marketplace_order_items')){assert.equal(url.searchParams.get('is_current'),'eq.true');assert.match(url.searchParams.get('select'),/title/);return Response.json(items);}
  if(path.endsWith('/icetak_record_order_brief')){stored=body;return Response.json({ok:true});}
 }
 if(url.hostname.endsWith('.supabase.co'))return Response.json({ok:true,matched:true,conversation_id:'chat',messages:[]});
 if(url.hostname==='api.clickup.com'){
  const path=url.pathname;
  if(path.endsWith('/task/'+taskId))return Response.json(task);
  if(path.endsWith('/task/'+taskId+'/comment')){
   if(method==='POST'){posts++;comments=[{id:'comment1',comment:[{text:body.comment_text}]}];return Response.json({id:'comment1'});}
   return Response.json({comments});
  }
  if(path.endsWith('/comment/comment1')&&method==='PUT'){comments=[{id:'comment1',comment:[{text:body.comment_text}]}];return Response.json({});}
  if(path.includes('/field/')){writes++;const f=task.custom_fields.find(x=>x.id===path.split('/').at(-1));assert(f);f.value=body.value;return Response.json({});}
 }
 throw Error('Unexpected request '+method+' '+url.origin+url.pathname);
};
const worker=load(transport);
const job={task_id:taskId,source_fingerprint:'synthetic-fingerprint',state:'processing'};
const result=await worker.process(job,'test-clickup','test-bridge');
assert.equal(result.state,'completed',JSON.stringify(result));
assert.equal(stored.p_brief.wording,'Sample Alpha turn 8');
assert.equal(stored.p_brief.confidence,95);
assert.equal(stored.p_brief.confirmed,true);
assert.equal(stored.p_brief.product_id,'1111111111');
assert.equal(stored.p_brief.product_title,items[0].title);
assert.equal(task.custom_fields[1].value,'Sample Alpha turn 8');
assert.equal(task.custom_fields[2].value,true);
assert.equal(posts,1);assert.equal(aiCalls,0);
const initialWrites=writes;
await worker.process({...job,brief:stored.p_brief,comment_id:'comment1',field_receipts:stored.p_brief.field_receipts},'test-clickup','test-bridge');
assert.equal(posts,1);assert.equal(writes,initialWrites,'replay must not repeat field updates');
assert.equal(comments.length,1);
assert.match(comments[0].comment[0].text,/Tajuk product: CUSTOM NAME Spiderman/);
assert.match(comments[0].comment[0].text,/Product ID \(Shopee\): 1111111111/);
unpaid=true;task.custom_fields[2].value=false;
await worker.process({...job,brief:{}},'test-clickup','test-bridge');
assert.equal(stored.p_brief.confirmed,false,'unpaid must never auto-confirm');
assert.equal(writes,initialWrites);
const beforeDenied=writes;
assert.equal((await handler(new Request('https://worker.test',{method:'POST',headers:{'x-order-brief-token':'wrong'},body:'{}'}))).status,401);
assert.equal(writes,beforeDenied);
const self=await (await handler(new Request('https://worker.test',{method:'POST',headers:{'x-order-brief-token':'test-worker'},body:JSON.stringify({action:'selftest'})}))).json();
assert.equal(self.ok,true,JSON.stringify(self));
console.log('PASS AutoBrief: unique title/SKU/product-ID mapping; shuffled items; duplicate/missing/conflicting labels; staff/chat/context/unpaid guards; actual AI payload; worker CF/comment/persistence and replay; auth; existing selftests.');
