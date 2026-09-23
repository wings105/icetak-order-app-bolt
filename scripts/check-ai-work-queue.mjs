// Node >=22. Pure fixture checks; no backend reads or writes.
import assert from 'node:assert/strict';
import {workQueue} from '../icetak-admin/src/components/ai-dashboard/workQueue.ts';
const now=Date.parse('2026-09-23T02:00:00Z');
const order={id:'current',current_status:'READY_TO_SHIP',ship_by_at:'2026-09-23T15:00:00Z'};
const row={analysis:{status:'needs_review',confidence:'tinggi',intent:'enquiry',case:{}},context:{identity_status:'matched',marketplace_orders:[order]}};
assert.equal(workQueue(row,now).key,'reply','Unconfirmed related deadline must not promote an enquiry');
const bound={...row,analysis:{...row.analysis,case:{binding_current:true,order:{id:'current',kind:'shopee'}}}};
assert.equal(workQueue(bound,now).key,'urgent','Confirmed unshipped order due today is urgent');
assert.equal(workQueue({...bound,context:{...row.context,marketplace_orders:[{...order,current_status:'SHIPPED'}]}},now).key,'reply');
assert.equal(workQueue({...bound,context:{...row.context,marketplace_orders:[{...order,current_status:'CANCELLED'}]}},now).key,'reply');
assert.equal(workQueue({...bound,context:{...row.context,marketplace_orders:[{...order,ship_by_at:'2026-09-23T16:01:00Z'}]}},now).key,'reply','Malaysia tomorrow must not be today');
assert.equal(workQueue({...row,analysis:{...row.analysis,urgent:true}},now).key,'urgent');
assert.equal(workQueue({...row,context:{...row.context,identity_status:'ambiguous'}},now).key,'review');
assert.equal(workQueue({...row,analysis:{...row.analysis,confidence:'rendah'}},now).key,'review');
for(const [status,key] of [['waiting_customer','waiting'],['resolved','resolved'],['snoozed','snoozed']])assert.equal(workQueue({...bound,analysis:{...bound.analysis,status,urgent:true}},now).key,key,'Reviewed status wins over urgency');
console.log('PASS: confirmed order deadline, Malaysia day boundary, shipped/cancelled exclusions, ambiguous identity, insufficient evidence and inactive status precedence.');
