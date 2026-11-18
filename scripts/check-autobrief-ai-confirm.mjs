import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {dirname} from 'node:path';
const path=process.argv[2]||'supabase/functions/clickup-order-brief/index.ts';
const source=readFileSync(path,'utf8').replace(/^import .*;\n/gm,'');
const lifecycle=existsSync(dirname(path)+'/lifecycle.ts')?readFileSync(dirname(path)+'/lifecycle.ts','utf8').replaceAll('export ',''):'';
const load=fetcher=>new Function('Deno','fetch',stripTypeScriptTypes(lifecycle+'\n'+source)+';return {aiEvidenceConfirmation,openAiGlossyDecision,readingSummary,process};')({env:{get:k=>({SUPABASE_URL:'https://order.test',SUPABASE_SERVICE_ROLE_KEY:'test',OPENAI_API_KEY:'synthetic'})[k]||''},serve:()=>{}},fetcher);
const items=[{item_sku:'CN1001',title:'Custom Name Alpha Hero Topper',provider_item_id:'1111111111',quantity:1},{item_sku:'CN1002',title:'Custom Name Beta United Topper',provider_item_id:'2222222222',quantity:1}];
const catalogue=items.map((i,n)=>({item_id:i.provider_item_id,product_id:`00000000-0000-4000-8000-00000000000${n}`,sku:i.item_sku,title:i.title}));
items.splice(1);
const siblings=items.map(i=>({task_name:'1x '+i.item_sku}));
const note='';
const wording='Vroom.. Vroom..! Sample Child Turns 5';
const messages=['[Shopee order: 261001ABCDEFGH]','Wording: Vroom Vroom! Sample Child Turns 5','[revoke]','Wording: '+wording,'Hopefully boleh dpt sebelum 11/11'].map((text,n)=>({id:'m'+n,text_content:text,created_at:new Date(Date.parse('2026-10-01T00:00:00Z')+n*1000).toISOString(),conversation_id:'chat',direction:'inbound',message_type:'text',channel:'shopee'}));
const context={messages,bindings:[{id:'chat',usable:true}]};
const analysis={ok:true,mode:'text',confidence:94,needs_review:false,item_sku:'CN1001',wording,evidence_ids:['m3']};
const base={analysis,current:true,items,sku:'CN1001',messages:messages.slice(1),context,existingWord:'',note,decision:{},missing:[],provider:{available:true,order_status:'READY_TO_SHIP'},siblingTasks:siblings};
const api=load(()=>{throw Error('unexpected network')});
assert.equal(api.aiEvidenceConfirmation(base).wording,wording);
assert.match(api.aiEvidenceConfirmation(base).instruction,/Permintaan customer/);
for(const change of [
 {current:false},{analysis:{...analysis,confidence:89}},{analysis:{...analysis,needs_review:true}},
 {analysis:{...analysis,item_sku:'CN9999'}},{analysis:{...analysis,evidence_ids:['foreign-id']}},
 {analysis:{...analysis,evidence_ids:['m1']}},{analysis:{...analysis,wording:'Invented Child 5'}},
 {items:[...items,items[0]]},{items:[{...items[0],quantity:2}]},
 {context:{ambiguous:true}},{context:{truncated:true}},{context:{unavailable:true}},
 {existingWord:'Staff Value'},{note:'Checkout Name 8'},{missing:[{key:'size'}]},
 {provider:{available:false}},{provider:{available:true,order_status:'UNPAID'}},
 {decision:{age_conflict:true}},
 {messages:messages.map(m=>m.id==='m1'?{...m,text_content:'Wording: Different Child Turns 8'}:m)},
 {messages:[...messages,{...messages[4],id:'last',created_at:'2026-10-01T00:01:00Z',text_content:'tukar nama kepada Other'}]}
])assert.equal(api.aiEvidenceConfirmation({...base,...change}).eligible,false,JSON.stringify(change));
const splitNote='NAME : SAMPLE CHILD';
const splitWording='SAMPLE CHILD 12 Tahun';
const splitMessages=['Sorry saya lupa letak umur..','12 Tahun','Nama : SAMPLE CHILD'].map((text,index)=>({
 ...messages[index+1],id:'split'+index,text_content:text
}));
const splitAnalysis={...analysis,wording:'Name: SAMPLE CHILD; age: 12',confidence:98,evidence_ids:['split1','split2']};
const splitCase={...base,note:splitNote,existingWord:splitNote,messages:splitMessages,analysis:splitAnalysis};
assert.equal(api.aiEvidenceConfirmation(splitCase).wording,splitWording);
for(const change of [
 {analysis:{...splitAnalysis,wording:'Name: SAMPLE CHILD; age: 13'}},
 {analysis:{...splitAnalysis,wording:'Name: OTHER CHILD; age: 12'}},
 {analysis:{...splitAnalysis,evidence_ids:['split2']}},
 {analysis:{...splitAnalysis,evidence_ids:['split1']}},
 {existingWord:'Staff approved wording'},
 {messages:[...splitMessages,{...splitMessages[1],id:'other',text_content:'13 Tahun'}]},
 {messages:[...splitMessages,{...splitMessages[2],id:'other',text_content:'Nama : OTHER CHILD'}]},
 {messages:[...splitMessages,{...splitMessages[2],id:'other',text_content:'Tukar nama kepada OTHER'}]}
])assert.equal(api.aiEvidenceConfirmation({...splitCase,...change}).eligible,false,JSON.stringify(change));

