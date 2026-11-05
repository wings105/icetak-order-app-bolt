import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {mapFields,taskEligible,parseDetail} from '../supabase/functions/autobrief-render/mapping.js';
import {resolveValues,validatePatterns} from '../public/render-test/fields.js';
const config={width:100,height:100,layers:[{field:'greeting',label:'Ucapan'},{field:'name',label:'Nama'}],automation:{enabled:true,inputs:{greeting:{source:'greeting',required:true,default:'HAPPY BIRTHDAY'},name:{source:'name_age',required:true,default:''}}}};
const template={sku:'QA',version:1,config};
const brief={sku:'QA',wording:'Name: Ahmad\nUmur: 6 tahun',confidence:95,confirmed:true,media_count:0,pending_change_ids:[]};
assert.deepEqual(mapFields(template,brief,brief.wording).fields,{greeting:'HAPPY BIRTHDAY',name:'Ahmad 6 tahun'});
assert.equal(mapFields(template,brief,'Nama: Ahmad').fields.name,'Ahmad');
assert.equal(mapFields(template,brief,'Umur: 6 tahun').reason,'MISSING_NAME');
assert.deepEqual(mapFields(template,brief,'Ucapan: Selamat Hari Lahir\nNama: Ahmad\nUmur: Yang Ke-6 Tahun').fields,{greeting:'Selamat Hari Lahir',name:'Ahmad Yang Ke-6 Tahun'});
assert.deepEqual(mapFields(template,brief,'Selamat Hari Lahir\nAhmad Yang Ke-6 Tahun').fields,{greeting:'Selamat Hari Lahir',name:'Ahmad Yang Ke-6 Tahun'});
assert.equal(mapFields(template,brief,'Selamat Hari Lahir\nAhmad\n6 Tahun').ok,false);
assert.equal(mapFields(template,brief,'tukar kepada Ahmad').ok,false);
assert.equal(mapFields(template,brief,'Nama: Ahmad Nama: Ali').ok,false);
assert.equal(mapFields(template,{...brief,instruction:'tambah gambar'},brief.wording).ok,false);
assert.equal(mapFields(template,{...brief,pending_change_ids:['new']},brief.wording).ok,false);
assert.equal(mapFields({...template,config:{...config,automation:undefined}},brief,brief.wording).ok,false);
const optional={...config,layers:[{field:'name',label:'Nama'},{field:'age',label:'Umur'}],automation:{enabled:true,inputs:{name:{source:'name',required:true,default:''},age:{source:'age',required:false,default:''}}}};
assert.deepEqual(mapFields({...template,config:optional},brief,'Nama: Ahmad').fields,{name:'Ahmad',age:''});
assert.doesNotThrow(()=>resolveValues(optional,{name:'Ahmad',age:''},{required:true,strict:true}));
assert.throws(()=>resolveValues(optional,{name:'',age:'6'},{required:true,strict:true}));
assert.throws(()=>validatePatterns({...optional,automation:{enabled:true,inputs:{...optional.automation.inputs,other:{source:'name',required:false,default:''}}}}));
assert.equal(parseDetail('Age: 6 years old\nName: Jo').age,'6 years old');
const patterned={...config,layers:[{field:'name',label:'Wording',pattern:'{{name}} turns {{age}}'}],automation:{enabled:true,inputs:optional.automation.inputs}};
assert.equal(mapFields({...template,config:patterned},brief,brief.wording).reason,'PATTERN_WORDING_REQUIRES_REVIEW');
const task={id:'qa',list:{id:'18375902'},status:{status:'design editing -topper'},custom_fields:[{name:'paid',value:true},{name:'confirmed',value:true},{name:'SKU',value:'QA'},{name:'ORDER ID / customer name',value:'qa-order'},{name:'Customize Name',value:brief.wording}],attachments:[]};
const job={task_id:'qa',order_reference:'qa-order',source_hash:'source',brief,lease_token:'lease'};
assert.equal(taskEligible(task,job).ok,true);
assert.equal(taskEligible({...task,status:{status:'printing'}},job).ok,false);
assert.equal(taskEligible({...task,custom_fields:task.custom_fields.map(f=>f.name==='Customize Name'?{...f,value:'different'}:f)},job).ok,false);

// Exercise the actual worker with controlled transports: signed render, receipt readback,
// retry reconciliation, source changes and unknown upload outcomes.
const file=new URL('../supabase/functions/autobrief-render/index.ts',import.meta.url);
const testFile=new URL('../supabase/functions/autobrief-render/.worker-test.ts',import.meta.url);
await writeFile(testFile,(await readFile(file,'utf8')).replace("import 'jsr:@supabase/functions-js/edge-runtime.d.ts';",''));
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'qa-secret'})[k]},serve:()=>{}};
let process;
try{({process}=await import(pathToFileURL(testFile.pathname)));}finally{await unlink(testFile);}
async function run({uncertain=false,existing=false,stale=false}={}){
 const calls=[],patches=[];let attached=existing;
 globalThis.fetch=async(url,opt={})=>{
  url=String(url);calls.push({url,method:opt.method||'GET'});
  const json=(x,status=200)=>Response.json(x,{status});
  if(url.includes('icetak_render_auto_record')){patches.push(JSON.parse(opt.body).p_patch);return json(true);}
  if(url.includes('icetak_render_auto_source'))return json(!stale);
  if(url.includes('/rest/v1/render_templates'))return json([template]);
  if(url.includes('/render-test/output.png')){
   const p=JSON.parse(opt.body);assert.equal(p.fields.name,'Ahmad 6 tahun');assert.ok(p.sig);assert.equal(p.version,1);
   const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10]);new DataView(png.buffer).setUint32(16,100);new DataView(png.buffer).setUint32(20,100);
   return new Response(png,{headers:{'content-type':'image/png'}});
  }
  if(url.endsWith('/attachment')){if(uncertain)throw Error('network interrupted');attached=true;return json({id:'attachment-qa',url:'https://attachment.test/output.png'});}
  if(url.includes('api.clickup.com'))return json({...task,attachments:attached?[{id:'attachment-qa',title:patches.find(p=>p.filename)?.filename||'existing.png',url:'https://attachment.test/output.png'}]:[]});
  throw Error('Unexpected test URL');
 };
 const result=await process(existing?{...job,filename:'existing.png',upload_started_at:'2026-01-01'}:job,'qa-clickup');
 return {result,calls,patches};
}
let out=await run();assert.equal(out.result.state,'completed');assert.equal(out.calls.filter(c=>c.url.endsWith('/attachment')).length,1);
out=await run({existing:true});assert.equal(out.result.state,'completed');assert.equal(out.calls.filter(c=>c.method==='POST'&&c.url.includes('api.clickup.com')).length,0);
out=await run({uncertain:true});assert.equal(out.result.state,'uncertain');
out=await run({stale:true});assert.equal(out.result.state,'review');assert.equal(out.calls.filter(c=>c.url.endsWith('/attachment')).length,0);
console.log('PASS: wording preservation, optional fields, strict mapping, task guards, signed render, one upload, receipt recovery, stale-source rejection, uncertain upload');
