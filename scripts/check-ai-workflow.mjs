import assert from 'node:assert/strict';
import { analyze } from '../supabase/functions/admin-ai-dashboard/analysis.ts';
import { sessionKey } from '../supabase/functions/admin-ai-dashboard/case.ts';
import { enrichContexts } from '../supabase/functions/admin-ai-dashboard/enrich.ts';
import { workQueue } from '../icetak-admin/src/components/ai-dashboard/workQueue.ts';
import { refreshSnapshot } from '../icetak-admin/src/components/ai-dashboard/refresh.ts';
const now=Date.parse('2026-09-23T12:00:00Z');
const c={id:'conversation',channel:'whatsapp',inbound_revision:'rev',last_inbound_at:'2026-09-23T09:00:00Z',messages:[{direction:'inbound',message_type:'text',text_content:'design saiz berapa',created_at:'2026-09-23T08:00:00Z'},{direction:'outbound',message_type:'text',text_content:'Maklumat produk',created_at:'2026-09-23T08:30:00Z'},{direction:'inbound',message_type:'text',text_content:'Ok baik terima kasih 🙏',created_at:'2026-09-23T09:00:00Z'}]};
const orderId='11111111-1111-4111-8111-111111111111',draftId='22222222-2222-4222-8222-222222222222';
const base={identity_status:'matched',session:{session_id:'session'},orders:[{id:orderId,order_no:'IC-TEST',status:'Ready to Process',payment_status:'paid'}],marketplace_orders:[],drafts:[]};
const bound=(ctx)=>({...ctx,case_order:{order_id:orderId,order_kind:'icetak',inbound_revision:'rev',session_key:sessionKey(ctx)}});
const check=(ctx,chat=c)=>analyze(chat,ctx,null,now);
let a=check(base);
assert.equal(a.acknowledgement,true);assert.equal(a.intent,'other');assert.equal(a.suggestion,'');assert.equal(a.status,'needs_review');assert.equal(a.case.request,'Ok baik terima kasih 🙏');assert.equal(workQueue({analysis:a,context:base},now).key,'review');
const complaint={...c,messages:[{...c.messages[2],text_content:'Thanks tapi parcel rosak'}]};
assert.equal(check(base,complaint).intent,'complaint');assert.equal(check(base,complaint).acknowledgement,false);
for(const [status,title] of [['pending','Semak review artwork'],['waiting_customer_review','Semak kelulusan pelanggan']]){
 const ctx=bound({...base,orders:[{...base.orders[0],production_reviews:[{review_required:true,review_status:status}]}]});
 assert.equal(check(ctx).case.title,title);assert.equal(check(ctx).workflow.decision,true);
 assert.equal(check({...ctx,case_order:null}).case.title,'Semak penutup perbualan','Unconfirmed order cannot choose case action');
 assert.equal(check(ctx,complaint).case.title,'Selesaikan aduan','Review task must not suppress complaint');
}
for(const [status,payment,title] of [['Ready to Process','pending','Semak bayaran tertunggak'],['Ready for Pickup','paid','Order sedia untuk pickup']]){
 assert.equal(check(bound({...base,orders:[{...base.orders[0],status,payment_status:payment}]})).case.title,title);
}
for(const status of ['Shipped','Completed','Customer Collected']){
 const ctx=bound({...base,orders:[{...base.orders[0],status,payment_status:'paid'}]});
 assert.equal(check(ctx,complaint).status,'needs_review');assert.equal(check(ctx,complaint).case.title,'Selesaikan aduan');
 const shipping={...c,messages:[{...c.messages[2],text_content:'parcel mana?'}]};
 assert.match(check(ctx,shipping).case.title,/tracking|selepas order/);
}
assert.notEqual(check(bound({...base,orders:[{...base.orders[0],status:'Completed',fulfillment_stage:'READY_FOR_PICKUP'}]})).case.title,'Order sedia untuk pickup','Closed status wins over stale pickup stage');
const draft={id:draftId,order_session_id:'session',status:'awaiting_payment',payment_status:'unpaid',updated_at:'2026-09-23T10:00:00Z',followup_enabled:true,customer_link_sent_at:'2026-09-23T10:00:00Z',next_followup_at:'2026-09-23T11:00:00Z'};
const draftCtx={...base,drafts:[draft],review:{status:'waiting_customer',inbound_revision:'rev',updated_at:'2026-09-23T10:00:00Z'}};
a=check(draftCtx);assert.equal(a.workflow.followup_due,true);assert.equal(a.status,'needs_review');assert.equal(a.case.title,'Follow-up sudah tiba');
assert.equal(check({...draftCtx,review:{...draftCtx.review,status:'resolved'}}).status,'resolved','Manual close is not undone by polling');
assert.equal(check({...draftCtx,review:{...draftCtx.review,updated_at:'2026-09-23T11:30:00Z'}}).status,'waiting_customer','Reviewed due task must not reopen endlessly');
for(const change of [{order_id:orderId},{order_no:'IC-TEST'},{status:'confirmed'},{followup_enabled:false},{customer_responded_at:'2026-09-23T11:15:00Z'},{next_followup_at:'2026-09-24T00:00:00Z'}])assert.equal(check({...draftCtx,drafts:[{...draft,...change}]}).workflow.followup_due,false);
assert.equal(check({...draftCtx,identity_status:'ambiguous'}).workflow.followup_due,false);
assert.equal(check(draftCtx,{...c,last_inbound_at:'2026-09-23T11:30:00Z'}).workflow.followup_due,false);
// The real gateway enrichment contract: scoped IDs, pagination, converted draft, current session.
const contexts={one:structuredClone({...base,drafts:[draft]})};let paths=[];
await enrichContexts(contexts,async path=>{paths.push(path);if(path.startsWith('production_components'))return path.endsWith('offset=0')?Array.from({length:500},(_,i)=>({id:String(i),order_id:orderId,review_required:true,review_status:'pending'})):[{id:'501',order_id:orderId,review_status:'approved'}];return [{...draft,order_id:orderId,status:'confirmed'}];});
assert.equal(contexts.one.orders[0].production_reviews.length,501);assert.equal(check(contexts.one).workflow.followup_due,false);assert.ok(contexts.one.workflow_checked_at);assert.equal(paths.length,3);assert.ok(paths.every(p=>!p.includes('undefined')));
await enrichContexts({x:{...base,identity_status:'ambiguous'}},async()=>{throw Error('Ambiguous IDs must not be queried');});
// Refresh cancellation must retain old UI/composer, including editing during a request.
let safe=true,calls=0;
const cancelled=await refreshSnapshot(async()=>{calls++;safe=false;return {rows:[],has_more:true};},()=>safe,{channel:'',search:'',count:60,selectedId:'selected'});
assert.equal(cancelled,null);assert.equal(calls,1);
const refreshed=await refreshSnapshot(async b=>b.action==='detail'?{row:{id:'30',value:'fresh'},events:[]}:{rows:Array.from({length:30},(_,i)=>({id:String(b.offset+i)})),has_more:b.offset===0},()=>true,{channel:'',search:'',count:60,selectedId:'30'});
assert.equal(refreshed.rows.length,60);assert.equal(refreshed.rows[30].value,'fresh');assert.equal(refreshed.offset,60);assert.equal(refreshed.has_more,false);
console.log('PASS: acknowledgement, complaint precedence, confirmed review/payment/pickup/shipping, draft lifecycle, scheduled follow-up/review state, scoped enrichment/pagination and refresh edit cancellation.');