const multiItems=[
 {...items[0],title:'Custom Name Alpha Heroes Cake Topper'},
 {...items[0],item_sku:'CN1002',provider_item_id:'2222222222',title:'Custom Name Numberblocks Number Blocks Cake Topper'}
];
const multiMessages=[
 'Hai cik','Sy ada order nk letak nama and number ya',
 'Alpha Heroes :\nSample One\nTurn 2 years',
 'Nunber blocks :\nSample Two\nTurn 6 years',
 'Hello boleh ke?','Sbb sy nk guna 14hb ni'
].map((text,i)=>({...messages[1],id:'multi'+i,text_content:text}));
const multiCase={...base,items:multiItems,messages:multiMessages,decision:{age_conflict:true},
 siblingTasks:multiItems.map(item=>({task_name:'1x '+item.item_sku})),
 analysis:{...analysis,wording:'Sample One; Turn 2 years',evidence_ids:['multi2']}};
assert.equal(api.aiEvidenceConfirmation(multiCase).wording,'Sample One Turn 2 years');
const secondCase={...multiCase,sku:'CN1002',analysis:{...analysis,item_sku:'CN1002',wording:'Sample Two; 6 years',evidence_ids:['multi3']}};
assert.equal(api.aiEvidenceConfirmation(secondCase).wording,'Sample Two Turn 6 years');
for(const change of [
 {analysis:{...secondCase.analysis,evidence_ids:['multi2']}},
 {analysis:{...secondCase.analysis,wording:'Sample One; 6 years'}},
 {analysis:{...secondCase.analysis,wording:'Sample Two; 7 years'}},
 {messages:multiMessages.filter(m=>m.id!=='multi2')},
 {messages:[...multiMessages,{...multiMessages[3],id:'conflict',text_content:'Numberblocks :\nOther Child\nTurn 7 years'}]},
 {items:[{...multiItems[0],title:'Custom Name Numberblocks Alpha Heroes'},multiItems[1]]},
 {existingWord:'Staff approved wording'}
])assert.equal(api.aiEvidenceConfirmation({...secondCase,...change}).eligible,false,JSON.stringify(change));

const missingWording=[{key:'mode'},{key:'wording'}];
const headingCase={...secondCase,missing:missingWording,
 messages:[
  {...multiMessages[2],text_content:'Yang utk ALPHA HEROES\n\nHappy Birthday Sample One\n2 Tahun'},
  {...multiMessages[3],text_content:'Yang utk NUMBERBLOCKS\n\nHappy Birthday Sample Two\n6 Tahun'}
 ],
 analysis:{...secondCase.analysis,wording:'Happy Birthday Sample Two\n6 Tahun'}
};
assert.equal(api.aiEvidenceConfirmation(headingCase).wording,'Happy Birthday Sample Two\n6 Tahun');
for(const change of [
 {missing:[...missingWording,{key:'size'}]},
 {analysis:{...headingCase.analysis,confidence:89}},
 {analysis:{...headingCase.analysis,evidence_ids:['multi2']}},
 {analysis:{...headingCase.analysis,wording:'Happy Birthday Sample Two\n7 Tahun'}}
])assert.equal(api.aiEvidenceConfirmation({...headingCase,...change}).eligible,false,JSON.stringify(change));

