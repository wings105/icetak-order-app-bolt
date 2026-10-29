-- Compare-and-swap patches preserve current privileges and reject a changed production baseline.
select pg_advisory_xact_lock(hashtextextended('stock:writer',0));
do $patch$
declare d text:=btrim(pg_get_functiondef('stock.colour_name(text)'::regprocedure), E' \n\r\t');
begin
 if md5(d)<>'aab73285660e0b05bafdf052508653b1' then raise exception 'Stock function changed since review: stock.colour_name';end if;
 d:=overlay(d placing $edit$;$edit$ from 282 for 0);
 d:=overlay(d placing $edit$$edit$ from 244 for 1);
 d:=overlay(d placing $edit$$edit$ from 229 for 1);
 d:=overlay(d placing $edit$$edit$ from 221 for 3);
 d:=overlay(d placing $edit$),'[^a-z]','','g'$edit$ from 201 for 0);
 d:=overlay(d placing $edit$,''$edit$ from 200 for 0);
 d:=overlay(d placing $edit$coalesce$edit$ from 194 for 4);
 d:=overlay(d placing $edit$regexp_replace($edit$ from 188 for 0);
 if md5(d)<>'9e8f03d2dcc649173b72bde6794f9de3' then raise exception 'Stock patch checksum failed: stock.colour_name';end if;
 execute d;
end $patch$;
do $patch$
declare d text:=btrim(pg_get_functiondef('stock.resolve_line(jsonb)'::regprocedure), E' \n\r\t');
begin
 if md5(d)<>'7f85fc297ce1ba7db921f4bb210edb24' then raise exception 'Stock function changed since review: stock.resolve_line';end if;
 d:=overlay(d placing $edit$;$edit$ from 2654 for 0);
 d:=overlay(d placing $edit$;
 -- Owner confirmed one standard glossy set uses one A4. Explicit custom sizes still need a rule.
 if cat='glossy' and nullif(trim(p->>'size'),'') is null then sz:='1pc';end if$edit$ from 662 for 0);
 d:=overlay(d placing $edit$,p->>'size')$edit$ from 359 for 0);
 d:=overlay(d placing $edit$concat_ws(' ',$edit$ from 348 for 0);
 if md5(d)<>'472ea410647ce78249bfbb388ee7e3cb' then raise exception 'Stock patch checksum failed: stock.resolve_line';end if;
 execute d;
end $patch$;

-- The owner confirmed this rate in the current session. No other missing rate is filled.
insert into stock.size_rules(category,size_key,shape_key,rate,approved,actor)
values('glossy','1pc','*',1,true,'owner-confirmed-20261029')
on conflict(category,size_key,shape_key) do update set rate=excluded.rate,approved=true,actor=excluded.actor,updated_at=now();
insert into stock.audit(action,actor,target,details)
values('rate_confirmed','owner-via-chatgpt','glossy:1pc',jsonb_build_object('rate',1,'base_unit','helai A4 setara','double_tape','same quantity'));
-- Bounded repair: only enrolled, unconsumed records; retain fulfilled receipts and old closed history.
insert into stock.work_queue(source,order_id)
select source,order_id from stock.order_state where consumed_at is null and excluded_at is null
on conflict(source,order_id) do update set status='pending',attempts=0,available_at=now(),last_error=null,updated_at=now();
