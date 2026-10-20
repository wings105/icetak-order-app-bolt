import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {taskReadiness} from '../supabase/functions/task-workspace/readiness.ts';
import {observe,applyObservation} from '../supabase/functions/task-workspace/automation.ts';
const source={task_id:'task-cat',title:'1x CN0685',status:'design editing -topper',fields:{sku:'CN0685'},files:[],mapping_status:'exact_reference'};
const order={created_at:'2026-10-20T01:00:00Z',items:[{sku:'CN0685',title:'[CUSTOM NAME] Happy Birthday Cake Topper Cat Kucing'},{sku:'CN0721',title:'[CUSTOM NAME] Happy Birthday Cake Topper Messi Argentina'}],production_tasks:[{id:'task-cat',detail:{sku:'CN0685'}},{id:'task-messi',detail:{sku:'CN0721'}}],order_note:'Topper Cat : \\"QA CAT TURNS 5\\"\\nTopper Messi : \\"QA MESSI TURNS 8\\"'};
const cat=await taskReadiness(source,order,{});assert.equal(cat.status,'ready');assert.equal(cat.values.wording,'QA CAT TURNS 5');
const messi=await taskReadiness({...source,task_id:'task-messi',title:'1x CN0721',fields:{sku:'CN0721'}},order,{});assert.equal(messi.status,'ready');assert.equal(messi.values.wording,'QA MESSI TURNS 8');
const copied=await taskReadiness({...source,fields:{...source.fields,'customize name':order.order_note}},order,{});assert.equal(copied.values.wording,'QA CAT TURNS 5');assert.equal(copied.status,'ready');
const repeated=await taskReadiness({...source,task_id:'task-messi',title:'1x CN0721',fields:{sku:'CN0721','customize name':'wording: QA CAT TURNS 5\nwording: QA MESSI TURNS 8'}},order,{});assert.equal(repeated.values.wording,'QA MESSI TURNS 8');assert.equal(repeated.status,'ready');
const noLabel=await taskReadiness(source,{...order,order_note:'Aina'},{});assert.notEqual(noLabel.status,'ready');
const one={...order,items:[order.items[0]],production_tasks:[order.production_tasks[0]],order_note:'Nama: QA CAT'};
const ctx=messages=>({bindings:[{id:'chat',usable:true,start_at:'2026-10-19T00:00:00Z',revision:String(messages.length)}],messages:messages.map((m,i)=>({id:'m'+i,conversation_id:'chat',direction:'inbound',message_type:'text',created_at:'2026-10-20T01:05:00Z',...m}))});
const load=async(context={},note=one.order_note,saved=null)=>{const o={...one,order_note:note};return {source,order:o,context,saved,readiness:await taskReadiness(source,o,context,saved)};};
const initial=await load(ctx([]));const first=await observe(initial,null,'2026-10-20T01:01:00Z');assert.equal(first.status,'ready');assert.equal(first.attention,'none');assert.match(first.remark,/QA CAT/);
const initialRecord={version:1,data:first};
const question=await load(ctx([{text_content:'Bila pos ya?'}]));assert.equal(question.readiness.fingerprint,initial.readiness.fingerprint,'general question preserves design approval fingerprint');
const q=await observe(question,initialRecord,'2026-10-20T01:06:00Z');assert.equal(q.status,'ready');assert.equal(q.attention,'question');assert.match(q.remark,/soalan/);assert.equal(q.alerts.length,1);
const duplicate=await observe(question,{version:2,data:q},'2026-10-20T01:07:00Z');assert.equal(duplicate.alerts.length,1,'same message cannot duplicate an alert');
const ack=await observe(await load(ctx([{text_content:'Terima kasih'}])),initialRecord,'2026-10-20T01:06:00Z');assert.equal(ack.attention,'none');
const corrected=await load(ctx([{text_content:'Tukar wording kepada QA CAT UPDATED TURNS 5'}]));const change=await observe(corrected,initialRecord,'2026-10-20T01:06:00Z');assert.equal(change.status,'review');assert.equal(change.attention,'change');assert.equal(change.previous_values.wording,'QA CAT');assert.equal(corrected.readiness.values.wording,'QA CAT UPDATED TURNS 5');
const blocked=applyObservation(corrected.readiness,{data:change,version:2});assert.equal(blocked.status,'review');assert.equal(blocked.print_ready,false);
const sticky=await observe(corrected,{version:2,data:change},'2026-10-20T01:07:00Z');assert.equal(sticky.attention,'change');
const approved={version:1,data:corrected.readiness.form,source_fingerprint:corrected.readiness.fingerprint,confirmed:true,updated_by:'admin1',updated_at:'2026-10-20T01:08:00Z'};
const checked=await load(corrected.context,one.order_note,approved);const cleared=await observe(checked,{version:2,data:change},'2026-10-20T01:09:00Z');assert.equal(cleared.attention,'none');assert.equal(cleared.ready_values.wording,'QA CAT UPDATED TURNS 5');
const nextQuestionContext={...corrected.context,messages:[...corrected.context.messages,{id:'after-admin',conversation_id:'chat',direction:'inbound',message_type:'text',text_content:'Bila pos?',created_at:'2026-10-20T01:10:00Z'}]};
const nextQuestion=await observe(await load(nextQuestionContext,one.order_note,approved),{data:cleared},'2026-10-20T01:11:00Z');assert.equal(nextQuestion.attention,'question','a previous admin approval must not swallow future questions');
const missing=await load({},'');const missingAt=await observe(missing,null,'2026-10-20T01:01:00Z');assert.equal(missingAt.recheck_due_at,'2026-10-20T01:30:00.000Z');assert.equal(missingAt.rechecked_at,null);
const before=await observe(missing,{data:missingAt},'2026-10-20T01:29:00Z');assert.equal(before.rechecked_at,null);
const after=await observe(missing,{data:missingAt},'2026-10-20T01:30:00Z');assert.equal(after.rechecked_at,'2026-10-20T01:30:00Z');
const late=await observe(await load(ctx([{text_content:'Aina 7 tahun'}]),''),{data:missingAt},'2026-10-20T01:20:00Z');assert.equal(late.status,'ready');assert.equal(late.attention,'none');
const lateAgain=await observe(await load(ctx([{text_content:'Aina 7 tahun'}]),''),{data:late},'2026-10-20T01:21:00Z');assert.equal(lateAgain.attention,'none');assert.equal(lateAgain.status,'ready');assert.deepEqual(lateAgain.ready_values,late.values);
const repaired=await observe(initial,{data:{...first,ready_values:{},attention:'change',alerts:[]}},'2026-10-20T01:21:00Z');assert.equal(repaired.attention,'none');assert.deepEqual(repaired.ready_values,initial.readiness.values);
const printing={...corrected,source:{...source,status:'cake topper - printing'}};assert.match((await observe(printing,initialRecord,'2026-10-20T01:06:00Z')).remark,/selepas kerja production bermula/);
// Execute the actual worker boundary: token auth, exclusive claim, persisted result and retry health.
let handler,records=0,finishes=0,busy=false;
const code=readFileSync('supabase/functions/task-detail-worker/index.ts','utf8').replace(/^import .*;\n/gm,'');
const fetcher=async(url,opt={})=>{
 if(url.includes('/private_runtime_settings?'))return Response.json([{setting_value:'worker-secret'}]);
 if(url.endsWith('/icetak_task_detail_intake_pending'))return Response.json([]);
 if(url.endsWith('/icetak_task_detail_begin'))return Response.json(busy?{busy:true}:{run_id:'run',tasks:[{task_id:'task-cat'}]});
 if(url.endsWith('/icetak_task_detail_record')){records++;assert.equal(JSON.parse(opt.body).p_data.status,'ready');return Response.json({changed:true});}
 if(url.endsWith('/icetak_task_detail_finish')){finishes++;return Response.json(null);}
 throw Error('Unexpected worker path');
};
await new Function('Deno','fetch','loadReadiness',`return (async()=>{${stripTypeScriptTypes(code)}})()` )({env:{get:k=>k==='SUPABASE_URL'?'https://order.test':'service-secret'},serve:fn=>handler=fn},fetcher,async()=>({'task-cat':{...initial,observation:first,automation_version:0,source:{source_token:'token'}}}));
const run=token=>handler(new Request('https://worker.test',{method:'POST',headers:{'x-task-detail-token':token},body:'{}'}));
assert.equal((await run('invalid')).status,401);assert.equal(records,0);const result=await (await run('worker-secret')).json();assert.equal(result.saved,1);assert.equal(records,1);assert.equal(finishes,1);busy=true;assert.equal((await (await run('worker-secret')).json()).busy,true);assert.equal(records,1);
console.log('PASS detail automation: exact multi-item note, first read, late details, 30-minute timer, question/ack/correction, sticky admin review/ack, production change, worker auth/lease/persistence.');
// The first order can be assessed without a ClickUp task, then inherits into its exact SKU task.
const {loadReadiness}=await import('../supabase/functions/task-workspace/sources.ts');
const savedFetch=globalThis.fetch,orderId='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
let inherited=false,intakeBaseline=null;
globalThis.fetch=async()=>Response.json({ok:true,contexts:{['shopee:'+orderId]:{bindings:[],messages:[]}}});
const intakeOrder={...order,id:orderId,kind:'shopee',reference:'QA-INTAKE',production_tasks:[]};
const intakeRpc=async(name)=>{
 if(name==='icetak_task_readiness_sources')return inherited?{sources:{'task-cat':source},intakes:{['shopee:'+orderId]:{data:{items:[{sku:'CN0685',observation:intakeBaseline}]}}}}:{sources:{}};
 if(name==='icetak_customer_focus_orders')return {orders:[intakeOrder],states:{}};
 if(name==='icetak_order_detail_sources')return {tasks:{},links:{}};
 throw Error('Unexpected intake RPC '+name);
};
try{
 const early=await loadReadiness([{task_id:'intake-'+orderId+'-0',virtual:true,item_index:0,marketplace_order_id:orderId}],intakeRpc,async()=>[{setting_value:'qa-private-bridge'}]);
 assert.equal(early['intake-'+orderId+'-0'].raw_readiness.status,'ready');assert.equal(early['intake-'+orderId+'-0'].raw_readiness.values.wording,'QA CAT TURNS 5');
 intakeBaseline=early['intake-'+orderId+'-0'].observation;inherited=true;
 const later=await loadReadiness([{task_id:'task-cat',marketplace_order_id:orderId}],intakeRpc,async()=>[{setting_value:'qa-private-bridge'}]);
 assert(later['task-cat'].observation.ready_at,'task inherits first order readiness baseline');assert.equal(later['task-cat'].observation.attention,'none');assert.equal(later['task-cat'].readiness.status,'ready');
}finally{globalThis.fetch=savedFetch;}
console.log('PASS initial order intake before ClickUp task and exact-SKU handoff.');
