import assert from 'node:assert/strict';
import {sendShopee} from '../supabase/inbox-functions/_shared/shopee-send.ts';
import {shopeeCard} from '../apps/inbox/src/lib/shopeeCards.ts';
const originalFetch=globalThis.fetch;
const conversation={id:'00000000-0000-4000-8000-000000000001',channel:'shopee',external_customer_id:'129377585',external_conversation_id:'555672496598681537',metadata:{shop_id:'188218638'}};
const product={id:'00000000-0000-4000-8000-000000000002',name:'Edible Image',image_url:'https://example.com/cover.png',price:6,currency:'MYR',metadata:{shop_id:'188218638',item_id:'43514960885'},external_product_id:'188218638:43514960885'};
const order={id:'00000000-0000-4000-8000-000000000003',order_no:'2610205Q0R9W6D',source_channel:'shopee',shop_id:'188218638',shopee_buyer_id:null,order_status:'READY_TO_SHIP',items:[]};
const config={partner_id:'123',partner_key:'fixture-key',access_token:'fixture-token',shop_id:'188218638',enabled:true,check_ok:true,credential_version:1,checked_credential_version:1,token_expires_at:'2099-01-01T00:00:00Z'};
let sends=[],updates=[],claims=new Map(),productAllowed=true,orderBuyer=conversation.external_customer_id,status='NORMAL',mode='success',claimFail=false,completions=0;
const db={from(table){const filters={};const chain={select(){return this},eq(k,v){filters[k]=v;return this},in(){return this},not(){return this},order(){return this},limit:async()=>({data:[]}),
 single:async()=>({data:conversation}),maybeSingle:async()=>({data:table==='external_order_summaries'?order:productAllowed&&filters['metadata->>shop_id']===product.metadata.shop_id?product:null}),
 update(v){updates.push({table,value:v});return this},insert:async()=>({error:null}),then(resolve,reject){return Promise.resolve({data:table==='private_runtime_settings'?[{setting_key:'shopee_chat_direct_config',setting_value:JSON.stringify(config)}]:null,error:null}).then(resolve,reject)}};return chain},
 rpc:async(name,args)=>{if(name==='complete_shopee_reply'){completions++;return {data:{}};}assert.equal(name,'claim_shopee_card_send');if(claimFail)return {error:{message:'claim failure'}};
 const existing=claims.get(args.p_request_id);if(existing)return {data:{claimed:false,attempt:existing}};
 assert.equal(args.p_card.shop_id,conversation.metadata.shop_id);assert.equal(args.p_type==='order'?args.p_card.order_sn:args.p_card.item_id,args.p_type==='order'?order.order_no:product.metadata.item_id);
 const attempt={id:'attempt',local_message_id:'local',status:'sending'};claims.set(args.p_request_id,attempt);updates.push({table:'atomic-card',value:args});return {data:{claimed:true,attempt}};}};
