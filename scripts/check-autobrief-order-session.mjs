import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(readFileSync('supabase/functions/clickup-order-brief/index.ts','utf8').replace(/^import .*;\n/gm,''));
const key='shopee:aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',placed='2026-11-03T12:20:16Z',cid='current-session';
const binding={id:cid,usable:true,channel:'shopee',source:'shopee_session',start_at:'2026-11-03T09:15:22Z',boundary_at:'2026-11-03T09:15:22Z',end_at:null};
let context,calls;
const api=new Function('Deno','fetch',source+';return {loadChat};')({env:{get:()=>''},serve:()=>{}},async(url,opts)=>{
 const b=JSON.parse(opts.body);calls.push(b.action);
 if(b.action==='order_proof')return Response.json({ok:true,matched:false,reason:'MULTIPLE_LINKED_ORDERS'});
 assert.equal(b.action,'context');assert.equal(b.orders[0].reference,'261103BUKV70BA');
 return Response.json({ok:true,contexts:{[key]:context}});
});
const run=()=>{calls=[];return api.loadChat(placed,'47813508','',key,'261103BUKV70BA','synthetic');};
context={bindings:[binding],messages:[{id:'old',conversation_id:cid,created_at:'2026-11-03T09:00:00Z'},{id:'current',conversation_id:cid,created_at:'2026-11-03T12:30:00Z'},{id:'wrong',conversation_id:'other',created_at:'2026-11-03T12:30:00Z'}],ambiguous:false,truncated:false};
let out=await run();assert.deepEqual(calls,['order_proof','context']);assert.equal(out.evidence_source,'scoped_order_session');assert.deepEqual(out.messages.map(x=>x.id),['current']);
for(const change of [
 {ambiguous:true},{truncated:true},{unavailable:true},{bindings:[]},
 {bindings:[binding,{...binding,id:'second'}]},
 {bindings:[{...binding,usable:false}]},
 {bindings:[{...binding,source:'buyer_identity'}]},
 {bindings:[{...binding,channel:'whatsapp'}]},
 {bindings:[{...binding,start_at:'2026-11-03T12:30:00Z'}]},
 {bindings:[{...binding,end_at:'2026-11-03T12:00:00Z'}]},
 {bindings:[{...binding,boundary_at:'2026-11-03T12:30:00Z'}]}
]){context={bindings:[binding],messages:[],ambiguous:false,truncated:false,...change};out=await run();assert.equal(out.ambiguous,true,JSON.stringify(change));assert.notEqual(out.evidence_source,'scoped_order_session');}
console.log('PASS historical/cancelled links resolve only through one authoritative usable current Shopee session; real ambiguity/truncation/identity/closed boundaries remain blocked.');
