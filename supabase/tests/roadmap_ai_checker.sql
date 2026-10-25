-- Native production-compatible regression. Everything is rolled back.
begin;
create temporary table checker_test_result(name text,result text);
do $$
declare i uuid=gen_random_uuid();r uuid=gen_random_uuid();r2 uuid=gen_random_uuid();j jsonb;n int;before_ts timestamptz;
begin
 insert into public.icetak_roadmap_items(id,title,is_public,status,progress) values(i,'QA transient checker feature',false,'testing',50);
 j=public.icetak_roadmap_ai_check('start',r,i,'{"checker":"QA checker","scope":"Exercise review lifecycle with rolled-back synthetic feature"}');
 if j->>'outcome'<>'running' or (j->'before_state'->>'progress')::int<>50 then raise exception 'bad start snapshot';end if;
 perform public.icetak_roadmap_ai_check('start',r,i,'{"checker":"QA checker","scope":"Exercise review lifecycle with rolled-back synthetic feature"}');
 select count(*) into n from public.icetak_roadmap_ai_events where run_id=r;
 if n<>1 then raise exception 'start retry duplicated event';end if;
 begin perform public.icetak_roadmap_ai_check('start',r2,i,'{"checker":"QA checker","scope":"Second active review must be rejected"}');raise exception 'duplicate active accepted';exception when others then if sqlerrm='duplicate active accepted' then raise;end if;end;
 perform public.icetak_roadmap_ai_check('checkpoint',r,null,'{"summary":"Source inspected, UI not checked","verification_level":"source","evidence":["Synthetic source reference"],"next_action":"Exercise controlled UI before completion"}');
 begin perform public.icetak_roadmap_ai_check('finish',r,null,'{"outcome":"verified","verification_level":"source","summary":"Source only must not verify","evidence":["Source only"],"next_action":""}');raise exception 'source-only verified accepted';exception when others then if sqlerrm='source-only verified accepted' then raise;end if;end;
 begin perform public.icetak_roadmap_ai_check('finish',r,null,'{"outcome":"verified","verification_level":"controlled","summary":"Controlled cannot complete production","evidence":["Controlled test result"],"next_action":"","progress":100,"status":"completed"}');raise exception 'unproven complete accepted';exception when others then if sqlerrm='unproven complete accepted' then raise;end if;end;
 begin perform public.icetak_roadmap_ai_check('finish',r,null,'{"outcome":"verified","verification_level":"production","summary":"Mismatched status and percent rejected","evidence":["Synthetic proof"],"next_action":"","progress":100,"status":"testing"}');raise exception 'mismatch accepted';exception when others then if sqlerrm='mismatch accepted' then raise;end if;end;
 j=public.icetak_roadmap_ai_check('finish',r,null,'{"outcome":"partial","verification_level":"controlled","summary":"Controlled test passed; hosted flow remains","evidence":["Synthetic controlled interaction pass"],"next_action":"Verify hosted owner flow","progress":80,"status":"testing","priority":"p1","priority_rank":20,"work_type":"verify","priority_reason":"Daily operational acceptance is pending"}');
 if j->>'outcome'<>'partial' or (j->'after_state'->>'progress')::int<>80 then raise exception 'atomic final snapshot failed';end if;
 select count(*) into n from public.icetak_roadmap_ai_events where run_id=r;
 if n<>3 then raise exception 'expected start checkpoint finish';end if;
 perform public.icetak_roadmap_ai_check('finish',r,null,'{"outcome":"verified","progress":100,"status":"completed"}');
 if (select progress from public.icetak_roadmap_items where id=i)<>80 then raise exception 'finish retry rewrote feature';end if;
 if (select count(*) from public.icetak_roadmap_updates where item_id=i)<>1 then raise exception 'duplicate progress note';end if;
 begin update public.icetak_roadmap_ai_events set summary='rewrite' where run_id=r;raise exception 'event mutable';exception when others then if sqlerrm='event mutable' then raise;end if;end;
 begin update public.icetak_roadmap_ai_runs set summary='rewrite finished review' where id=r;raise exception 'finished mutable';exception when others then if sqlerrm='finished mutable' then raise;end if;end;
 insert into checker_test_result values('start/checkpoint/finish atomic + retries + append-only','PASS');
 -- A genuine later item update must block stale metadata, but still allow closing the review.
 perform public.icetak_roadmap_ai_check('start',r2,i,'{"checker":"QA checker","scope":"Conflict must preserve newer roadmap metadata"}');
 select updated_at into before_ts from public.icetak_roadmap_items where id=i;
 update public.icetak_roadmap_items set summary='Concurrent owner edit' where id=i;
 -- now() is transaction-stable in the existing updated_at trigger; force a distinct revision for this single-transaction fixture.
 alter table public.icetak_roadmap_items disable trigger icetak_roadmap_updated_at;
 update public.icetak_roadmap_items set updated_at=before_ts+interval '1 second' where id=i;
 alter table public.icetak_roadmap_items enable trigger icetak_roadmap_updated_at;
 j=public.icetak_roadmap_ai_check('finish',r2,null,'{"outcome":"partial","verification_level":"source","summary":"Stale proposal must not overwrite","evidence":["Source review"],"next_action":"Read current feature","progress":20,"status":"building"}');
 if j->>'conflict'<>'true' or (select progress from public.icetak_roadmap_items where id=i)<>80 then raise exception 'lost update';end if;
 perform public.icetak_roadmap_ai_check('finish',r2,null,'{"outcome":"interrupted","summary":"Closed due to concurrent owner edit","next_action":"Start a fresh review with the current source"}');
 if (select count(*) from public.icetak_roadmap_ai_latest() where item_id=i)<>1 then raise exception 'latest coverage failed';end if;
 insert into checker_test_result values('stale snapshot rejected + interrupted handoff + latest coverage','PASS');
end $$;
-- Owner invoker/RLS test, then non-owner/anon isolation.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_user_id from public.admin_users where role='owner' and is_active and auth_user_id is not null limit 1),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare i uuid;r uuid=gen_random_uuid();
begin
 select id into i from public.icetak_roadmap_items where title='QA transient checker feature';
 if i is null then raise exception 'owner cannot read';end if;
 perform public.icetak_roadmap_ai_check('start',r,i,'{"checker":"Authenticated owner QA","scope":"Verify invoker RPC and trigger audit under actual owner RLS"}');
 perform public.icetak_roadmap_ai_check('finish',r,null,'{"outcome":"blocked","summary":"Owner RLS exercised without a business mutation","next_action":"Continue remaining tests using rolled-back fixtures"}');
 if (select count(*) from public.icetak_roadmap_ai_events where run_id=r)<>2 then raise exception 'owner audit unavailable';end if;
end $$;
reset role;
insert into checker_test_result values('authenticated owner lifecycle + RLS event access','PASS');
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if exists(select 1 from public.icetak_roadmap_ai_runs) or exists(select 1 from public.icetak_roadmap_ai_events) then raise exception 'non-owner read leak';end if;
 begin perform public.icetak_roadmap_ai_check('start',gen_random_uuid(),gen_random_uuid(),'{}');raise exception 'non-owner write accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
do $$begin
 begin perform count(*) from public.icetak_roadmap_ai_runs;raise exception 'anon read accepted';exception when insufficient_privilege then null;end;
 begin perform public.icetak_roadmap_ai_latest();raise exception 'anon RPC accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into checker_test_result values('non-owner / anon denied','PASS');
select * from checker_test_result;
rollback;
