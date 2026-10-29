-- Active reservation visibility uses private transient fixtures; every effect rolls back.
begin;
do $verify$
declare prefix text:='QA-RESERVE-'||substr(gen_random_uuid()::text,1,8); oid uuid; n integer; result jsonb; fixture jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('stock:writer',0));
 for n in 1..123 loop
  oid:=gen_random_uuid();
  insert into stock.order_state(source,order_id,reference,stage) values('icetak',oid,prefix||'-'||n,'to_ship');
  fixture:=jsonb_build_array(jsonb_build_object('line_key','L','part','glossy','material_code','CU-69qvhj','quantity',0.001),jsonb_build_object('line_key','L','part','glossy','material_code','CU-1yzqnqt','quantity',0.002));
  perform stock.apply_order('icetak',oid,'to_ship',fixture,null);
  if n=122 then perform stock.apply_order('icetak',oid,'waiting','[]',null);end if;
  if n=123 then perform stock.apply_order('icetak',oid,'consume',fixture,now());end if;
 end loop;
 result:=stock.reservations(jsonb_build_object('reservation_query',prefix));
 if (result->>'reservations_total')::integer is distinct from 121 or jsonb_array_length(result->'reservations')<>100 then raise exception 'Distinct order count/page incorrect';end if;
 if exists(select 1 from jsonb_array_elements(result->'reservation_totals') m where (m->>'quantity')::numeric is distinct from case when m->>'material_code'='CU-69qvhj' then 0.121::numeric else 0.242::numeric end) then raise exception 'Reservation totals differ';end if;
 result:=stock.reservations(jsonb_build_object('reservation_query',prefix,'reservation_material','CU-69qvhj','reservation_offset',100));
 if jsonb_array_length(result->'reservations')<>21 or jsonb_array_length(result->'reservation_totals')<>1 then raise exception 'Material/page filter incorrect';end if;
 if exists(select 1 from jsonb_array_elements(result->'reservations') r where jsonb_array_length(r->'materials')<>1 or r#>>'{materials,0,material_code}'<>'CU-69qvhj') then raise exception 'Wrong material leaked into filtered result';end if;
 result:=stock.snapshot(jsonb_build_object('include_reservations',true,'reservation_query',prefix,'reservation_material','CU-69qvhj'));
 if (result->>'reservations_total')::integer is distinct from 121 or result#>>'{reservation_filter,material_code}'<>'CU-69qvhj' then raise exception 'Gateway snapshot reservation integration failed';end if;
 if stock.snapshot('{}')?'reservations' then raise exception 'Inactive tab fetched reservation detail';end if;
 result:=stock.reservations(jsonb_build_object('reservation_query',prefix||' NO MATCH'));
 if (result->>'reservations_total')::integer is distinct from 0 or jsonb_array_length(result->'reservations')<>0 then raise exception 'Empty result incorrect';end if;
 result:=stock.reservations('{}');
 if (result->>'reservations_total')::integer<>(select count(distinct(source,order_id)) from stock.allocations where state='reserved') then raise exception 'Global reservation order count differs';end if;
 for fixture in select value from jsonb_array_elements(result->'reservation_totals') loop
  if (fixture->>'quantity')::numeric is distinct from (select reserved from stock.materials where code=fixture->>'material_code') then raise exception 'Material ledger/reserve list differs';end if;
 end loop;
 if has_function_privilege('anon','stock.reservations(jsonb)','execute') or has_function_privilege('authenticated','stock.reservations(jsonb)','execute') then raise exception 'Reservation details publicly exposed';end if;
end $verify$;
rollback;
select 'Active reserve order grouping, exact material sums, released/consumed exclusion, search, empty state, pagination, snapshot opt-in and private grants passed; all effects reverted' result;
