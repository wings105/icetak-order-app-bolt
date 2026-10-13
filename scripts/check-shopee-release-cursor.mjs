import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(readFileSync('supabase/functions/shopee-financial-enrich/release-cursor.ts', 'utf8'));
const { prepareReleaseCursor, finishReleaseCursor } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const hour = 60 * 60 * 1000, week = 7 * 24 * hour;
const now = Date.parse('2026-10-13T03:00:00Z');
const iso = t => new Date(t).toISOString();
const base = {shop_id:'1635364464',from_at:iso(now-12*60*1000),to_at:iso(now-6*60*1000),page:1,next_at:iso(now-hour)};

// A six-minute cron gap must stop catch-up, even if the provider read takes time.
const tail = prepareReleaseCursor(base, now);
assert.equal(tail.to_at, iso(now));
assert.equal(base.to_at, iso(now-6*60*1000));
const caught = finishReleaseCursor(tail, {}, 0, now);
assert.equal(caught.next_at, iso(now+6*hour));
assert.equal(caught.from_at, iso(now-week));
assert.equal(caught.page, 1);

// A seven-day first page stays bounded; all its later pages retain that range.
const history = {...base,from_at:iso(now-30*24*hour),to_at:iso(now-23*24*hour)};
const first = prepareReleaseCursor(history, now);
assert.equal(Date.parse(first.to_at)-Date.parse(first.from_at), week);
const page2 = finishReleaseCursor(first, {more:true}, 20, now);
assert.equal(page2.page, 2);
assert.equal(prepareReleaseCursor(page2, now+6*60*1000).to_at, first.to_at);
const page3 = finishReleaseCursor(page2, {has_more:true}, 10, now);
assert.equal(page3.page, 3);
assert.equal(finishReleaseCursor(first, {}, 100, now).page, 2);
const following = finishReleaseCursor(page3, {}, 12, now);
assert.equal(following.from_at, first.to_at);
assert.equal(Date.parse(following.to_at)-Date.parse(following.from_at), week);

// Actual six-minute invocation times converge from a 90-day backlog without gaps.
let cursor = {...base,from_at:iso(now-90*24*hour),to_at:iso(now-83*24*hour)};
let tick = now, end = Date.parse(cursor.from_at), windows = 0;
while (windows < 20) {
  const requested = prepareReleaseCursor(cursor, tick);
  assert.equal(Date.parse(requested.from_at), end);
  assert.ok(Date.parse(requested.to_at)-Date.parse(requested.from_at)<=week);
  assert.ok(Date.parse(requested.to_at)<=tick);
  end = Date.parse(requested.to_at);
  cursor = finishReleaseCursor(requested, {}, 0, tick);
  windows++;
  if (Date.parse(cursor.next_at)>tick) break;
  tick += 6*60*1000;
}
assert.ok(windows<=14);
assert.equal(end, tick);
assert.equal(Date.parse(cursor.next_at)-tick, 6*hour);

// A due recent poll replays the previous week, then reads the fresh tail once.
tick = Date.parse(cursor.next_at);
cursor = finishReleaseCursor(prepareReleaseCursor(cursor, tick), {}, 0, tick);
assert.ok(Date.parse(cursor.next_at)<=tick);
tick += 6*60*1000;
cursor = finishReleaseCursor(prepareReleaseCursor(cursor, tick), {}, 0, tick);
assert.equal(Date.parse(cursor.next_at)-tick, 6*hour);
// Run the actual Edge handler: provider delay must not restart catch-up, and
// future cursors/auth failures must not invoke Shopee. No real credentials/data.
let handler, providerReads = 0, saved = [], clock = now, stored = base, providerError = false;
class Clock extends Date { static now() { return clock; } }
const fetcher = async (url, init) => {
  const path = new URL(url).pathname;
  if (path.endsWith('/claim_marketplace_finance_run')) return Response.json(true);
  if (path.endsWith('/private_runtime_settings')) return Response.json([{setting_value:'fixture-bridge'}]);
  if (path.endsWith('/marketplace_finance_runtime')) {
    const body = JSON.parse(init.body);
    if (body.p_action==='cursor') return Response.json(stored);
    if (body.p_action==='cursor_save') saved.push(body.p_body);
    return Response.json({saved:true});
  }
  if (path.endsWith('/shopee-finance-fetch')) {
    providerReads++;
    const request = JSON.parse(init.body);
    assert.equal(request.to, Math.floor(now/1000));
    clock += 2*60*1000;
    return providerError ? Response.json({ok:false,error:'TOKEN_EXPIRED'},{status:401}) : Response.json({ok:true,response:{escrow_list:[]}});
  }
  if (path.endsWith('/claim_marketplace_enrichment_jobs') || path.endsWith('/marketplace_returns_pending')) return Response.json([]);
  throw Error('Unexpected finance request');
};
const code = stripTypeScriptTypes(readFileSync('supabase/functions/shopee-financial-enrich/index.ts','utf8').replace(/^import .*;$/gm,''));
new Function('Deno','fetch','normalize','stable','prepareReleaseCursor','finishReleaseCursor','Date',code)(
  {env:{get:n=>n==='SUPABASE_URL'?'https://fixture.supabase.co':'fixture-service'},serve:fn=>handler=fn},
  fetcher, ()=>{throw Error('Unexpected finance ingest')}, JSON.stringify, prepareReleaseCursor, finishReleaseCursor, Clock
);
const req = auth => new Request('https://fixture.example',{method:'POST',headers:auth?{authorization:'Bearer fixture-service'}:{},body:JSON.stringify({shop_id:'1635364464'})});
assert.equal((await handler(req(false))).status,401);
assert.equal(providerReads,0);
assert.equal((await handler(req(true))).status,200);
assert.equal(providerReads,1);
assert.equal(saved[0].next_at,iso(now+6*hour));
assert.equal(saved[0].error,null);
stored={...base,next_at:iso(now+6*hour)};
await handler(req(true));
assert.equal(providerReads,1);
stored=base;providerError=true;clock=now;
await handler(req(true));
assert.equal(saved[1].error,'TOKEN_EXPIRED');
assert.equal(saved[1].next_at,iso(clock+6*hour));
console.log('Shopee release cursor regressions passed: six-minute catch-up convergence, fixed pagination, seven-day ranges, six-hour polling, real handler delay/backoff and auth guards.');
