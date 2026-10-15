import assert from 'node:assert/strict';
import {markShopeeRead} from '../supabase/inbox-functions/_shared/shopee-read.ts';
const config={shop_id:'1',partner_id:'2',partner_key:'fixture',access_token:'fixture'};
const conversation={id:'local',external_conversation_id:'808404658911303848'};
let readBody={},checkBody={},calls=[],logs=[],auditError=false,transportError=false;
const db={from:()=>({insert:async row=>{assert.ok(!('actor_id' in row));assert.ok(['user','integration'].includes(row.actor_type));logs.push(row);return {error:auditError?{message:'fixture'}:null}}})};
globalThis.fetch=async(url,opts)=>{const path=new URL(url).pathname;calls.push({path,body:opts.body});if(transportError)throw Error('fixture');return Response.json(path.endsWith('/read_conversation')?readBody:checkBody)};
async function run({unread=0,last='snapshot',responseId=conversation.external_conversation_id,read={},checkError=false,missing=false,audit=false,transport=false,actor=null}={}){
 calls=[];logs=[];auditError=audit;transportError=transport;readBody=read;checkBody=checkError?{error:'fixture'}:{response:{conversation_id:responseId,unread_count:unread,last_read_message_id:last}};
 return markShopeeRead(db,config,conversation,missing?'':'snapshot',{id:actor,label:'Fixture'});
}
let result=await run();assert.deepEqual(result,{confirmed:true,code:'READ_CONFIRMED',auditRecorded:true});assert.equal(logs[0].actor_type,'integration');assert.equal(logs[0].metadata.provider_unread_count,0);
assert.match(calls[0].body,/"conversation_id":808404658911303848/);assert.match(calls[0].body,/"last_read_message_id":"snapshot"/);
result=await run({actor:'staff-id',unread:2});assert.equal(result.confirmed,true);assert.equal(logs[0].actor_user_id,'staff-id');assert.equal(logs[0].actor_type,'user');
result=await run({unread:2,last:'older'});assert.equal(result.confirmed,false);assert.equal(result.code,'READ_UNCONFIRMED');
result=await run({unread:undefined,last:'older'}); // explicit missing response tested below
checkBody={response:{conversation_id:conversation.external_conversation_id}};result=await markShopeeRead(db,config,conversation,'snapshot',{id:null,label:'Fixture'});assert.equal(result.confirmed,false);
result=await run({responseId:'other'});assert.equal(result.confirmed,false);
result=await run({read:{error:'rejected'}});assert.equal(result.code,'READ_REJECTED');assert.equal(calls.length,1);
result=await run({checkError:true});assert.equal(result.confirmed,false);
result=await run({missing:true});assert.equal(result.code,'READ_MESSAGE_MISSING');assert.equal(calls.length,0);assert.equal(logs.length,1);
result=await run({transport:true});assert.equal(result.code,'READ_UNKNOWN');assert.equal(logs[0].event_type,'shopee_read_sync_failed');
result=await run({audit:true});assert.equal(result.confirmed,true);assert.equal(result.auditRecorded,false);
console.log('PASS: exact int64 payload, provider readback, concurrent unread retention, stale/missing/wrong conversation rejection, API/transport failures, missing snapshot audit, real audit schema fields and audit failure reporting');