globalThis.fetch=async(url,init)=>{const u=new URL(url);
 if(u.pathname.endsWith('get_order_detail'))return Response.json({response:{order_list:[{order_sn:order.order_no,buyer_user_id:orderBuyer}]}});
 if(u.pathname.endsWith('get_item_base_info'))return Response.json({response:{item_list:[{item_id:product.metadata.item_id,item_status:status,item_name:'Provider Edible Image'}]}});
 if(u.pathname.endsWith('read_conversation'))return Response.json({});
 if(u.pathname.endsWith('get_one_conversation'))return Response.json({response:{conversation_id:conversation.external_conversation_id,unread_count:0}});
 assert(u.pathname.endsWith('send_message'));sends.push(JSON.parse(init.body));
 assert(updates.some(x=>x.table==='atomic-card'),'card must persist before external send');
 if(mode==='timeout')throw Error('timeout');
 if(mode==='rejected')return Response.json({error:'permission_denied'});
 return Response.json({response:{message_id:'provider-card-'+sends.length}});
};
let checked=0;
const actor={id:null,label:'QA owner'};
const body=(type,extra={})=>({message_type:type,conversation_id:conversation.id,request_id:crypto.randomUUID(),...(type==='order'?{order_summary_id:order.id}:{product_id:product.id}),...extra});
try{
 const orderBody=body('order');let response=await sendShopee(db,orderBody,actor),payload=await response.json();assert.equal(response.status,200);assert.equal(payload.card.order_sn,order.order_no);assert.equal(payload.card_type,'order');assert.deepEqual(sends.at(-1),{to_id:129377585,message_type:'order',content:{order_sn:order.order_no}});checked++;
 const attempt=claims.get(orderBody.request_id);attempt.status='sent';attempt.provider_message_id=payload.provider_message_id;const before=sends.length;response=await sendShopee(db,orderBody,actor);assert.equal(response.status,200);assert.equal((await response.json()).duplicate,true);assert.equal(sends.length,before);checked++;
 const productBody=body('product');response=await sendShopee(db,productBody,actor);payload=await response.json();assert.equal(response.status,200);assert.equal(payload.card.product_name,'Provider Edible Image');assert.deepEqual(sends.at(-1),{to_id:129377585,message_type:'item',content:{item_id:43514960885}});checked++;
 assert(shopeeCard('product',payload.card).title.includes('Edible'));assert.equal(shopeeCard('order',{order_sn:order.order_no}).fields[0].value,order.order_no);checked++;
 for(const type of ['order','product'])for(const extra of [{text:'mixed'},{sticker:{sticker_id:'02'}},{file:new File(['x'],'x.png',{type:'image/png'})}]){assert.equal((await sendShopee(db,body(type,extra),actor)).status,400);checked++;}
 let count=sends.length;orderBuyer='999';assert.equal((await sendShopee(db,body('order'),actor)).status,422);assert.equal(sends.length,count);orderBuyer=conversation.external_customer_id;checked++;
 order.shop_id='different';assert.equal((await sendShopee(db,body('order'),actor)).status,409);order.shop_id='188218638';checked++;
 productAllowed=false;assert.equal((await sendShopee(db,body('product'),actor)).status,422);productAllowed=true;checked++;
 for(const invalid of ['UNLIST','DELETED','BANNED']){status=invalid;assert.equal((await sendShopee(db,body('product'),actor)).status,422);assert.equal(sends.length,count);checked++;}status='NORMAL';
 assert.equal((await sendShopee(db,body('voucher'),actor)).status,400);assert.equal((await sendShopee(db,body('product',{product_id:'untrusted-item'}),actor)).status,422);checked+=2;
 const priorClaims=claims.size;claimFail=true;assert.equal((await sendShopee(db,body('product'),actor)).status,409);assert.equal(sends.length,count);assert.equal(claims.size,priorClaims);claimFail=false;checked++;
 mode='timeout';const uncertain=body('product');const priorCompletions=completions;response=await sendShopee(db,uncertain,actor);payload=await response.json();assert.equal(payload.status,'unknown');assert.equal(completions,priorCompletions);count=sends.length;claims.get(uncertain.request_id).status='unknown';await sendShopee(db,uncertain,actor);assert.equal(sends.length,count);checked++;
 mode='rejected';response=await sendShopee(db,body('product'),actor);assert.equal((await response.json()).status,'failed');assert.equal(completions,priorCompletions);checked++;
 assert(updates.some(x=>x.table==='shopee_chat_send_attempts'&&x.value.status==='sent'));assert(updates.some(x=>x.table==='messages'&&x.value.status==='sent'));checked++;
 console.log(`${checked} Shopee card checks passed: exact order/product payloads, provider buyer/status validation, wrong-shop/mixed-content denial, atomic snapshot, unknown/duplicate protection, persisted outcome and rendering.`);
}finally{globalThis.fetch=originalFetch;}
