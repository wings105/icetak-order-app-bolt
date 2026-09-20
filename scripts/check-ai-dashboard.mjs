// Node >=22 with --experimental-strip-types. No database or outbound side effects.
import assert from 'node:assert/strict';
import { sessionKey,confirmedOrder,caseSummary } from '../supabase/functions/admin-ai-dashboard/case.ts';
import { analyze,effectiveStatus,identity } from '../supabase/functions/admin-ai-dashboard/analysis.ts';
const now=Date.parse('2026-09-19T00:00:00Z');
const c={id:'fixture',channel:'shopee',inbound_revision:'in-1',legacy_needs_reply:false,last_inbound_at:'2026-09-18T07:05:00Z',messages:[
 {id:'m1',direction:'inbound',message_type:'text',text_content:'nak order initial A&F, kena bagi design sendiri atau bgtau huruf?',created_at:'2026-09-18T07:04:00Z'},
 {id:'m2',direction:'inbound',message_type:'image',text_content:'nk letak atas tiramisu cup, anggaran size berapa?',created_at:'2026-09-18T07:05:00Z'},
 {id:'m3',direction:'outbound',message_type:'text',text_content:'Thanks for order',source:'external automation',created_at:'2026-09-18T17:04:00Z'}]};
const context={identity_status:'matched',orders:[],marketplace_orders:[],session:{boundary_at:'2026-09-18T10:00:00Z',opened_at:'2026-09-18T10:00:00Z'}};
const a=analyze(c,context,null,now);
assert.equal(a.intent,'design');assert.equal(a.status,'needs_review');assert.equal(a.referenced_order,null);
assert.equal(a.draft_message_count,1);assert.ok(!a.suggestion.includes('bayaran diterima'));
const review={inbound_revision:'in-1',status:'resolved'};
assert.equal(effectiveStatus(review,c,now),'resolved');
assert.equal(effectiveStatus(review,{...c,inbound_revision:'in-2'},now),'needs_review');
assert.equal(effectiveStatus({inbound_revision:'in-1',status:'snoozed',snoozed_until:'2026-09-18T00:00:00Z'},c,now),'needs_review');
assert.equal(analyze({...c,messages:[{id:'p',direction:'inbound',message_type:'text',text_content:'Nak bayar, bagi QR boleh?',created_at:'2026-09-18T23:00:00Z'}]},context,null,now).intent,'payment');
const paidContext={...context,marketplace_orders:[{id:'order',order_sn:'260918ABC123',payment_status:'PAID',current_status:'COMPLETED'}]};
assert.equal(analyze(c,paidContext,null,now).referenced_order,null,'Latest order must not be assumed to be the subject');
assert.equal(analyze({...c,messages:[{id:'s',direction:'inbound',message_type:'text',text_content:'260918ABC123 parcel rosak',created_at:'2026-09-18T23:00:00Z'}]},paidContext,null,now).intent,'complaint','Completed order must not suppress a complaint');
assert.equal(identity({id:'x',channel:'whatsapp',identities:[{channel:'whatsapp',phone:'60111111111'},{channel:'whatsapp',phone:'60222222222'}]}).phone,null,'Ambiguous phone must not be selected');
assert.equal(analyze(c,{...context,identity_status:'ambiguous'},null,now).confidence,'rendah');
console.log('PASS: design enquiry, generic auto reply, session boundary, reopening, snooze expiry, payment intent, order association and identity ambiguity.');

const orderContext={...paidContext,case_order:{order_id:'order',order_kind:'shopee',inbound_revision:c.inbound_revision,session_key:sessionKey(paidContext)}};
assert.equal(confirmedOrder(c,orderContext)?.order_sn,'260918ABC123');
assert.equal(confirmedOrder({...c,inbound_revision:'new'},orderContext),null,'New inbound invalidates confirmation');
assert.equal(confirmedOrder(c,{...orderContext,session:{...context.session,session_id:'new'}}),null,'New session invalidates confirmation');
assert.equal(confirmedOrder(c,{...orderContext,identity_status:'ambiguous'}),null);
assert.equal(confirmedOrder(c,{...orderContext,marketplace_orders:[]}),null,'Membership must still hold');
const summary=caseSummary(c,{...orderContext,drafts:[{status:'confirmed'},{status:'rejected'},{status:'pending_admin'},{status:'awaiting_payment',order_no:'IC-1'}]},'shipping','Parcel mana?');
assert.equal(summary.active_draft_count,1);assert.equal(summary.binding_current,true);
assert.ok(summary.missing.includes('Status courier belum tersedia.'),'Completed is not proof of courier delivery');
const newer={...c,messages:[...c.messages,{id:'last',direction:'inbound',message_type:'text',text_content:'parcel mana? not urgent',created_at:'2026-09-18T23:00:00Z'}]};
const newestAnalysis=analyze(newer,context,null,now);
assert.equal(newestAnalysis.intent,'shipping','Newest parcel request beats older design messages');
assert.equal(newestAnalysis.urgent,false);assert.equal(newestAnalysis.case.request,'parcel mana? not urgent');
assert.equal(newestAnalysis.status,'needs_review');
console.log('PASS: case membership, inbound/session expiry, ambiguity, active draft count, conservative shipping evidence and newest actionable intent.');
