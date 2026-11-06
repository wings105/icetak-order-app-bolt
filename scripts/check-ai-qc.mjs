import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {verdict,sourceGuard} from '../supabase/functions/ai-qc/core.js';
const expected={name:'AINA TEST',age:'6',suffix:'TAHUN',prefix:''};
const good={customer_matches:true,layout_ok:true,text_readable:true,no_extra_text:true,issues:[],observed:Object.entries(expected).map(([field,text])=>({field,text}))};
assert.equal(verdict(good,expected).state,'PASS');
for(const key of Object.keys(expected)){const bad=structuredClone(good);bad.observed.find(v=>v.field===key).text='WRONG';assert.equal(verdict(bad,expected).state,'FAIL');}
for(const flag of ['layout_ok','text_readable','no_extra_text','customer_matches'])assert.notEqual(verdict({...good,[flag]:false},expected).state,'PASS');
assert.equal(verdict({...good,observed:[...good.observed,good.observed[0]]},expected).state,'FAIL');
assert.notEqual(verdict({...good,issues:['uncertain']},expected).state,'PASS');
const task={id:'test',list:{id:'18375902'},status:{status:'design editing -topper'},custom_fields:[{name:'paid',value:true},{name:'confirmed',value:true},{name:'SKU',value:'YS0312'},{name:'ORDER ID / customer name',value:'ORDER'},{name:'Customize Name',value:'AINA TEST 6 TAHUN'}],attachments:[{id:'output',url:'https://test.clickup-attachments.com/output.png'}]};
const config={width:100,height:100,layers:Object.keys(expected).map(field=>({id:field,field})),automation:{enabled:true,inputs:{name:{source:'name',required:true,default:''},age:{source:'age_number',required:false,default:''},suffix:{source:'age_suffix',required:false,default:''},prefix:{source:'age_prefix',required:false,default:''}}}};
const job={task_id:'test',order_reference:'ORDER',state:'completed',source_hash:'source',filename:'output.png',attachment_id:'output',template_version:5,fields:expected,brief:{sku:'YS0312',confirmed:true,wording:'AINA TEST 6 TAHUN'}};
const current={job,brief:{state:'completed',brief:job.brief},template:{version:5,image_path:'YS0312/images/raw.png',config},valid:true};
assert.equal(sourceGuard(job,job,current.brief,current.template),true);
assert.equal(sourceGuard(job,job,current.brief,{version:6}),false);
const testFile=new URL('../supabase/functions/ai-qc/.qc-test.ts',import.meta.url);
let source=await readFile(new URL('../supabase/functions/ai-qc/index.ts',import.meta.url),'utf8');
source=source.replace("import 'jsr:@supabase/functions-js/edge-runtime.d.ts';",'').replace(/import \{loadReadiness\}[^;]+;/,'const loadReadiness=globalThis.qcReadiness;').replace(/import \{taskReadiness\}[^;]+;/,'const taskReadiness=globalThis.qcTaskReadiness;');
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'secret',OPENAI_API_KEY:'test-key'})[k]},serve:()=>{}};
let currentMode='',fileRegistered=false,briefConfirmed=false;
globalThis.qcTaskReadiness=async()=>({can_confirm:true});
globalThis.qcReadiness=async()=>({test:{readiness:{can_confirm:true,print_ready:briefConfirmed,version:0,form:{values:{wording:job.brief.wording}},fingerprint:(fileRegistered?'b':'a').repeat(64),evidence:[]},source:{source_token:'source',files:fileRegistered?[{id:'file-id',storage_path:'test/ai-qc-'+('c'.repeat(64))+'.png'}]:[]},order:{order_note:currentMode==='missing_evidence'?'':job.brief.wording},context:{messages:[]}}});
await writeFile(testFile,source);let inspect,release;try{({inspect,release}=await import(testFile.href));}finally{await unlink(testFile);}
for(const mode of ['pass','wrong_text','stale','provider_error','missing_evidence']){
 currentMode=mode;let readCount=0,providerCalls=0;
 globalThis.qcReadiness=globalThis.qcReadiness;
 globalThis.fetch=async(url,opt={})=>{
  url=String(url);
  if(url.includes('icetak_ai_qc_source')){readCount++;return Response.json(mode==='stale'&&readCount>1?{...current,valid:false}:current);}
  if(url.includes('icetak_task_workspace_read'))return Response.json({items:[{task_id:'test'}]});
  if(url.includes('api.clickup.com'))return Response.json(task);
  if(url.includes('test.clickup-attachments.com')){const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);new DataView(bytes.buffer).setUint32(16,100);new DataView(bytes.buffer).setUint32(20,100);return new Response(bytes);}
  if(url.includes('api.openai.com')){providerCalls++;const input=JSON.parse(opt.body);assert.equal(input.store,false);assert.equal(input.text.format.strict,true);assert.equal(input.input[0].content.filter(c=>c.type==='input_image').length,2);if(mode==='provider_error')return Response.json({}, {status:503});const result=structuredClone(good);if(mode==='wrong_text')result.observed[0].text='WRONG';return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]});}
  throw Error('unexpected '+url);
 };
 if(mode==='provider_error')await assert.rejects(()=>inspect(job,'token'),/VISION_HTTP_503/);
 else{const out=await inspect(job,'token');assert.equal(out.state,mode==='pass'?'PASS':['stale','missing_evidence'].includes(mode)?'HOLD':'FAIL');assert.equal(providerCalls,mode==='missing_evidence'?0:1);}
}
console.log('PASS: exact visible text/blank labels, conservative decision, source invalidation, actual vision worker request/response and provider failure');

let receipt=null,uploads=0,handovers=0;
globalThis.fetch=async(url,opt={})=>{
 url=String(url);const data=opt.body&&typeof opt.body==='string'?JSON.parse(opt.body):{};
 if(url.includes('/admin_users?'))return Response.json([{username:'owner-test'}]);
 if(url.includes('icetak_ai_qc_source'))return Response.json(current);
 if(url.includes('/task_workspace_events?'))return Response.json(receipt?[receipt]:[]);
 if(url.includes('/storage/v1/object/')){uploads++;return Response.json({});}
 if(url.includes('icetak_task_workspace_read'))return Response.json({items:[{task_id:'test',version:0,source_updated_at:'2026-11-06T00:00:00Z'}]});
 if(url.includes('icetak_task_workspace_save')){if(data.p_patch.file)fileRegistered=true;else {handovers++;receipt={task_id:'test',payload:data.p_patch,result:{ok:true}};}return Response.json({ok:true});}
 if(url.includes('icetak_task_brief_save')){briefConfirmed=true;return Response.json({ok:true});}
 throw Error('Unexpected release URL '+url);
};
const approval={source_fingerprint:'a'.repeat(64),output_sha:'c'.repeat(64),bytes:new Uint8Array(24)};
const first=await release({id:'run'},job,approval);assert.equal(first.stage,'cake topper - printing');assert.equal(handovers,1);assert.equal(uploads,1);
const second=await release({id:'run'},job,approval);assert.equal(second.reconciled,true);assert.equal(handovers,1);assert.equal(uploads,1);
console.log('PASS: actual native release registers immutable file, confirms current brief, checks native print readiness, hands off once and reconciles receipt');
