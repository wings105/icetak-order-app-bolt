import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const load=async path=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(readFileSync(path,'utf8'))).toString('base64'));
const {normalize,stable}=await load('supabase/functions/shopee-finance-ingest/normalize.ts');
const {prepareReleaseCursor,finishReleaseCursor}=await load('supabase/functions/shopee-financial-enrich/release-cursor.ts');
const fixture={order_sn:'QA20261030FIN',shop_id:'188218638',currency:'MYR',order_income:{order_discounted_price:36,
 escrow_amount:27.2,commission_fee:6,service_fee:2,seller_transaction_fee:0.7,credit_card_transaction_fee:0.7,
 ads_escrow_top_up_fee_or_technical_support_fee:0.1,campaign_fee:0,order_ams_commission_fee:0,shipping_seller_protection_fee_amount:0,
 items:[{quantity_purchased:2,discounted_price:0}]},buyer_payment_info:{buyer_total_amount:40.9,shipping_fee:4.9}};
let n=normalize(fixture);assert.deepEqual(n.mapping_errors,[]);assert.equal(n.normalized_data.product_subtotal,'36');
assert.equal(n.normalized_data.buyer_paid,'40.9');assert.equal(n.normalized_data.shipping_fee,'4.9');
assert.equal(n.normalized_data.other_fees,'0.10000000');assert.equal(n.normalized_data.transaction_fee,'0.7');
assert.equal(n.normalized_data.fee_breakdown.credit_card_transaction_fee,'0.7');
assert.equal(n.normalized_data.released_amount,undefined);assert.equal(n.normalized_data.settlement_status,'pending_release');
assert.equal(normalize({...fixture,product_subtotal:0}).normalized_data.product_subtotal,'0');
assert.equal(normalize({order_sn:fixture.order_sn,escrow_amount:0}).normalized_data.product_subtotal,undefined);
const unknown=normalize({order_sn:fixture.order_sn,escrow_amount:10,order_income:{new_provider_fee:0.5}});
assert.equal(unknown.normalized_data.fee_breakdown.new_provider_fee,'0.5');assert.equal(unknown.normalized_data.other_fees,undefined);
let handler,reads=0,claims=0,ingested=[],finished=[],mismatch=false,fail=false,persistFail=false;
const fetcher=async(url,init)=>{
 const path=new URL(url).pathname;const body=init?.body?JSON.parse(init.body):{};
 if(path.endsWith('/private_runtime_settings'))return Response.json([{setting_value:'fixture-bridge'}]);
 if(path.endsWith('/reconcile_marketplace_finance_jobs'))return Response.json({detail_enqueued:1});
 if(path.endsWith('/claim_marketplace_finance_jobs')){claims++;assert.equal(body.p_limit,3);return Response.json([{job_id:'fixture-job',lease_id:'lease-1',order_sn:fixture.order_sn,shop_id:fixture.shop_id,currency:'MYR',job_type:'financial_detail'}]);}
 if(path.endsWith('/shopee-finance-fetch')){reads++;assert.equal(body.action,'escrow');assert.equal(body.order_sn,fixture.order_sn);return fail?Response.json({ok:false,error:'TOKEN_EXPIRED'},{status:409}):Response.json({ok:true,response:{...fixture,order_sn:mismatch?'WRONGORDER':fixture.order_sn}});}
 if(path.endsWith('/ingest_shopee_finance')){ingested.push(body);return Response.json({applied:persistFail?0:1,needs_mapping:persistFail?1:0,pending_order:0});}
 if(path.endsWith('/finish_marketplace_finance_job')){finished.push(body);return Response.json({completed:!body.p_error,retry:!!body.p_error});}
 throw Error('Unexpected finance request '+path);
};
const code=stripTypeScriptTypes(readFileSync('supabase/functions/shopee-financial-enrich/index.ts','utf8').replace(/^import .*;$/gm,''));
new Function('Deno','fetch','normalize','stable','prepareReleaseCursor','finishReleaseCursor',code)(
 {env:{get:n=>n==='SUPABASE_URL'?'https://fixture.supabase.co':'fixture-service'},serve:fn=>handler=fn},fetcher,normalize,stable,prepareReleaseCursor,finishReleaseCursor);
const req=(headers={},body={})=>new Request('https://fixture.example',{method:'POST',headers,body:JSON.stringify(body)});
assert.equal((await handler(req())).status,401);assert.equal(reads,0);
assert.equal((await handler(req({'x-admin-window-token':'wrong'}))).status,401);assert.equal(reads,0);
let response=await handler(req({'x-admin-window-token':'fixture-bridge'},{limit:500}));
assert.equal(response.status,200);assert.equal(reads,1);assert.equal(claims,1);assert.equal(ingested.length,1);
assert.equal(ingested[0].p_events[0].normalized_data.product_subtotal,'36');assert.equal(finished[0].p_lease_id,'lease-1');assert.equal(finished[0].p_error,null);
// No financial row was mocked: the real handler still fetched escrow, fixing the empty-row skip.
mismatch=true;await handler(req({authorization:'Bearer fixture-service'}));assert.equal(ingested.length,1);assert.equal(finished.at(-1).p_error,'PROVIDER_ORDER_MISMATCH');
mismatch=false;fail=true;await handler(req({'x-admin-window-token':'fixture-bridge'}));assert.equal(finished.at(-1).p_error,'TOKEN_EXPIRED');
fail=false;persistFail=true;await handler(req({'x-admin-window-token':'fixture-bridge'}));assert.equal(finished.at(-1).p_error,'FINANCE_NOT_APPLIED');
console.log('Shopee finance lifecycle passed: actual empty-row API path, nested price/payment/fees, zero bundle prices, distinct fee aliases, no invented release, auth, cap, lease, API failure and failed ingestion retries.');
