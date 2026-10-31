import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const load=async path=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(readFileSync(path,'utf8'))).toString('base64'));
const {normalize,stable}=await load('supabase/functions/shopee-finance-ingest/normalize.ts');
const {prepareReleaseCursor,finishReleaseCursor}=await load('supabase/functions/shopee-financial-enrich/release-cursor.ts');
let handler,reads=[],saves=[],failures=[],finishes=[],mismatch=false,fail=false,persistFail=false;
const row={order_sn:'QA_REFUND',return_sn:'QA_RETURN',shop_id:'188218638',currency:'MYR'};
const fetcher=async(url,init)=>{
 const path=new URL(url).pathname,b=init?.body?JSON.parse(init.body):{};
 if(path.endsWith('/private_runtime_settings'))return Response.json([{setting_value:'fixture-bridge'}]);
 if(path.endsWith('/claim_marketplace_finance_maintenance'))return Response.json(true);
 if(path.endsWith('/marketplace_returns_pending'))return Response.json([row]);
 if(path.endsWith('/finish_marketplace_finance_maintenance')){finishes.push(b);return Response.json({saved:true});}
 if(path.endsWith('/marketplace_return_read_failed')){failures.push(b);return Response.json(null);}
 if(path.endsWith('/marketplace_finance_runtime')){
  if(b.p_action==='cursor')return Response.json({next_at:'2099-01-01T00:00:00Z'});
  assert.equal(b.p_action,'return_detail');
  if(persistFail)return Response.json({error:'fixture'},{status:500});
  saves.push(b);return Response.json({saved:true,finance_refreshed:true});
 }
 if(path.endsWith('/shopee-finance-fetch')){
  reads.push(b.action);if(fail&&b.action==='escrow')return Response.json({ok:false,error:'TOKEN_EXPIRED'},{status:409});
  return Response.json({ok:true,response:b.action==='return'?{...row,status:'ACCEPTED',refund_amount:10,order_sn:mismatch?'WRONG_ORDER':row.order_sn}:{order_sn:row.order_sn,order_income:{escrow_amount:-5.19,seller_return_refund:-10,commission_fee:0,service_fee:0,seller_transaction_fee:0}}});
 }
 throw Error('Unexpected request '+path);
};
const code=stripTypeScriptTypes(readFileSync('supabase/functions/shopee-financial-enrich/index.ts','utf8').replace(/^import .*;$/gm,''));
new Function('Deno','fetch','normalize','stable','prepareReleaseCursor','finishReleaseCursor',code)(
 {env:{get:n=>n==='SUPABASE_URL'?'https://fixture.supabase.co':'fixture-service'},serve:fn=>handler=fn},fetcher,normalize,stable,prepareReleaseCursor,finishReleaseCursor);
const request=()=>new Request('https://fixture.example',{method:'POST',headers:{'x-admin-window-token':'fixture-bridge'},body:JSON.stringify({mode:'maintenance',shop_id:row.shop_id})});
assert.equal((await handler(new Request('https://fixture.example',{method:'POST'}))).status,401);assert.equal(reads.length,0);
let response=await (await handler(request())).json();
assert.equal(response.provider_reads,2);assert.equal(response.applied,1);assert.deepEqual(reads.sort(),['escrow','return']);
assert.equal(saves[0].p_body.finance_events.length,1);const event=saves[0].p_body.finance_events[0];
assert.equal(event.normalized_data.escrow_amount,'-5.19');assert.equal(event.normalized_data.released_amount,undefined);
await handler(request());assert.equal(saves[1].p_body.finance_events[0].payload_hash,event.payload_hash,'Retry changed finance identity');
mismatch=true;await handler(request());assert.equal(saves.length,2);assert.equal(failures.at(-1).p_error,'RETURN_IDENTITY_MISMATCH');
mismatch=false;fail=true;await handler(request());assert.equal(saves.length,2);assert.equal(failures.at(-1).p_error,'TOKEN_EXPIRED');
fail=false;persistFail=true;await handler(request());assert.equal(failures.at(-1).p_error,'DATABASE_500');assert.equal(finishes.at(-1).p_error,'DATABASE_500');
console.log('Refund worker: paired API refresh, atomic persist, retry identity, no invented release, mismatch/auth/API/storage failures passed.');