const directWording='Happy 21st Birthday\nSAMPLE CHILD';
const directMessages=[{...messages[3],created_at:'2026-10-01T00:06:00Z',text_content:directWording}];
const directAnalysis={...analysis,confidence:95,wording:directWording.replace('\n',' ')};
const directCase={...base,messages:directMessages,analysis:directAnalysis,missing:missingWording};
assert.equal(api.aiEvidenceConfirmation(directCase).wording,directWording);
for(const change of [
 {analysis:{...directAnalysis,confidence:89}},
 {analysis:{...directAnalysis,wording:'Happy 12th Birthday SAMPLE CHILD'}},
 {messages:[...directMessages,{...messages[4],text_content:'Happy 25th Birthday SAMPLE CHILD'}]},
 {messages:[...directMessages,{...messages[4],text_content:'',message_type:'image'}]},
 {messages:[{...messages[3],text_content:'Boleh hantar sebelum Sabtu'}],
  analysis:{...directAnalysis,wording:'Boleh hantar sebelum Sabtu'}},
 {existingWord:'Staff approved wording'}
])assert.equal(api.aiEvidenceConfirmation({...directCase,...change}).eligible,false,JSON.stringify(change));

const deliveryWording='SAMPLE CHILD 8 TAHUN';
const deliveryInstruction='urgent ( blh x smpai dalm jumaat ne )';
const deliveryNote='CUSTOM NAME: SAMPLE CHILD\n    8 TAHUN\n\nPs : '+deliveryInstruction;
const deliveryAnalysis={...analysis,wording:deliveryWording,confidence:96,instruction:deliveryInstruction,evidence_ids:[]};
const deliveryCase={...base,note:deliveryNote,messages:[],analysis:deliveryAnalysis};
assert.equal(api.aiEvidenceConfirmation(deliveryCase).wording,deliveryWording);
assert.equal(api.aiEvidenceConfirmation(deliveryCase).delivery_instruction,deliveryInstruction);
for(const change of [
 {analysis:{...deliveryAnalysis,wording:'SAMPLE CHILD 9 TAHUN'}},
 {analysis:{...deliveryAnalysis,confidence:89}},
 {note:deliveryNote+'\nTukar warna merah'},
 {existingWord:'Staff approved wording'}
])assert.equal(api.aiEvidenceConfirmation({...deliveryCase,...change}).eligible,false,JSON.stringify(change));

const originalPrint='Happy 15th Brithday Sample Child';
const correctedPrint='Happy 15th Birthday Sample Child';
const chineseNote='请帮我写'+originalPrint;
const chineseAnalysis={...analysis,wording:correctedPrint,confidence:95,evidence_ids:[],wording_sources:[{id:'buyer_note',text:originalPrint}]};
const chineseCase={...base,product:{sku:'CN1001',product_id:'1111111111'},note:chineseNote,messages:[],existingWord:chineseNote,analysis:chineseAnalysis};
assert.equal(api.openAiGlossyDecision(chineseCase).wording,correctedPrint);
for(const wording of ['Selamat Hari Lahir Sample Child','Happy 16th Birthday Sample Child','Happy 15th Birthday Different Child']){
 assert.equal(api.openAiGlossyDecision({...chineseCase,analysis:{...chineseAnalysis,wording}}).eligible,false);
}
assert.equal(api.openAiGlossyDecision({...chineseCase,analysis:{...chineseAnalysis,wording_sources:[{id:'unrelated',text:originalPrint}]}}).eligible,false);
assert.equal(api.openAiGlossyDecision({...chineseCase,analysis:{...chineseAnalysis,wording:'Sam',wording_sources:[{id:'buyer_note',text:'Sam'}]}}).eligible,false);

