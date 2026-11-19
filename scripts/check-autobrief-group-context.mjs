import assert from 'node:assert/strict';
import {resolveOrderGroup,validateGroupSelection} from '../supabase/functions/clickup-order-brief/group-context.ts';
const orders=[
 {order_no:'261119ABCDEFGH',placed_at:'2026-11-19T02:00:00Z',items:[{title:'Spiderman glossy CN0081'},{title:'Edible Image',size:'5 inch'}]},
 {order_no:'261119HIJKLMNO',placed_at:'2026-11-19T02:02:00Z',items:[{title:'Acrylic A6 Gold'}]}
];
const tasks=[
 {task_id:'glossy',order_reference:orders[0].order_no,task_name:'CN0081',clickup_status:'design editing -topper'},
 {task_id:'edible',order_reference:orders[0].order_no,task_name:'Edible 5 inch',clickup_status:'design edible image'},
 {task_id:'acrylic',order_reference:orders[1].order_no,task_name:'Acrylic A6 Gold',clickup_status:'acrylic'}
];
const messages=[
 {id:'buyer1',direction:'inbound',text_content:'Spiderman Ali 4 tahun. Acrylic Sarah & Adam.',message_type:'text'},
 {id:'seller1',direction:'outbound',text_content:'Gambar ini untuk edible 5 inch?',message_type:'text'},
 {id:'buyer2',direction:'inbound',text_content:'Ya',message_type:'text'},
 {id:'asset1',direction:'inbound',text_content:'',caption:'Edible 5 inch',message_type:'image',media_url:'https://asset.test/edible.png'}
];
let modelCalls=0,failed=false;
const outputs={
 glossy:{task_id:'glossy',confidence:97,needs_review:false,reason:'Spiderman label',messages:[{id:'buyer1',text:'Ali 4 tahun',media:false}],note_spans:[]},
 acrylic:{task_id:'acrylic',confidence:96,needs_review:false,reason:'Acrylic label',messages:[{id:'buyer1',text:'Sarah & Adam',media:false}],note_spans:[]},
 edible:{task_id:'edible',confidence:95,needs_review:false,reason:'Edible size and buyer reply',messages:[{id:'seller1',text:'Gambar ini untuk edible 5 inch?',media:false},{id:'buyer2',text:'Ya',media:false},{id:'asset1',text:'Edible 5 inch',media:true}],note_spans:[],print:{mode:'PRINT_AS_IS',wording:'',print_size:'5 inch',missing:[],asset_ids:['asset1']}}
};
globalThis.Deno={env:{get:key=>key==='OPENAI_API_KEY'?'synthetic':undefined}};
globalThis.fetch=async(url,options={})=>{
 const body=JSON.parse(options.body);
 if(String(url).includes('/task-brief-media')){
  assert.equal(body.action,'group_context');
  return Response.json({ok:true,available:true,order_no:body.order_no,orders,messages,truncated:false});
 }
 assert.equal(String(url),'https://api.openai.com/v1/responses');
 modelCalls++;
 if(failed)return Response.json({error:'test'},{status:503});
 const data=JSON.parse(body.input[0].content[0].text);
 assert.equal(data.orders.length,2);assert.equal(data.tasks.length,3);assert.equal(data.messages.length,4);
 const output=outputs[data.target.task_id];
 return Response.json({model:'test',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
};
const deps={inbox:'https://inbox.test',digest:async value=>value,db:async path=>{
 if(path.startsWith('ai_clickup_work_snapshots?'))return tasks;
 if(path.startsWith('marketplace_orders?'))return [];
 throw Error('Unexpected DB path '+path);
},safeDownload:async()=>({mime:'image/png',bytes:new Uint8Array([137,80,78,71])})};
for(const task of tasks){
 const input={task_id:task.task_id,profile:task.task_id,scope:{order_no:task.order_reference,note:'',target:{title:task.task_name}},context:{ambiguous:true,messages:[]},previous:{}};
 const result=await resolveOrderGroup(input,'test',deps);
 assert.equal(result.analysis.ok,true,JSON.stringify(result));assert.equal(result.context.ambiguous,false);
 if(task.task_id==='glossy')assert.equal(result.context.messages[0].text_content,'Ali 4 tahun');
 if(task.task_id==='acrylic')assert.equal(result.context.messages[0].text_content,'Sarah & Adam');
 if(task.task_id==='edible')assert.equal(result.context.messages.find(m=>m.id==='asset1').media_url,messages[3].media_url);
 const before=modelCalls;
 const replay=await resolveOrderGroup({...input,previous:{group_assignment:result.analysis}},'test',deps);
 assert.equal(replay.analysis.ok,true);assert.equal(modelCalls,before);
}
assert.throws(()=>validateGroupSelection({...outputs.glossy,task_id:'other'},'glossy',messages,''));
assert.throws(()=>validateGroupSelection({...outputs.glossy,messages:[{id:'foreign',text:'Ali 4 tahun'}]},'glossy',messages,''));
assert.throws(()=>validateGroupSelection({...outputs.glossy,messages:[{id:'buyer1',text:'Ali 5 tahun'}]},'glossy',messages,''));
assert.throws(()=>validateGroupSelection({...outputs.glossy,note_spans:['Invented name']},'glossy',messages,'Ali'));
assert.throws(()=>validateGroupSelection({...outputs.glossy,messages:[{id:'seller1',text:'',media:true}]},'glossy',messages,''));
failed=true;
const result=await resolveOrderGroup({task_id:'glossy',profile:'glossy',scope:{order_no:orders[0].order_no,note:''},context:{ambiguous:true,messages:[]}},'test',deps);
assert.equal(result.analysis.ok,false);assert.equal(result.context.ambiguous,true);
console.log('PASS mixed-order category mapping, quoted evidence, selected artwork, cache reuse and provider failure hold');

// Category workers consume the mapped context through their normal preview entry points.
const {processPrint}=await import('../supabase/functions/clickup-order-brief/print-brief.ts');
const {processAcrylic}=await import('../supabase/functions/clickup-order-brief/acrylic.ts');
const media={...messages[3],id:'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',channel:'shopee',created_at:'2026-11-19T02:05:00Z'};
const snapshot={task_id:'edible',marketplace_order_id:'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',order_reference:orders[0].order_no,list_id:'18375902',clickup_status:'design edible image'};
const task={id:'edible',list:{id:'18375902'},status:{status:'design edible image'},custom_fields:[{name:'SKU',value:'5 inch'},{name:'ORDER ID / customer name',value:orders[0].order_no}],attachments:[]};
const groupPrint={...outputs.edible,ok:true,print:{...outputs.edible.print,asset_ids:[media.id],instruction:'',review_requested:false}};
const printDeps={...deps,clock:value=>value,rich:value=>[{text:value}],allowedHost:()=>true,summarize:async()=>({}),clickup:async()=>task,
 db:async path=>{
  if(path.startsWith('marketplace_orders?id='))return [{id:snapshot.marketplace_order_id,provider:'shopee',current_status:'READY_TO_SHIP',order_sn:orders[0].order_no,placed_at:orders[0].placed_at,detail_complete:true}];
  if(path.startsWith('marketplace_order_items?'))return [{line_no:1,title:'Edible Image print only',variation_name:'5 inch',quantity:1,provider_item_id:'123'}];
  if(path.startsWith('rpc/icetak_print_previous_whatsapp_close'))return null;
  throw Error('Unexpected print DB '+path);
 },resolveGroup:async()=>({grouped:true,note:'',analysis:groupPrint,context:{ambiguous:false,messages:[media],channels:{shopee:'openai_group'}}})};
globalThis.fetch=async()=>Response.json({ok:true,context:{order_id:snapshot.marketplace_order_id,ambiguous:true,messages:[]}});
const printResult=await processPrint({task_id:'edible'},snapshot,{profile:'edible',initial_status:'design edible image'},'test','test',printDeps,true);
assert.equal(printResult.brief.status,'BRIEF_READY',JSON.stringify(printResult));
assert.equal(printResult.receipts[0].message_id,media.id);
assert.equal(printResult.brief.decision_engine,'openai_group');

const acrylicScope={eligible:true,provider:'shopee',order_id:'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa',order_no:orders[1].order_no,placed_at:orders[1].placed_at,note:'',items:[{kind:'acrylic'},{kind:'edible'}],target_item_id:'item-acrylic',
 target:{title:'Acrylic Gold A6',material:'acrylic',quantity:1,colour:'Gold',size:'A6'}};
const acrylicTask={id:'acrylic',list:{id:'18375902'},status:{status:'acrylic'},custom_fields:[],attachments:[]};
const acrylicMessage={...messages[0],created_at:'2026-11-19T02:05:00Z',text_content:'Sarah & Adam',channel:'shopee'};
const acrylicDeps={...printDeps,clickup:async()=>acrylicTask,db:async path=>{
 if(path.startsWith('clickup_autobrief_routes?'))return [{profile:'acrylic',task_created_at:'2026-11-19T00:00:00Z'}];
 if(path==='rpc/icetak_acrylic_brief_scope')return structuredClone(acrylicScope);
 if(path.startsWith('task_detail_automation?'))return [{data:{}}];
 throw Error('Unexpected acrylic DB '+path);
},resolveGroup:async()=>({grouped:true,note:'',analysis:{...outputs.acrylic,ok:true},context:{messages:[acrylicMessage],ambiguous:false}})};
globalThis.fetch=async(url,options)=>{
 if(String(url).includes('task-brief-media'))return Response.json({ok:true,context:{order_id:acrylicScope.order_id,messages:[],ambiguous:true}});
 return Response.json({model:'test',output:[{content:[{type:'output_text',text:JSON.stringify({artwork_kind:'none',units:[{wording:'Sarah & Adam',evidence_ids:[acrylicMessage.id]}],instruction:'',image_description:'',needs_review:false,confidence:96,reason:'Exact acrylic assignment',evidence_ids:[acrylicMessage.id]})}]}]});
};
const acrylicResult=await processAcrylic({task_id:'acrylic'},'test','test',acrylicDeps,true);
assert.equal(acrylicResult.brief.wording,'Sarah & Adam',JSON.stringify(acrylicResult));
assert.equal(acrylicResult.brief.confirmed,true,JSON.stringify(acrylicResult));
assert.equal(acrylicResult.brief.decision_engine,'openai');
console.log('PASS edible and acrylic category previews after mixed-group assignment');

// The production print entry point replaces only an owned checkout copy.
const writeTask=structuredClone(task);
writeTask.custom_fields.push(
 {id:'word',name:'Customize Name',value:'Wording: Lily'},
 {id:'confirmed',name:'confirmed',value:false},
 {id:'review',name:'Review customer',value:'',type_config:{options:[{id:'d84d57b3-41f3-473d-b502-4e7bf45ace0c',name:'Ai Check'}]}}
);
let savedPrint;
const writeDeps={...printDeps,db:async(path,body)=>{
 if(path==='rpc/icetak_record_order_brief'){savedPrint=body;return {ok:true};}
 const value=await printDeps.db(path,body);
 if(path.startsWith('marketplace_orders?id='))value[0].buyer_message='Wording: Lily';
 return value;
},resolveGroup:async()=>({grouped:true,note:'Lily',analysis:{...groupPrint,print:{...groupPrint.print,wording:'Lily'}},context:{ambiguous:false,messages:[media],channels:{shopee:'openai_group'}}}),
 clickup:async(_token,path,method='GET',body)=>{
  if(path.includes('/field/')){writeTask.custom_fields.find(f=>f.id===path.split('/').at(-1)).value=body.value;return {};}
  if(path.endsWith('/attachment')){writeTask.attachments=[{id:'attached',title:'icetak-proof-edible-'+media.id+'.png',url:'https://asset.test/attached.png'}];return {id:'attached'};}
  if(path.endsWith('/comment'))return method==='POST'?{id:'brief-comment'}:{comments:[]};
  return writeTask;
 }};
globalThis.fetch=async()=>Response.json({ok:true,context:{order_id:snapshot.marketplace_order_id,ambiguous:true,messages:[]}});
const written=await processPrint({task_id:'edible',lease_until:new Date(Date.now()+120000).toISOString()},snapshot,{profile:'edible',initial_status:'design edible image'},'test','test',writeDeps);
assert.equal(written.state,'completed',JSON.stringify(written));
assert.equal(writeTask.custom_fields.find(f=>f.id==='word').value,'Lily');
assert.equal(writeTask.custom_fields.find(f=>f.id==='confirmed').value,true);
assert.equal(savedPrint.p_brief.group_assignment.ok,true);
console.log('PASS print category attachment, checkout copy replacement and confirmation writeback');
