-- Native private-stock replay only. No canonical order/payment or customer message is changed.
begin;
do $verify$
declare fixture jsonb; raw_before text; raw_after text; ids jsonb; sample jsonb;
 before_moves bigint; after_first bigint; outcome text; evidence timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('stock:writer',0));
 update stock.settings set enabled=true;
 fixture:='{"detail_complete":true,"lines":[{"source":"icetak","line_key":"test","part":"glossy","category":"glossy","quantity":2,"size":"custom"}]}';
 -- A physical count covers material identity even while a historic size rate is unknown.
 if not stock.count_covers_order(fixture,now()-interval '1 day') then raise exception 'Confirmed glossy/tape count ignored';end if;
 if stock.count_covers_order(fixture,now()+interval '1 day') then raise exception 'Future usage treated as counted';end if;
 if stock.count_covers_order(fixture,null) then raise exception 'Missing evidence treated as counted';end if;
 if stock.count_covers_order(jsonb_set(fixture,'{detail_complete}','false'),now()-interval '1 day') then raise exception 'Incomplete source detail ignored';end if;
 if stock.count_covers_order(jsonb_set(fixture,'{lines,0,category}','"unknown"'),now()-interval '1 day') then raise exception 'Unknown material guessed';end if;
 if stock.count_covers_order(jsonb_set(fixture,'{lines,0,quantity}','0'),now()-interval '1 day') then raise exception 'Invalid quantity ignored';end if;
 -- Both materials must have been counted, not just glossy.
 update stock.materials set counted_at=now()-interval '2 days' where category='double_tape' and is_default;
 if stock.count_covers_order(fixture,now()-interval '1 day') then raise exception 'Older tape count accepted';end if;
 update stock.materials set counted_at=now() where category='double_tape' and is_default;
 if has_function_privilege('anon','stock.count_covers_order(jsonb,timestamptz)','execute')
 or has_function_privilege('authenticated','stock.count_covers_order(jsonb,timestamptz)','execute') then raise exception 'Count helper exposed';end if;

 select coalesce(jsonb_agg(jsonb_build_object('source',s.source,'order_id',s.order_id)),'[]') into ids
 from stock.order_state s where exists(select 1 from stock.allocations a where a.source=s.source and a.order_id=s.order_id and a.state='reserved');
 select md5(jsonb_agg(jsonb_build_array(code,on_hand) order by code)::text) into raw_before from stock.materials;
 select count(*) into before_moves from stock.movements;
 for sample in select value from jsonb_array_elements(ids) loop
  outcome:=stock.process_order(sample->>'source',(sample->>'order_id')::uuid);
 end loop;
 select md5(jsonb_agg(jsonb_build_array(code,on_hand) order by code)::text) into raw_after from stock.materials;
 if raw_after<>raw_before then raise exception 'Reserve repair deducted counted raw stock';end if;
 if exists(select 1 from stock.material_health where ledger_mismatch) then raise exception 'Ledger/allocation totals differ';end if;
 if exists(select 1 from stock.order_state s where stock.order_input(s.source,s.order_id)->>'stage'='consume'
 and exists(select 1 from stock.allocations a where a.source=s.source and a.order_id=s.order_id and a.state='reserved')) then raise exception 'Fulfilled order still holds future reserve';end if;
 if exists(select 1 from stock.order_state s cross join lateral (select stock.order_input(s.source,s.order_id) j) i
 where i.j->>'stage'='to_ship' and i.j->>'prepared_at' is not null
 and stock.count_covers_order(i.j,(i.j->>'prepared_at')::timestamptz)
 and exists(select 1 from stock.allocations a where a.source=s.source and a.order_id=s.order_id and a.state='reserved')) then raise exception 'Count-covered prepared pickup still reserved';end if;
 select count(*) into after_first from stock.movements;
 for sample in select value from jsonb_array_elements(ids) loop
  perform stock.process_order(sample->>'source',(sample->>'order_id')::uuid);
 end loop;
 if (select count(*) from stock.movements)<>after_first then raise exception 'Repeated reconciliation produced movements';end if;
 if (select count(*) from stock.movements where kind='order_use')<>(select count(*) from stock.movements where kind='order_use' and created_at<now()) then
  -- Existing same-transaction fixtures are not present in this standalone replay.
  raise exception 'Unexpected physical-use movement';
 end if;
end $verify$;
rollback;
select 'counted-reserve reconciliation passed; all effects reverted' result;
