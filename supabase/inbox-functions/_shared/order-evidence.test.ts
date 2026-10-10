import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolveOrderEvidence} from './order-evidence.ts';
const base={order_no:'A1',active_order:true,ai_match_source:'conversation_order_link',order_system_order_id:'uuid',source_channel:'whatsapp',metadata:{provisional:false}};
test('unpaid is never read as paid',()=>assert.equal(resolveOrderEvidence([{...base,payment_status:'unpaid'}]).state,'unpaid'));
test('provisional chat references are not authoritative',()=>assert.equal(resolveOrderEvidence([{...base,payment_status:'paid',metadata:{provisional:true}}]).authoritative,false));
test('two active orders require an explicit order reference',()=>assert.equal(resolveOrderEvidence([{...base,payment_status:'paid'},{...base,order_no:'A2',payment_status:'unpaid'}]).authoritative,false));
test('explicit order reference selects the unpaid order',()=>assert.equal(resolveOrderEvidence([{...base,payment_status:'paid'},{...base,order_no:'A2',payment_status:'unpaid'}],'A2').state,'unpaid'));
test('COD is flagged separately from platform paid status',()=>assert.equal(resolveOrderEvidence([{...base,payment_status:'paid',payment_method:'COD'}]).cod,true));
