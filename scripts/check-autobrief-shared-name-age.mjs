import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {dirname} from 'node:path';
const path=process.argv[2]||'supabase/functions/clickup-order-brief/index.ts';
const source=readFileSync(path,'utf8').replace(/^import .*;\n/gm,'');
const lifecycle=existsSync(dirname(path)+'/lifecycle.ts')?readFileSync(dirname(path)+'/lifecycle.ts','utf8').replaceAll('export ',''):'';
const load=fetcher=>new Function('Deno','fetch',stripTypeScriptTypes(lifecycle+'\n'+source)+';return {sharedNameAgeNoteRule,readingSummary,process};')({env:{get:k=>({SUPABASE_URL:'https://order.test',SUPABASE_SERVICE_ROLE_KEY:'test',OPENAI_API_KEY:'synthetic'})[k]||''},serve:()=>{}},fetcher);
const items=[{item_sku:'CN1001',title:'Custom Name Alpha Hero Topper',provider_item_id:'1111111111',quantity:1},{item_sku:'CN1002',title:'Custom Name Beta United Topper',provider_item_id:'2222222222',quantity:1}];
const catalogue=items.map((i,n)=>({item_id:i.provider_item_id,product_id:`00000000-0000-4000-8000-00000000000${n}`,sku:i.item_sku,title:i.title}));
const siblings=items.map(i=>({task_name:'1x '+i.item_sku}));
const note='Nama : Sample Child\nUmur :  5\nDua2 topper sama nama & umur';
const messages=[];
const context={messages,bindings:[{id:'chat',usable:true}]};
const base={note,existingWord:note,items,siblingTasks:siblings,messages,context,sku:'CN1001'};
const api=load(()=>{throw Error('unexpected network')});
assert.equal(api.sharedNameAgeNoteRule(base).wording,'Sample Child 5');
assert.equal(api.sharedNameAgeNoteRule({...base,note:note.replaceAll('\n','\\n')}).eligible,true);
assert.equal(api.sharedNameAgeNoteRule({...base,existingWord:'Sample Child 5'}).confidence,95);
assert.equal(api.sharedNameAgeNoteRule({...base,sku:'CN1002',items:[...items].reverse()}).wording,'Sample Child 5');
for(const change of [
 {note:note.replace('Dua2','Semua')+'\nwarna merah'},
 {note:note.replace('Dua2 topper sama nama & umur','Topper berbeza nama')},
 {note:note.replace(' 5',' 0')},{note:note.replace(' 5',' 121')},
 {note:note.replace('Dua2 topper sama nama & umur','')},
 {existingWord:'Staff Approved Name'},{items:[items[0]]},
 {items:[{...items[0],quantity:2},items[1]]},
 {items:[{...items[0],item_sku:'EI1001'},items[1]]},
 {siblingTasks:[]},{sku:'CN9999'},
 {context:{ambiguous:true}},{context:{unavailable:true}},{context:{truncated:true}},
 {messages:[{direction:'inbound',text_content:'Nama lain'}]},
 {messages:[{direction:'inbound',message_type:'image'}]}
])assert.equal(api.sharedNameAgeNoteRule({...base,...change}).eligible,false,JSON.stringify(change));
// Exercise real process with exact-task field/comment writes and replay.
for(const [index,wording]of [[0,'Sample Child 5'],[1,'Sample Child 5']]){
 let stored,comments=[],posts=0,sends=0,fieldWrites=0;
 const id='synthetic-task',orderId='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
 const fields=[{id:'sku',name:'SKU',value:items[index].item_sku},{id:'7c88d5cf-56e9-4108-86c5-b8e7baaf5bdc',name:'Customize Name',value:note},{id:'afa87c64-3e48-4056-b720-cf8ea9b243e8',name:'confirmed',value:false},{id:'01cec4ef-a30b-443d-a43a-9ab09835b78c',name:'Review customer',value:'',type_config:{options:[{id:'d84d57b3-41f3-473d-b502-4e7bf45ace0c',name:'Ai Check'}]}}];
 const task={id,list:{id:'18375902'},status:{status:'design editing -topper'},custom_fields:fields};
 const transport=async(raw,opts={})=>{
  const u=new URL(raw),b=opts.body?JSON.parse(opts.body):{},method=opts.method||'GET',p=u.pathname;
  if(u.hostname==='order.test'){
   if(p.endsWith('/private_runtime_settings'))return Response.json([{setting_value:u.searchParams.get('setting_key')==='eq.order_brief_followup_enabled'?'true':'test'}]);
   if(p.endsWith('/clickup_autobrief_routes'))return Response.json([{profile:'glossy',initial_status:'design editing -topper',task_created_at:'2026-10-01T00:00:00Z'}]);
   if(p.endsWith('/ai_clickup_work_snapshots'))return Response.json(u.searchParams.has('task_id')?[{task_id:id,list_id:'18375902',task_name:'1x '+items[index].item_sku,marketplace_order_id:orderId,clickup_status:'design editing -topper',order_reference:'261001ABCDEFGH'}]:siblings);
   if(p.endsWith('/task_detail_automation'))return Response.json([{data:{missing:[],info_status:'ready'}}]);
   if(p.endsWith('/marketplace_orders'))return Response.json(u.searchParams.has('id')&&u.searchParams.get('id').startsWith('eq.')?[{placed_at:'2026-10-01T00:05:00Z',current_status:'READY_TO_SHIP',buyer_user_id:'123456',shop_id:'123',order_sn:'261001ABCDEFGH',buyer_message:note}]:[]);
   if(p.endsWith('/marketplace_order_items'))return Response.json(items);
   if(p.endsWith('/product_channel_listings'))return Response.json(catalogue.map(c=>({...c,shop_id:'123'})));
   if(p.endsWith('/products'))return Response.json(catalogue.map(c=>({id:c.product_id,parent_sku:c.sku,name:c.title})));
   if(p.endsWith('/icetak_record_order_brief')){stored=b;return Response.json({ok:true});}
  }
  if(u.hostname==='api.openai.com')return Response.json({model:'test-model',output:[{content:[{type:'output_text',text:JSON.stringify({item_sku:items[index].item_sku,wording:'Sample Child, 5',confidence:98,needs_review:false,summary:'Both toppers use Sample Child, age 5.',instruction:'Use the same name and age for both toppers.'})}]}]});
  if(u.hostname.endsWith('.supabase.co')){
   if(b.action==='buyer_note')return Response.json({ok:true,available:true,order_sn:'261001ABCDEFGH',shop_id:'123',buyer_note:note});
   if(b.action==='order_proof'||b.action==='context')return Response.json({ok:true,matched:true,conversation_id:'chat',messages});
   if(b.action==='inspect')return Response.json({ok:true,available:true,enabled:true,order_sn:'261001ABCDEFGH',buyer_user_id:'123456',shop_id:'123',placed_at:'2026-10-01T00:05:00Z',order_status:'READY_TO_SHIP',buyer_note:note,deliveries:[],messages:messages.filter(m=>m.id==='m5').map(m=>({...m,text_content:'',message_type:'image'}))});
   sends++;throw Error('No customer send expected');
  }
  if(u.hostname==='api.clickup.com'){
   if(p.endsWith('/task/'+id))return Response.json(task);
   if(p.endsWith('/task/'+id+'/comment')){if(method==='POST'){posts++;comments=[{id:'comment1',comment:b.comment}];return Response.json({id:'comment1'});}return Response.json({comments});}
   if(p.endsWith('/comment/comment1')&&method==='PUT'){comments=[{id:'comment1',comment:b.comment}];return Response.json({});}
   if(p.includes('/field/')){fieldWrites++;const f=fields.find(f=>f.id===p.split('/').at(-1));assert(f);f.value=b.value;return Response.json({});}
  }
  throw Error('Unexpected '+method+' '+u.origin+p);
 };
 const worker=load(transport),job={task_id:id,source_fingerprint:'synthetic',state:'processing'};
 const result=await worker.process(job,'test','test');assert.equal(result.state,'completed',JSON.stringify({result,brief:stored?.p_brief}));
 assert.equal(stored.p_brief.wording,wording);assert.equal(stored.p_brief.confidence,95);
 assert.equal(stored.p_brief.confirmed,true);assert.equal(fields[1].value,wording);assert.equal(fields[3].value,'d84d57b3-41f3-473d-b502-4e7bf45ace0c');
 assert.equal(stored.p_brief.shared_name_age_rule.eligible,true);assert.match(JSON.stringify(comments),/Ringkasan bacaan/);assert.match(JSON.stringify(comments),/Both toppers use Sample Child/);assert.equal(stored.p_brief.reading_summary.name,'Sample Child');assert.equal(stored.p_brief.reading_summary.age,5);assert.equal(sends,0);
 // Replay on repository baseline; live lifecycle separately locks confirmed routes.
 if(!lifecycle){const before=fieldWrites;await worker.process({...job,comment_id:'comment1',brief:stored.p_brief,checked_message_ids:stored.p_brief.checked_message_ids},'test','test');assert.equal(posts,1);assert.equal(fieldWrites,before);}
}
console.log('PASS explicit shared source name/age and scope, malformed/conflicting/staff/context/media/quantity guards, both actual worker CF/comment/AI summary outcomes, zero sends and replay.');
