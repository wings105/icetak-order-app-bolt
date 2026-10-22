import assert from 'node:assert/strict';
import { designTaskStage, summarizeDesignWork, matchesDesignFilter } from '../supabase/functions/_shared/inbox-design-work.ts';

let checks=0;
for(const status of ['new custom','design editing -topper','Design Editing - Topper','design edible image','acrylic','wafer paper']){
 assert.equal(designTaskStage(status),'needs_design');checks++;
}
for(const status of ['cake topper - printing','edible image -printing','wafer - printing','acrylic - printing','print alamat','ready stock','edible print ready stock','complete','completed','closed','cancelled','archived']){
 assert.equal(designTaskStage(status,'edit_requested'),'done');checks++;
}
for(const status of ['prospect','lain2','',null,'future unknown stage']){assert.equal(designTaskStage(status),'unknown');checks++;}
assert.equal(designTaskStage('review','approved'),'review');checks++;
assert.equal(designTaskStage('review','edit_requested'),'needs_design');checks++;
assert.equal(designTaskStage('review','Request Edit'),'needs_design');checks++;
assert.equal(designTaskStage('review','no edit'),'review');checks++;
const task=(id,status)=>({id,status,source_updated_at:'2026-10-22T00:00:00Z'});
for(const [statuses,stage] of [
 [['complete','acrylic'],'needs_design'],[['complete','print alamat'],'done'],
 [['review','complete'],'review'],[['future stage','complete'],'unknown'],[[],'unknown'],
]){const w=summarizeDesignWork(statuses.map((s,i)=>task(String(i),s)));assert.equal(w.stage,stage);assert.equal(w.tasks.length,statuses.length);checks+=2;}
const dedup=summarizeDesignWork([task('a','complete'),{...task('a','new custom'),source_updated_at:'2026-10-21T00:00:00Z'}]);
assert.equal(dedup.stage,'done');assert.equal(dedup.tasks.length,1);checks+=2;
const mixed={metadata:{design_work:summarizeDesignWork([task('a','cake topper - printing'),task('b','design edible image')])}};
assert.equal(matchesDesignFilter(mixed,'needs_design'),true);assert.equal(matchesDesignFilter(mixed,'done'),false);
assert.equal(matchesDesignFilter({metadata:{}},'needs_design'),false);assert.equal(matchesDesignFilter({metadata:{}},'unknown'),true);assert.equal(matchesDesignFilter({metadata:{}},'all'),true);checks+=5;
console.log(`${checks} Inbox design work checks passed: pre-print focus, review edits, terminal precedence, mixed tasks, unknown and latest-identity deduplication.`);
