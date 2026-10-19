import assert from 'node:assert/strict';
import {taskReadiness,validateBrief} from '../supabase/functions/task-workspace/readiness.ts';
import {loadReadiness} from '../supabase/functions/task-workspace/sources.ts';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source={task_id:'task-a',title:'1x A6 acrylic Gold',status:'acrylic',source_updated_at:'2026-10-19T10:00:00Z',mapping_status:'linked',sets:['set1'],fields:{'customize name':'Happy Birthday Aina',confirmed:'true'},files:[],source_token:'token'};
const ready=await taskReadiness(source,null);assert.equal(ready.status,'ready');assert.equal(ready.completeness,100);assert.equal(ready.values.size,'A6');assert.equal(ready.values.quantity,'1');assert.equal(ready.print_ready,false);
const noConfirmed=await taskReadiness({...source,fields:{...source.fields,confirmed:false}},null);assert.equal(noConfirmed.status,'ready');assert.equal(noConfirmed.completeness,100);assert.equal(noConfirmed.confidence,'high');
const missing=await taskReadiness({...source,title:'Acrylic',fields:{confirmed:true}},null);assert.equal(missing.status,'missing');assert(missing.missing.some(m=>m.key==='wording'||m.key==='mode'));assert(!missing.can_confirm);
const draft={version:1,data:noConfirmed.form,source_fingerprint:noConfirmed.fingerprint,confirmed:false,updated_by:'admin'};
assert.equal((await taskReadiness({...source,fields:{...source.fields,confirmed:false}},null,{},draft)).status,'ready');
const confirmed={...draft,confirmed:true};assert.equal((await taskReadiness({...source,fields:{...source.fields,confirmed:false}},null,{},confirmed)).status,'ready');
const expired=await taskReadiness({...source,title:'1x A7 acrylic Gold',fields:{...source.fields,confirmed:false}},null,{},confirmed);assert(expired.expired);assert.equal(expired.status,'ready');assert.notEqual(expired.values.size,'A6');
const context={bindings:[{id:'chat-a',usable:true,revision:'1'}],messages:[{id:'m1',conversation_id:'chat-a',direction:'inbound',text_content:'Wording: Happy Birthday Sara',created_at:'2026-10-19T11:00:00Z'}]};
const order={items:[{id:'item-a',title:'Custom acrylic',sku:'AC01',quantity:1,size:'A6'}],production_tasks:[{id:'task-a',detail:{sku:'AC01',customize_name:'Happy Birthday Aina',confirmed:true}}],state:{data:{}}};
const conflict=await taskReadiness(source,order,context);assert.equal(conflict.status,'review');assert(conflict.conflicts.some(c=>c.value==='Happy Birthday Sara'));assert(conflict.conflicts.length>0);
const correction=validateBrief({...conflict.form,values:{...conflict.values,wording:'Happy Birthday Sara'}});const accepted={version:1,data:correction,source_fingerprint:conflict.fingerprint,confirmed:true,updated_by:'admin'};
assert.equal((await taskReadiness(source,order,context,accepted)).status,'ready');
assert((await taskReadiness(source,order,{...context,bindings:[{id:'chat-a',usable:true,revision:'2'}]},accepted)).expired);
assert.equal((await taskReadiness(source,order,{unavailable:true},accepted)).can_confirm,false);
assert.equal((await taskReadiness({...source,mapping_status:'conflict'},null)).can_confirm,false);
const multi={...order,items:[...order.items,{id:'item-b',title:'Custom acrylic',sku:'AC02',quantity:1,size:'A7'}],production_tasks:[...order.production_tasks,{id:'task-b',detail:{sku:'AC02',customize_name:'Sara'}}]};
const isolated=await taskReadiness(source,multi,context);assert.equal(isolated.values.wording,'Happy Birthday Aina');assert(!JSON.stringify(isolated.values).includes('Sara'));
const specifications={bindings:[{id:'chat-a',usable:true,revision:'spec-1'}],messages:[{id:'spec-1',channel:'whatsapp',conversation_id:'chat-a',direction:'inbound',text_content:'Saiz: A7\nWarna: Silver\nMaterial: Acrylic\nQty: 1',created_at:'2026-10-19T09:00:00Z'}]};
const extracted=await taskReadiness({...source,title:'Acrylic'},order,specifications);assert.equal(extracted.values.colour,'Silver');assert.equal(extracted.values.quantity,'1');assert(extracted.conflicts.some(c=>c.field==='size'&&c.value==='A7'));assert(extracted.evidence.some(e=>e.id==='spec-1'));
const excludedSpecs=await taskReadiness({...source,title:'Acrylic'},multi,specifications);assert(!excludedSpecs.values.colour,'multi-item specifications cannot be assigned by position');
const unknown=await taskReadiness({...source,fields:{confirmed:true}},{...multi,production_tasks:multi.production_tasks.map(t=>({...t,detail:{sku:t.detail.sku}}))},context);assert(!unknown.values.wording,'generic multi-item chat must not fill another set');
const two=await taskReadiness({...source,title:'2x A6 acrylic Gold'},null);assert(!two.missing.some(m=>m.key==='same_design'));assert.equal(two.status,'ready');
const twoForm=validateBrief({...two.form,same_design:true});assert((await taskReadiness({...source,title:'2x A6 acrylic Gold'},null,{},null,twoForm)).can_confirm);
assert(!(await taskReadiness({...source,title:'5 × 5 inch'},null)).values.quantity,'dimensions must not become quantities');
const countedRound=await taskReadiness({...source,title:'1x 5 inch Round'},null);assert.equal(countedRound.values.quantity,'1');assert.equal(countedRound.values.size,'5 inch');
const imageSource={...source,title:'1x 5 inch Round / Bulat',status:'design edible image',fields:{confirmed:true}};
const imageOrder={items:[{id:'image-a',title:'Edible Image',size:'5 inch',quantity:1}],production_tasks:[{id:'task-a',detail:{}}],state:{data:{}}};
const imageContext={bindings:[{id:'chat-a',usable:true,revision:'image-1'}],messages:[{id:'image1',conversation_id:'chat-a',direction:'inbound',message_type:'image',caption:'Guna gambar ini',media_url:'https://example.com/original.jpg',created_at:'2026-10-19T09:00:00Z'}]};
const image=await taskReadiness(imageSource,imageOrder,imageContext);assert.equal(image.status,'ready');assert.equal(image.values.artwork,'https://example.com/original.jpg');
for(const changed of [{caption:'Resit payment'},{is_history:true},{direction:'outbound'},{conversation_id:'different-chat'}]){const r=await taskReadiness(imageSource,imageOrder,{...imageContext,messages:[{...imageContext.messages[0],...changed}]});assert(!r.values.artwork);assert.notEqual(r.status,'ready');}
const privateURL='wasapflow-media://123456',privateContext={...imageContext,messages:[{...imageContext.messages[0],media_url:privateURL}]};
const inaccessible=await taskReadiness(imageSource,imageOrder,privateContext);assert.equal(inaccessible.status,'ready');assert.equal(inaccessible.completeness,100);assert(inaccessible.asset_warning);
const accessible=await taskReadiness(imageSource,imageOrder,{...privateContext,media_access:{[privateURL]:{available:true,url:'https://private.example/signed-a'}}});assert.equal(accessible.status,'ready');
const renewed=await taskReadiness(imageSource,imageOrder,{...privateContext,media_access:{[privateURL]:{available:true,url:'https://private.example/signed-b'}}});assert.equal(accessible.fingerprint,renewed.fingerprint,'URL signing must not expire the confirmation');
const file={id:'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',mime:'image/png',name:'final.png'};
const printSource={...source,files:[file],component:{review_required:true,review_status:'pending'}};
const preview=await taskReadiness(printSource,null);const printForm={...preview.form,final_file_id:file.id,artwork_qc:true,customer_approved:true};
const printed=await taskReadiness(printSource,null,{}, {version:1,data:printForm,source_fingerprint:preview.fingerprint,confirmed:true,updated_by:'admin'});assert(printed.print_ready);
assert(!(await taskReadiness(printSource,null,{}, {version:1,data:{...printForm,customer_approved:false},source_fingerprint:preview.fingerprint,confirmed:true})).print_ready);
assert(!(await taskReadiness({...source,order_status:'SHIPPED'},null)).can_confirm);
for(const value of ['javascript:alert(1)','data:image/png;base64,x','http://unsafe.example'])assert.throws(()=>validateBrief({values:{artwork:value}}));
assert.throws(()=>validateBrief({values:{quantity:'0'}}));assert.throws(()=>validateBrief({values:{product:'guess'}}));assert.throws(()=>validateBrief({values:{unknown:'x'}}));
// Exercise the real narrow source adapter: no global chat scan for automatic sessions, fail closed on unavailable Inbox.
const originalFetch=globalThis.fetch;let fail=false,focusReads=0,requested=[];
globalThis.fetch=async(_url,options)=>{const b=JSON.parse(options.body);if(b.action==='focus')focusReads++;if(fail)throw Error('Inbox down');assert.equal(b.action,'context');assert.equal(b.orders[0].reference,'ORDER-A');return Response.json({ok:true,contexts:{'icetak:aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa':context}});};
const row={...source,order_id:'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'};
const rpc=async(name,body)=>{requested.push(name);if(name==='icetak_task_readiness_sources')return {sources:{'task-a':source},briefs:{}};if(name==='icetak_customer_focus_orders')return {orders:[{...order,kind:'icetak',id:row.order_id,reference:'ORDER-A'}],states:{}};if(name==='icetak_order_detail_sources')return {tasks:{'task-a':{sku:'AC01',customize_name:'Happy Birthday Aina',confirmed:true}},links:{}};throw Error('Unexpected RPC '+name);};
try{const loaded=await loadReadiness([row],rpc,async()=>[{setting_value:'private-bridge-token'}]);assert(loaded['task-a'].readiness);assert.equal(focusReads,0);fail=true;const failed=await loadReadiness([row],rpc,async()=>[{setting_value:'private-bridge-token'}]);assert.equal(failed['task-a'].readiness.can_confirm,false);assert.equal(failed['task-a'].readiness.status,'review');}finally{globalThis.fetch=originalFetch;}
let mediaHandler,mediaMime='image/png';
const mediaCode=readFileSync('supabase/inbox-functions/task-brief-media/index.ts','utf8').replace(/^import .*;\n/gm,'');
await new Function('Deno','fetch',`return (async()=>{${stripTypeScriptTypes(mediaCode)}})()` )({env:{get:k=>k==='SUPABASE_URL'?'https://inbox.qa':'secret'},serve:fn=>mediaHandler=fn},async(url)=>{
 if(url.includes('private_runtime_settings?'))return Response.json([{setting_value:'bridge-secret'}]);
 if(url.includes('/message_media?'))return Response.json([{storage_path:'incoming/2026/original.png',mime_type:mediaMime}]);
 if(url.includes('/storage/v1/object/sign/whatsapp-media/'))return Response.json({signedURL:'/object/sign/whatsapp-media/original.png?token=signed'});
 if(url.includes('/rpc/icetak_task_brief_context'))return Response.json({'order-a':{bindings:[],messages:[]}});
 throw Error('Unexpected media route');
});
const mediaRequest=(ids,token='bridge-secret')=>mediaHandler(new Request('https://qa.media',{method:'POST',headers:{'x-admin-window-token':token,'content-type':'application/json'},body:JSON.stringify({ids})}));
assert.equal((await mediaRequest(['123'],'invalid')).status,401);assert.equal((await mediaRequest(['../secret'])).status,400);
const signedMedia=await (await mediaRequest(['123'])).json();assert.equal(signedMedia.media['wasapflow-media://123'].available,true);assert(!JSON.stringify(signedMedia).includes('bridge-secret'));
const contextRequest=orders=>mediaHandler(new Request('https://qa.media',{method:'POST',headers:{'x-admin-window-token':'bridge-secret','content-type':'application/json'},body:JSON.stringify({action:'context',orders})}));
assert.equal((await contextRequest([])).status,400);assert.equal((await contextRequest(Array(51).fill({}))).status,400);
assert.deepEqual((await (await contextRequest([{key:'order-a'}])).json()).contexts,{'order-a':{bindings:[],messages:[]}});
mediaMime='application/pdf';assert.equal((await (await mediaRequest(['123'])).json()).media['wasapflow-media://123'].available,false);
// Owner's simple product rules: customer content is confirmation; no checkbox/name+age/spec gates.
const simpleSource=kind=>({task_id:'simple',title:kind,status:kind==='topper'?'design editing -topper':kind==='edible'?'design edible image':kind==='wafer'?'wafer paper':'acrylic',fields:{confirmed:false},files:[],sets:['set1'],source_updated_at:'2026-10-19T10:00:00Z'});
const simpleOrder=(kind,note='')=>({items:[{id:'one',title:kind,quantity:1,size:'5 inch Round'}],production_tasks:[{id:'simple',detail:{}}],order_note:note,created_at:'2026-10-19T10:00:00Z'});
const simpleChat=(messages)=>({bindings:[{id:'customer',usable:true,start_at:'2026-10-18T10:00:00Z',end_at:null}],messages:messages.map((m,n)=>({id:'simple-'+n,channel:'whatsapp',conversation_id:'customer',direction:'inbound',created_at:n?'2026-10-19T11:01:00Z':'2026-10-19T11:00:00Z',...m}))});
for(const wording of ['Aina','7','Aina\n7','Nama: Aina\nUmur: 7','Happy Birthday Aina','Selamat Bertunang\nAli & Iqa','25/10/2026']){
 const r=await taskReadiness(simpleSource('topper'),simpleOrder('topper',wording));assert.equal(r.status,'ready',wording);assert.equal(r.completeness,100);assert.match(r.confirmed_by,/Sistem/);
}
for(const wording of ['ok','Terima kasih','Nak order','Bila sampai?','2 pcs','RM25','0123456789','Hi kak','Assalamualaikum sis','Thanks sis','Okay done','Yes please'])assert.notEqual((await taskReadiness(simpleSource('topper'),simpleOrder('topper',wording))).status,'ready',wording+' is not customization');
for(const kind of ['edible','wafer','acrylic'])for(const variant of ['wording','image','both']){
 const messages=[];if(variant!=='wording')messages.push({message_type:'image',media_url:'https://example.com/customer-original.png',caption:''});if(variant!=='image')messages.push({message_type:'text',text_content:'Aisyah'});
 const r=await taskReadiness(simpleSource(kind),simpleOrder(kind),simpleChat(messages));assert.equal(r.status,'ready',kind+' '+variant);assert.equal(r.completeness,100);assert.equal(r.values.mode,variant==='both'?'image_wording':variant==='image'?'image':'wording');
}
const beforeOrder=await taskReadiness(simpleSource('topper'),simpleOrder('topper'),simpleChat([{message_type:'text',text_content:'Umar 3 tahun',created_at:'2026-10-19T09:00:00Z'}]));assert.equal(beforeOrder.status,'ready');assert.equal(beforeOrder.values.age,'3');
const outside=await taskReadiness(simpleSource('topper'),simpleOrder('topper'),simpleChat([{message_type:'text',text_content:'Old Customer',created_at:'2026-10-17T09:00:00Z'}]));assert.notEqual(outside.status,'ready');
const example=await taskReadiness(simpleSource('acrylic'),simpleOrder('acrylic'),simpleChat([{message_type:'image',media_url:'https://example.com/example.png',caption:'Contoh'}, {message_type:'text',text_content:'Ali & Iqa'}]));assert.equal(example.status,'ready');assert.equal(example.values.mode,'image_wording');
const several=await taskReadiness(simpleSource('edible'),simpleOrder('edible'),simpleChat([{message_type:'image',media_url:'https://example.com/a.png'},{message_type:'image',media_url:'https://example.com/b.png'}]));assert.equal(several.status,'review');
const receipt=await taskReadiness(simpleSource('edible'),simpleOrder('edible'),simpleChat([{message_type:'text',text_content:'Saya dah bayar'},{message_type:'image',media_url:'https://example.com/receipt.png'}]));assert.notEqual(receipt.status,'ready');
const clearCorrection=await taskReadiness(simpleSource('topper'),simpleOrder('topper','Nama: Aina'),simpleChat([{message_type:'text',text_content:'Tukar wording kepada Aisyah'}]));assert.equal(clearCorrection.status,'ready');assert.equal(clearCorrection.values.wording,'Aisyah');
const uncertainChoice=await taskReadiness(simpleSource('topper'),simpleOrder('topper'),simpleChat([{message_type:'text',text_content:'Nama: Aina atau Sara'}]));assert.equal(uncertainChoice.status,'review');
const trustedGreeting=await taskReadiness({...simpleSource('acrylic'),fields:{'customize name':'Thank You'}},null);assert.equal(trustedGreeting.status,'ready');assert.equal(trustedGreeting.values.wording,'Thank You');
const firstNote=await taskReadiness(simpleSource('topper'),simpleOrder('topper','Aina'));const changedNote=await taskReadiness(simpleSource('topper'),simpleOrder('topper','Sara'));assert.notEqual(firstNote.fingerprint,changedNote.fingerprint,'checkout-note edits must invalidate saved briefs');
const checkoutImage=await taskReadiness({...simpleSource('edible'),item:{id:'one',customization:{reference_url:'https://example.com/checkout.png'}}},simpleOrder('edible'));assert.equal(checkoutImage.status,'ready');assert.equal(checkoutImage.values.artwork,'https://example.com/checkout.png');
const withInstructions=await taskReadiness({...simpleSource('edible'),fields:{noted:'Siapkan petang ini'}},simpleOrder('edible'),simpleChat([{message_type:'image',media_url:'https://example.com/art.png'},{message_type:'text',text_content:'Background warna pink, crop gambar'}]));assert.equal(withInstructions.status,'ready');assert.match(withInstructions.values.instructions,/Background warna pink/);assert.match(withInstructions.values.instructions,/Siapkan petang ini/);
console.log('PASS simple task rules: topper note/name/age/date; before/after-order scoped chat; edible/wafer/acrylic image-only, text-only and both; caption-free and reference artwork; no Confirmed/paired-age/spec/same-design gate; clear corrections; actual uncertainty/receipts/old boundaries blocked; existing permissions, source/version/native QC guards retained.');
