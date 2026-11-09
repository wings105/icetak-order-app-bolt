import assert from 'node:assert/strict';
import {matchPrintItem, printRules, taskPhone} from './print-brief.ts';

const pair = {provider_item_id:'22163856881', variation_name:'5.5 inch (bulat),6 inch (bulat)',title:'Burn Away Edible + Wafer',quantity:1};
assert.equal(matchPrintItem([pair],'5.5 inch (bulat)','edible')?.layer,'bawah');
assert.equal(matchPrintItem([pair],'6 inch (bulat)','wafer')?.layer,'atas');
assert.equal(matchPrintItem([pair],'6 inch (bulat)','edible'),null);
assert.equal(matchPrintItem([pair,pair],'6 inch (bulat)','wafer'),null);
assert.equal(taskPhone({custom_fields:[{name:'phone',value:'012-0000000'}]}),'60120000000');
const make = (type:string, body:string, n:number) => ({
 id:'00000000-0000-4000-8000-0000000000'+String(n).padStart(2,'0'), created_at:new Date(1793900000000+n*15000).toISOString(),
 message_type:type, direction:'inbound', channel:'whatsapp', text_content:body
});
const customer = [
 make('text','Order wafer paper burn away dgn edible image',0),
 make('text','Wafer paper nak saiz bulat bentuk calender',1),
 make('image','Calender mcmni',2),
 make('text','November 2026\nTarikh 13',3),
 make('image','[Image]',4),
 make('text','Edible image yg ni ye bang bentuk bulat',5),
 make('text','Nanti abg review dlu ye sebelum post out',6)
];
const ctx = {messages:customer,channels:{shopee:'identity_unavailable',whatsapp:'matched'}};
const wafer=printRules({single_item_scope:true,target:{profile:'wafer',layer:'atas',quantity:1,purchased_size:'6 inch (bulat)',title:pair.title}},ctx);
const edible=printRules({single_item_scope:true,target:{profile:'edible',layer:'bawah',quantity:1,purchased_size:'5.5 inch (bulat)',title:pair.title}},ctx);
assert.deepEqual(wafer.selected.map((m:Record<string,unknown>)=>m.id),[customer[2].id]);
assert.deepEqual(edible.selected.map((m:Record<string,unknown>)=>m.id),[customer[4].id]);
assert.match(wafer.instruction,/November 2026\nTarikh 13/);
assert.equal(wafer.review_requested,true);
assert.equal(edible.review_requested,true);
assert.equal(edible.print_size,'5.5 inch (bulat)');
const another = [make('image','[Image]',0),make('text','Bawah',1),make('text','Atas calendar November 19',2)];
const upper=printRules({single_item_scope:true,target:{profile:'wafer',layer:'atas',quantity:1,purchased_size:'5 inch (bulat)',title:pair.title}},{messages:another});
assert.equal(upper.selected.length,0);
assert.match(upper.missing.join(' '),/tahun/);
const print = {single_item_scope:true,target:{profile:'edible',quantity:1,purchased_size:'A4 (7.5 × 11in) FULL Landscape',title:'Print Only / No Review'}};
const originals=[make('image','[Image]',0),make('image','[Image]',1),make('text','Gna yg ni',2)];
const result=printRules(print,{messages:originals});
assert.deepEqual(result.selected.map((m:Record<string,unknown>)=>m.id),[originals[1].id]);
assert.equal(result.wording_mode,'embedded_in_artwork');
assert.equal(printRules(print,{messages:originals,ambiguous:true}).selected.length,0);
const order = {single_item_scope:false,target:{profile:'edible',quantity:1,purchased_size:'A4',title:'Edible Image',style:'Custom',wording:'7"x10"'},other_sizes:['a5','3','2.5']};
const three=[make('image','Edible image saiz A5 portrait',0),make('image','Edible image saiz 7"x10"\nTulis *TEST WORDING*',1),make('image','Edible image logo mu...saiz 2.5" bulat',2)];
const direct=printRules(order,{messages:three});
assert.deepEqual(direct.selected.map((m:Record<string,unknown>)=>m.id),[three[1].id]);
assert.equal(direct.print_size,'7 × 10 inci');
assert.equal(direct.wording,'TEST WORDING');
console.log('PASS Edible/Wafer rule, layer, image replacement, missing calendar year, direct multi-item and ambiguous-source checks');