// Exercise the worker paths with actual field/comment writes and an unavailable model.
for(const fixture of [
 {note,messages,expected:wording,analysis:{...analysis,wording_sources:[{id:'m3',text:wording}]}},
 {note,messages:directMessages,expected:directWording,analysis:{...directAnalysis,wording:directWording,wording_sources:[{id:'m3',text:directWording}]}},
 {note:deliveryNote,messages:[],expected:deliveryWording,analysis:{...deliveryAnalysis,wording_sources:[{id:'buyer_note',text:deliveryWording}]}},
 {note:splitNote,messages:splitMessages,expected:splitWording,analysis:{...splitAnalysis,wording:splitWording,wording_sources:[{id:'buyer_note',text:'SAMPLE CHILD'},{id:'split1',text:'12 Tahun'}]}},
 {note:chineseNote,messages:[],expected:correctedPrint,analysis:chineseAnalysis},
 {note:chineseNote,messages:[],expected:'',analysis:null}
]){
 const index=0;
 const {note,messages,expected,analysis}=fixture;
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
  if(u.hostname==='api.openai.com'){
   if(!analysis)return Response.json({error:{code:'test_unavailable'}},{status:503});
   return Response.json({model:'test-model',output:[{content:[{type:'output_text',text:JSON.stringify({...analysis,summary:'Verified customer wording.'})}]}]});
  }
  if(u.hostname.endsWith('.supabase.co')){
   if(b.action==='buyer_note')return Response.json({ok:true,available:true,order_sn:'261001ABCDEFGH',shop_id:'123',buyer_note:note});
   if(b.action==='order_proof'||b.action==='context')return Response.json({ok:true,matched:true,conversation_id:'chat',messages});
   if(b.action==='inspect')return Response.json({ok:true,available:true,enabled:true,order_sn:'261001ABCDEFGH',buyer_user_id:'123456',shop_id:'123',placed_at:'2026-10-01T00:05:00Z',order_status:'READY_TO_SHIP',buyer_note:note,deliveries:[],messages:messages===directMessages?directMessages:messages.filter(m=>m.id==='m5').map(m=>({...m,text_content:'',message_type:'image'}))});
   sends++;throw Error('Unexpected bridge action '+b.action);
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
 const result=await worker.process(job,'test','test');
 if(!analysis){
  assert.equal(result.state,'review');
  assert.equal(stored.p_brief.wording,'');
  assert.equal(fields[1].value,note);
  assert.equal(fields[2].value,false);
  assert.equal(fieldWrites,0);
  assert.equal(sends,0);
  continue;
 }
 if(note===deliveryNote)assert.equal(stored.p_brief.delivery_instruction,deliveryInstruction);
 assert.equal(result.state,'completed',JSON.stringify({result,brief:stored?.p_brief}));
 assert.equal(stored.p_brief.wording,expected);assert.equal(stored.p_brief.confidence,analysis.confidence);
 assert.equal(stored.p_brief.confirmed,true);assert.equal(fields[1].value,expected);assert.equal(fields[3].value,'d84d57b3-41f3-473d-b502-4e7bf45ace0c');
 assert.equal(stored.p_brief.ai_confirmation_rule.eligible,true);assert.match(JSON.stringify(comments),/Ringkasan bacaan/);assert.equal(stored.p_brief.ai_mode,'evidence_confirm');assert.match(JSON.stringify(comments),/Pengesahan OpenAI/);assert.equal(sends,0,JSON.stringify({note,expected,followup:stored.p_brief.followup}));
 // Replay on repository baseline; live lifecycle separately locks confirmed routes.
 if(!lifecycle){const before=fieldWrites;await worker.process({...job,comment_id:'comment1',brief:stored.p_brief,checked_message_ids:stored.p_brief.checked_message_ids},'test','test');assert.equal(posts,1);assert.equal(fieldWrites,before);}
}
console.log('PASS AI>=90 current-input/explicit and split name-age evidence gates; stale/SKU/media-context/multi/staff/note/age/name/later-change guards; actual worker CF/comment/instruction, no sends and replay.');
