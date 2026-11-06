import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {imageMeta,fontMetadata,matchFont,aiDraft} from '../supabase/functions/render-template/studio-core.js';
const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10]);new DataView(png.buffer).setUint32(16,1447);new DataView(png.buffer).setUint32(20,2048);
assert.deepEqual(imageMeta(png),{width:1447,height:2048,mime:'image/png'});assert.throws(()=>imageMeta(new Uint8Array(24)));const huge=png.slice();new DataView(huge.buffer).setUint32(16,9000);assert.throws(()=>imageMeta(huge));assert.equal(fontMetadata(new Uint8Array(10)),'');
const fonts=[{id:'11111111-1111-4111-8111-111111111111',name:'Harry P',aliases:['Harry Potter'],path:'FONTLIB/fonts/11111111-1111-4111-8111-111111111111.ttf'}];
assert.equal(matchFont('Harry Potter',fonts).path,fonts[0].path);assert.equal(matchFont('missing',fonts),null);assert.equal(matchFont('Arial',[]).name,'Arial');assert.equal(matchFont('Harry P',[...fonts,{...fonts[0],id:'duplicate'}]),null);
const text={x:50,y:20,boxWidth:40,boxHeight:10,fontSize:70,fontWeight:'400',fill:'#000000',stroke:'#000000',strokeWidth:0,align:'center',curve:0,rotation:0,tracking:0,scaleX:100,scaleY:100};
const result={summary:'Two editable layers',confidence:90,warnings:[],layers:[{field:'greeting',label:'Ucapan',source:'greeting',required:true,default:'HAPPY BIRTHDAY',example:'HAPPY BIRTHDAY',font_name:'Harry P',text},{field:'name',label:'Nama dan umur',source:'name_age',required:true,default:'BAD SAMPLE',example:'Aisyah 6 tahun',font_name:'Harry P',text:{...text,y:31}}]};
const draft=aiDraft(result,fonts,1447,2048);assert.equal(draft.analysis.confidence,90);assert.equal(aiDraft({...result,confidence:0.95},fonts,1447,2048).analysis.confidence,95);assert.equal(draft.values.name,'Aisyah 6 tahun');assert.equal(draft.config.automation.inputs.name.default,'');assert.equal(draft.config.automation.enabled,false);assert.equal(draft.analysis.unresolved_fonts.length,0);
assert.equal(aiDraft(result,[],1447,2048).analysis.unresolved_fonts.length,2);assert.throws(()=>aiDraft({...result,layers:[{...result.layers[0],field:'__proto__'}]},fonts,1447,2048));assert.throws(()=>aiDraft({...result,layers:[result.layers[0],{...result.layers[0],label:'Conflict'}]},fonts,1447,2048));
let handler,completions=[],providerCalls=0,incomplete=false;const nativeFetch=globalThis.fetch;
globalThis.Deno={env:{get:key=>key==='SUPABASE_URL'?'https://fixture.supabase.co':key==='SUPABASE_SERVICE_ROLE_KEY'?'fixture-service':key==='OPENAI_API_KEY'?'fixture-openai':''},serve:fn=>handler=fn};
globalThis.fetch=async (url,init={})=>{
 const u=new URL(String(url));
 if(u.hostname==='api.openai.com'){
  providerCalls++;const b=JSON.parse(init.body);assert.equal(init.headers.authorization,'Bearer fixture-openai');assert.equal(b.store,false);assert.equal(b.text.format.strict,true);assert.equal(b.input[0].content.filter(c=>c.type==='input_image').length,2);assert(!JSON.stringify(b).includes('fixture-openai'));
  return Response.json({status:incomplete?'incomplete':'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]});
 }
 if(u.pathname.includes('/storage/v1/object/public/'))return new Response(init.method==='HEAD'?null:png,{headers:{'content-length':String(png.length)}});
 if(u.pathname.endsWith('/private_runtime_settings'))return Response.json([{setting_value:'worker-secret'}]);
 if(u.pathname.endsWith('/icetak_render_studio')){
  const b=JSON.parse(init.body);if(b.p_action==='fonts')return Response.json(fonts);
  if(b.p_action==='claim')return Response.json({id:'job-fixture',sku:'TESTSKU',lease:'fixture-lease',snapshot:{raw_path:'TESTSKU/images/22222222-2222-4222-8222-222222222222.png',reference_path:'TESTSKU/images/33333333-3333-4333-8333-333333333333.png',instructions:'Preserve wording',font_hint:'Harry P'}});
  if(b.p_action==='complete'){completions.push(b.p_data);return Response.json({saved:true});}
 }
 throw Error('Unexpected test transport '+u.pathname);
};
try{
 let source=await readFile(new URL('../supabase/functions/render-template-ai/index.ts',import.meta.url),'utf8');source=source.replace(/^import 'jsr:[^']+';\n/,'').replace(/from '(\.\.[^']+)'/g,(_,path)=>'from '+JSON.stringify(new URL('../supabase/functions/render-template-ai/'+path,import.meta.url).href));
 const code=stripTypeScriptTypes(source,{mode:'strip'});await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const req=auth=>new Request('https://fixture.example',{method:'POST',headers:{'content-type':'application/json',...(auth?{'x-order-brief-token':'worker-secret'}:{})},body:'{"action":"run"}'});
 assert.equal((await handler(req(false))).status,401);assert.equal(providerCalls,0);assert.equal((await handler(req(true))).status,200);assert.equal(providerCalls,1);assert.equal(completions[0].result.values.name,'Aisyah 6 tahun');assert.equal(completions[0].result.config.automation.enabled,false);assert(completions[0].result.config.layers.every(l=>l.font_path.startsWith('TESTSKU/fonts/')));
 incomplete=true;assert.equal((await handler(req(true))).status,502);assert.equal(completions.at(-1).error,'AI_INCOMPLETE');assert(!completions.at(-1).result);
}finally{globalThis.fetch=nativeFetch;delete globalThis.Deno;}
console.log('Render studio: image/font/schema/wording and actual vision handler auth/draft/failure checks pass.');
