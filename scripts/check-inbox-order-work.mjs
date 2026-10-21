import assert from 'node:assert/strict';
import { marketplaceWorkPriority } from '../supabase/functions/_shared/inbox-order-policy.ts';
import { isOlderOrderSummary } from '../supabase/inbox-functions/_shared/order-summary-version.ts';
const now=Date.parse('2026-10-21T16:00:00Z');
const base={current_status:'READY_TO_SHIP',payment_status:'paid',fulfillment_status:'LOGISTICS_READY',ship_by_at:'2026-10-22T12:00:00Z'};
let checks=0;
for(const current_status of ['IN_CANCEL','CANCELLED','COMPLETED','UNKNOWN','UNPAID','SHIPPED','TO_CONFIRM_RECEIVE','TO_RETURN','RETURNED','']){
 const value=marketplaceWorkPriority({...base,current_status},null,now);assert.equal(value.active,false);assert.equal(value.level,'P9');checks++;
}
for(const payment_status of ['unpaid','unknown','pending','partial','']){assert.equal(marketplaceWorkPriority({...base,payment_status},null,now).active,false);checks++;}
for(const fulfillment_status of ['LOGISTICS_PICKUP_DONE','LOGISTICS_DELIVERY_DONE','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','SHIPPED']){assert.equal(marketplaceWorkPriority({...base,fulfillment_status},null,now).active,false);checks++;}
for(const metadata of [{dashboard_excluded:true},{dashboard_excluded:'true'}]){assert.equal(marketplaceWorkPriority({...base,metadata},null,now).active,false);checks++;}
assert.equal(marketplaceWorkPriority(base,'2026-10-21T12:00:00Z',now).active,false);checks++;
for(const [ship_by_at,level] of [['2026-10-21T12:00:00Z','P0'],['2026-10-22T12:00:00Z','P1'],['2026-10-23T12:00:00Z','P2'],['2026-10-26T12:00:00Z','P4'],['1970-01-01T00:00:00Z','P4'],['bad date','P4']]){
 for(const current_status of ['READY_TO_SHIP','PROCESSED']){const p=marketplaceWorkPriority({...base,ship_by_at,current_status},null,now);assert.equal(p.active,true);assert.equal(p.level,level);checks++;}
}
const existing={order_updated_at:'2026-10-21T10:00:00Z',last_synced_at:'2026-10-21T10:01:00Z',metadata:{source:'canonical_order_sync',source_observed_at:'2026-10-21T10:00:30Z'}};
assert.equal(isOlderOrderSummary(existing,{order_updated_at:'2026-10-20T10:00:00Z',metadata:{source_observed_at:'2026-10-21T10:02:00Z'}}),false,'new task deletion/remapping must reach cache even with an older order timestamp');checks++;
assert.equal(isOlderOrderSummary(existing,{order_updated_at:'2026-10-21T10:03:00Z',metadata:{source_observed_at:'2026-10-21T10:00:00Z'}}),true,'late response must not overwrite a newer read');checks++;
assert.equal(isOlderOrderSummary(existing,{order_updated_at:'2026-10-20T10:00:00Z',metadata:{}}),true,'legacy source timestamp guard remains');checks++;
assert.equal(isOlderOrderSummary(null,{metadata:{}}),false);checks++;
console.log(`${checks} canonical Inbox work checks passed: eligibility, terminal urgency, current-time deadlines, task-only revisions and stale/legacy response guards.`);
