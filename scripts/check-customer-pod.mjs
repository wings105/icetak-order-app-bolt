import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
const source=fs.readFileSync('supabase/functions/api/customer-pod.ts','utf8').replace('export async function','async function');
async function run({claim=true,status='delivered',identity=true,host='parceldaily-proofofdelivery.s3.ap-southeast-1.amazonaws.com',valid=true}={}) {
 const calls=[],writes=[];let recover;
 const db=async(path,init)=>{writes.push({path,init});return path.includes('claim')?claim:[];};
 const scope={Deno:{env:{get:()=> 'qa-provider'}},fetch:async(url,init)=>{calls.push(String(url));if(String(url).includes('/partner/orders'))return Response.json({data:[{consign_no:identity?'MY123B':'WRONG',orderId:'order',statusGroup:'Delivered',pod:[`https://${host}/pod.jpg`]}]});if(String(url).includes('/storage/'))return Response.json({});return new Response(new Uint8Array(valid?[255,216,255,1,2,3]:[1,2,3]));},crypto,URL,Response,AbortSignal,Uint8Array,Date};
 vm.createContext(scope);vm.runInContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None})+'\nthis.recover=recoverCustomerPod;',scope);recover=scope.recover;
 await recover({id:'shipment',provider:'parceldaily',normalized_status:status,tracking_no:'MY123B',provider_order_id:'order'},db,'https://qa.invalid','qa-key');return {calls,writes};
}
let r=await run();assert.equal(r.calls.length,3);const row=JSON.parse(r.writes.find(x=>x.path.startsWith('shipment_pod_files')).init.body);assert.equal(row.archive_status,'archived_storage');assert.equal(row.content_type,'image/jpeg');assert.equal(row.shipment_id,'shipment');
for(const options of [{claim:false},{status:'in_transit'},{identity:false},{host:'127.0.0.1'},{valid:false}]){r=await run(options);assert.ok(!r.writes.some(x=>x.path.startsWith('shipment_pod_files')));}
console.log('PASS: actual POD recovery downloaded bytes/private archive; delivered, lease, exact identity, allowed host and file signature guards');
const ui=fs.readFileSync('src/customer-portal.ts','utf8');const start=ui.indexOf('function renderShipment('),end=ui.indexOf('\nfunction renderOrder(',start);const scope={escapeHtml:x=>String(x).replaceAll('"','&quot;')};vm.createContext(scope);vm.runInContext(ts.transpile(fs.readFileSync('src/courier-icons.ts','utf8').replace(/^export /gm,''),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}),scope);vm.runInContext(ts.transpile(ui.slice(start,end),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None})+'\nthis.render=renderShipment;',scope);
const shipment={tracking:'MY123B',statusGroup:'delivered',status:'Delivered',pods:[{position:1,contentType:'image/jpeg',url:'https://qa.invalid/pod'}]};let html=scope.render({shipment});assert.ok(html.includes('Proof of Delivery')&&html.includes('POD1')&&html.includes('aria-haspopup="dialog"')&&!html.includes('cp-pod-grid'));
html=scope.render({shipment:{...shipment,pods:[]}});assert.ok(html.includes('belum tersedia'));
html=scope.render({shipment:{...shipment,statusGroup:'in_transit'}});assert.ok(!html.includes('Proof of Delivery'));
console.log('PASS: actual customer shipment renderer delivered gallery, empty state and in-transit exclusion');
const pickup={delivery:'Pickup',status:'Ready for Pickup',payment:'Paid'};
html=scope.render(pickup);assert.ok(html.includes('data-cp-pickup-box'));assert.ok(html.includes('https://swiy.co/decocakePP'));assert.ok(html.includes('9am–7.00pm')&&html.includes('Sabtu–Khamis'));assert.ok(html.includes('ambil bungkusan milik anda sahaja'));
html=scope.render({...pickup,payment:'Unpaid'});assert.ok(!html.includes('data-cp-pickup-box'));
html=scope.render({...pickup,payment:'Unpaid',paymentStatus:'pending_review'});assert.ok(!html.includes('data-cp-pickup-box'));
html=scope.render({...pickup,status:'In Production'});assert.ok(html.includes('Sila tunggu status siap sebelum datang'));
html=scope.render({...pickup,status:'Completed'});assert.ok(!html.includes('Order anda sudah dibayar dan sedia'));
console.log('PASS: pickup location/hours, confirmed-paid-only BOX, unpaid/pending exclusion and ready/collected guidance');