const {processPrint}=await import('./print-brief.ts');
const orderId='00000000-0000-4000-8000-000000000199';
const orderNo='261106TESTIMG1';
const taskId='syntheticTask1';
const route={profile:'wafer',initial_status:'wafer paper',task_created_at:new Date(Date.now()-1_000_000).toISOString()};
const snapshot={task_id:taskId,order_reference:orderNo,list_id:'18375902',marketplace_order_id:orderId,clickup_status:'wafer paper'};
const task={id:taskId,list:{id:'18375902'},status:{status:'wafer paper'},attachments:[] as Array<Record<string,unknown>>,custom_fields:[
 {name:'SKU',id:'sku',value:'6 inch (bulat)'},{name:'ORDER ID / customer name',id:'order',value:orderNo}
]};
let saved:Record<string,any>={};
let uploads=0,posted=0;
const fake=async(path:string,method='GET',body?:any)=>{
 if(path==='task/'+taskId&&method==='GET')return task;
 if(path.endsWith('/attachment')&&method==='POST'){
  const file=body.get('attachment') as File;
  const attachment={id:'1',title:file.name,url:'https://example.test/asset'};
  uploads++;task.attachments.push(attachment);return attachment;
 }
 if(path.endsWith('/comment')&&method==='GET')return {comments:[]};
 if(path.endsWith('/comment')&&method==='POST'){
  posted++;
  assert.ok(body.comment.some((part:any)=>part.attributes?.link==='https://img.susercontent.com/cal.png'));
  return {id:'comment1'};
 }
 throw Error('Unexpected ClickUp call '+method+' '+path);
};
const oldFetch=globalThis.fetch;
globalThis.fetch=async()=>Response.json({ok:true,context:{...ctx,order_id:orderId,
 messages:customer.map(m=>({...m,media_url:m.id===customer[2].id?'https://img.susercontent.com/cal.png':undefined}))}});
const dependencies={
 clickup:(_token:string,...args:Parameters<typeof fake>)=>fake(...args),
 db:async(path:string,body?:any)=>{
  if(path.startsWith('marketplace_orders?'))return [{id:orderId,provider:'shopee',order_sn:orderNo,placed_at:customer[0].created_at,current_status:'READY_TO_SHIP'}];
  if(path.startsWith('marketplace_order_items?'))return [pair];
  if(path==='rpc/icetak_print_previous_whatsapp_close')return null;
  if(path==='rpc/icetak_record_order_brief'){saved=body;return true;}
  throw Error('Unexpected db call '+path);
 },
 digest:async(s:string)=>s,safeDownload:async()=>({bytes:new Uint8Array([137,80,78,71]),mime:'image/png'}),
 allowedHost:(host:string)=>host==='img.susercontent.com',clock:()=>'',rich:(text:string)=>[{text}],
 summarize:async()=>({mode:'rules'}),inbox:'https://synthetic.test'
};
try{
 const job={task_id:taskId,source_fingerprint:'fingerprint',lease_until:new Date(Date.now()+180_000).toISOString()};
 const outcome=await processPrint(job,snapshot,route,'synthetic','synthetic',dependencies);
 assert.equal(outcome.status,'BRIEF_READY');
 assert.equal(outcome.attachments,1);
 assert.equal(saved.p_media[0].message_id,customer[2].id);
 await processPrint({...job,brief:saved.p_brief,comment_id:saved.p_comment_id,media_receipts:saved.p_media},snapshot,route,'synthetic','synthetic',dependencies);
 assert.equal(uploads,1);
 assert.equal(posted,1);
 console.log('PASS actual print worker attachment, clickable source link and retry deduplication with controlled ClickUp transport');
}finally{globalThis.fetch=oldFetch;}

const batchTime=make('image','[Image]',3).created_at;
const foreign={...make('image','261109AAAAAA1',0),conversation_id:'wa'};
const flat={...make('image','[Image]',1),conversation_id:'wa',created_at:batchTime};
const cake={...make('image','Lagi satu .. 261109TESTIMG2',2),conversation_id:'wa',created_at:batchTime};
const crop=make('text','Boleh je squeeze gambar',4);
const batchScope={...print,order_no:'261109TESTIMG2'};
const onlyTagged=printRules(batchScope,{messages:[foreign,cake,crop]});
assert.equal(onlyTagged.selected[0].id,cake.id);
const uncertain=printRules(batchScope,{messages:[foreign,flat,cake,crop]});
assert.equal(uncertain.selected.length,0);
assert.match(uncertain.flags.join(),/Lebih daripada satu gambar/);
const resolved=printRules({...batchScope,staff_artwork_message_id:flat.id},{messages:[foreign,cake,flat,crop]});
assert.deepEqual(resolved.selected.map((m:Record<string,unknown>)=>[m.id,m.role]),[[flat.id,'Artwork untuk cetak'],[cake.id,'Contoh hasil pada kek']]);
assert.equal(resolved.instruction,'Boleh je squeeze gambar');
assert.equal(printRules({...batchScope,staff_artwork_message_id:foreign.id},{messages:[foreign,flat,cake,crop]}).selected.length,0);
console.log('PASS order-caption match, same-timestamp batch isolation, verified artwork selection and crop instruction');
