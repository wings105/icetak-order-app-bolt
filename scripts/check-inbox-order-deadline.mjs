import assert from 'node:assert/strict';
import {orderDeadline,matchesDueFilter} from '../supabase/functions/_shared/inbox-order-deadline.ts';
const now=Date.parse('2026-10-22T15:59:00Z'); // 23:59 Malaysia, not the UTC day boundary.
let checks=0;
for(const [source_channel,raw,bucket] of [
 ['whatsapp','2026-10-21','overdue'],['whatsapp','2026-10-22','today'],['whatsapp','2026-10-23','tomorrow'],['whatsapp','2026-10-24','upcoming'],
 ['shopee','2026-10-22T15:58:59Z','overdue'],['shopee','2026-10-22T15:59:00Z','today'],['shopee','2026-10-22T15:59:59Z','today'],
 ['shopee','2026-10-22T16:00:00Z','tomorrow'],['shopee','2026-10-23T16:00:00Z','upcoming'],['shopee','2026-10-23T23:59:00+08:00','tomorrow'],
 ...['','bad','1970-01-01','2026-99-99','2026-02-31','2026-02-29'].map(x=>['whatsapp',x,'undated']),
 ...['1970-01-01T00:00:00Z','2026-02-31T00:00:00Z','2026-10-23T00:00:00'].map(x=>['shopee',x,'undated']),
]) {
 const order={source_channel,date_need:source_channel==='whatsapp'?raw:'2020-01-01',ship_by_at:source_channel==='shopee'?raw:'2020-01-01T00:00:00Z'};
 const due=orderDeadline(order,now);assert.equal(due.bucket,bucket,JSON.stringify(order));checks++;
 assert.equal(matchesDueFilter(order,'urgent',now),['overdue','today','tomorrow'].includes(bucket));checks++;
 assert.equal(matchesDueFilter(order,bucket,now),true);checks++;
 assert.equal(matchesDueFilter(order,'all',now),true);checks++;
}
assert.equal(orderDeadline({source_channel:'whatsapp',date_need:'2026-10-24'},now+60000).bucket,'tomorrow');checks++;
assert.equal(orderDeadline({source_channel:'whatsapp',date_need:'2024-02-29'},now).bucket,'overdue');checks++;
assert.equal(orderDeadline({source_channel:'whatsapp',date_need:'2026-10-23'},now).sort_at,'2026-10-22T16:00:00.000Z');checks++;
assert.equal(orderDeadline({source_channel:'shopee',ship_by_at:'2026-10-22T16:00:00Z'},now).date,'2026-10-23');checks++;
console.log(`${checks} deadline checks passed: Malaysia midnight, exact instant, future preorders, invalid/missing dates, canonical source and clock rollover.`);
