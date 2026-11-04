import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {dirname} from 'node:path';
const path=process.argv[2]||'supabase/functions/clickup-order-brief/index.ts';
const source=readFileSync(path,'utf8').replace(/^import .*;\n/gm,'');
const lifecycle=existsSync(dirname(path)+'/lifecycle.ts')?readFileSync(dirname(path)+'/lifecycle.ts','utf8').replaceAll('export ',''):'';
const load=fetcher=>new Function('Deno','fetch',stripTypeScriptTypes(lifecycle+'\n'+source)+';return {productCardWordingRule,loadCardCatalogue,selectProof,process};')({env:{get:k=>({SUPABASE_URL:'https://order.test',SUPABASE_SERVICE_ROLE_KEY:'test'})[k]||''},serve:()=>{}},fetcher);
const items=[{item_sku:'CN1001',title:'Custom Name Alpha Hero Topper',provider_item_id:'1111111111',quantity:1},{item_sku:'CN1002',title:'Custom Name Beta United Topper',provider_item_id:'2222222222',quantity:1}];
const catalogue=items.map((i,n)=>({item_id:i.provider_item_id,product_id:`00000000-0000-4000-8000-00000000000${n}`,sku:i.item_sku,title:i.title}));
const siblings=items.map(i=>({task_name:'1x '+i.item_sku}));
const texts=['[Shopee item: 1111111111]','Salam','SAMPLE CHILD','Turns 6','Yg beta united tulis Happy Birthday Sample Adult','[Shopee item: 2222222222]'];
const messages=texts.map((text,n)=>({id:'m'+n,text_content:text,created_at:new Date(Date.parse('2026-10-01T00:00:00Z')+n*1000).toISOString(),conversation_id:'chat',direction:'inbound',message_type:text.startsWith('[')?'system':'text',channel:'shopee'}));
const context={messages,bindings:[{id:'chat',usable:true}]};
const base={items,siblingTasks:siblings,messages,context,catalogue,sku:'CN1001',existingWord:'',note:''};
const api=load(()=>{throw Error('Unexpected request')});
assert.equal(api.productCardWordingRule(base).wording,'SAMPLE CHILD Turns 6');
assert.equal(api.productCardWordingRule({...base,sku:'CN1002',items:[items[1],items[0]]}).wording,'Happy Birthday Sample Adult');
assert.equal(api.productCardWordingRule(base).confidence,95);
assert.deepEqual(api.productCardWordingRule(base).proof.map(m=>m.id),['m0','m2','m3']);
assert.equal(api.selectProof(context,Date.parse('2026-10-01T00:05:00Z'),true).chronological.length,6);
assert.equal(api.selectProof(context,Date.parse('2026-10-01T00:05:00Z')).chronological.length,4);
for(const change of [
 {catalogue:[]},{catalogue:[catalogue[0]]},{catalogue:[...catalogue,catalogue[0]]},
 {catalogue:[{...catalogue[0],sku:'CN9999'},catalogue[1]]},
 {catalogue:catalogue.map(c=>({...c,title:'Beta United'}))},
 {context:{ambiguous:true}},{context:{truncated:true}},{context:{unavailable:true}},
 {siblingTasks:[]},{items:[{...items[0],quantity:2},items[1]]},
 {existingWord:'Approved Staff Name'},{note:'Buyer Note'},
 {messages:messages.slice(1)},{messages:messages.filter(m=>m.id!=='m4')},
 {messages:[...messages,{...messages[2],id:'extra',text_content:'Other Child'}]},
 {messages:[...messages,{...messages[2],id:'extra',text_content:'[Shopee item: 9999999999]'}]},
 {messages:[...messages,{...messages[2],id:'extra',text_content:'boleh tambah gambar?'}]},
 {messages:[...messages,{...messages[2],id:'extra',message_type:'image',text_content:'[Image]'}]}
])assert.equal(api.productCardWordingRule({...base,...change}).eligible,false,JSON.stringify(change));
let requested=[];
const cat=await api.loadCardCatalogue(items,'123',async p=>{requested.push(p);return p.startsWith('products?')?catalogue.map(c=>({id:c.product_id,parent_sku:c.sku,name:c.title})):catalogue.map(c=>({shop_id:'123',item_id:c.item_id,product_id:c.product_id}));});
assert.equal(cat[1].title,items[1].title);assert.match(requested[0],/shop_id=eq.123/);
assert.deepEqual(await api.loadCardCatalogue(items,'bad-shop',()=>{throw Error('must not read')}),[]);
// Exercise real process with exact-task field/comment writes and replay.
for(const [index,wording]of [[0,'SAMPLE CHILD Turns 6'],[1,'Happy Birthday Sample Adult']]){
 let stored,comments=[],posts=0,sends=0,fieldWrites=0;
 const id='synthetic-task',orderId='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
 const fields=[{id:'sku',name:'SKU',value:items[index].item_sku},{id:'7c88d5cf-56e9-4108-86c5-b8e7baaf5bdc',name:'Customize Name',value:''},{id:'afa87c64-3e48-4056-b720-cf8ea9b243e8',name:'confirmed',value:false},{id:'01cec4ef-a30b-443d-a43a-9ab09835b78c',name:'Review customer',value:'',type_config:{options:[{id:'d84d57b3-41f3-473d-b502-4e7bf45ace0c',name:'Ai Check'}]}}];
 const task={id,list:{id:'18375902'},status:{status:'design editing -topper'},custom_fields:fields};
 const transport=async(raw,opts={})=>{
  const u=new URL(raw),b=opts.body?JSON.parse(opts.body):{},method=opts.method||'GET',p=u.pathname;
  if(u.hostname==='order.test'){
   if(p.endsWith('/private_runtime_settings'))return Response.json([{setting_value:u.searchParams.get('setting_key')==='eq.order_brief_followup_enabled'?'true':'test'}]);
   if(p.endsWith('/clickup_autobrief_routes'))return Response.json([{profile:'glossy',initial_status:'design editing -topper',task_created_at:'2026-10-01T00:00:00Z'}]);
   if(p.endsWith('/ai_clickup_work_snapshots'))return Response.json(u.searchParams.has('task_id')?[{task_id:id,list_id:'18375902',task_name:'1x '+items[index].item_sku,marketplace_order_id:orderId,clickup_status:'design editing -topper',order_reference:'261001ABCDEFGH'}]:siblings);
   if(p.endsWith('/task_detail_automation'))return Response.json([{data:{missing:[],info_status:'ready'}}]);
   if(p.endsWith('/marketplace_orders'))return Response.json(u.searchParams.has('id')&&u.searchParams.get('id').startsWith('eq.')?[{placed_at:'2026-10-01T00:05:00Z',current_status:'READY_TO_SHIP',buyer_user_id:'123456',shop_id:'123',order_sn:'261001ABCDEFGH',buyer_message:null}]:[]);
   if(p.endsWith('/marketplace_order_items'))return Response.json(items);
   if(p.endsWith('/product_channel_listings'))return Response.json(catalogue.map(c=>({...c,shop_id:'123'})));
   if(p.endsWith('/products'))return Response.json(catalogue.map(c=>({id:c.product_id,parent_sku:c.sku,name:c.title})));
   if(p.endsWith('/icetak_record_order_brief')){stored=b;return Response.json({ok:true});}
  }
  if(u.hostname==='api.openai.com')throw Error('Deterministic card match must not call AI');
  if(u.hostname.endsWith('.supabase.co')){
   if(b.action==='buyer_note')return Response.json({ok:true,available:true,order_sn:'261001ABCDEFGH',shop_id:'123',buyer_note:''});
   if(b.action==='order_proof'||b.action==='context')return Response.json({ok:true,matched:true,conversation_id:'chat',messages});
   if(b.action==='inspect')return Response.json({ok:true,available:true,enabled:true,order_sn:'261001ABCDEFGH',buyer_user_id:'123456',shop_id:'123',placed_at:'2026-10-01T00:05:00Z',order_status:'READY_TO_SHIP',deliveries:[],messages:messages.filter(m=>m.id==='m5').map(m=>({...m,text_content:'',message_type:'image'}))});
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
 assert.equal(stored.p_brief.product_card_rule.eligible,true);assert.match(JSON.stringify(comments),/kad produk/);assert.equal(sends,0);
 // Replay on repository baseline; live lifecycle separately locks confirmed routes.
 if(!lifecycle){const before=fieldWrites;await worker.process({...job,comment_id:'comment1',brief:stored.p_brief,checked_message_ids:stored.p_brief.checked_message_ids},'test','test');assert.equal(posts,1);assert.equal(fieldWrites,before);}
}
console.log('PASS catalogue product-card identity, ordered labels, name/age scope, context/staff/media/coverage guards, real worker CF/comment outcome, no sends and baseline replay.');
