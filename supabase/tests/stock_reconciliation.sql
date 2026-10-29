-- Native stock verification uses only private stock fixtures and read-only canonical inputs.
-- All fixture writes and ledger effects are reverted; no order/payment/customer action is invoked.
begin;
do $verify$
declare
 o uuid:=gen_random_uuid(); old_count uuid:=gen_random_uuid();
 m text:='CU-69qvhj'; base numeric; reserved_before numeric; d jsonb; r jsonb; result text;
 row_before text; row_after text; ledger_before bigint; sample record; n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('stock:writer',0));
 select on_hand,reserved into base,reserved_before from stock.materials where code=m;
 insert into stock.order_state(source,order_id,reference,stage) values('icetak',o,'QA-INTERNAL-STOCK','to_ship');
 d:=jsonb_build_array(jsonb_build_object('line_key','L','part','glossy','material_code',m,'quantity',1));
 perform stock.apply_order('icetak',o,'to_ship',d,null);
 if (select reserved from stock.materials where code=m)<>reserved_before+1 then raise exception 'Reserve incorrect';end if;
 perform stock.apply_order('icetak',o,'waiting','[]',null);
 if (select reserved from stock.materials where code=m)<>reserved_before then raise exception 'Waiting release incorrect';end if;
 perform stock.apply_order('icetak',o,'to_ship',d,null);
 result:=stock.apply_order('icetak',o,'consume',d,now());
 if result<>'done' or (select on_hand from stock.materials where code=m)<>base-1 then raise exception 'Consumption incorrect';end if;
 perform stock.apply_order('icetak',o,'consume',d,now());
 perform stock.apply_order('icetak',o,'cancelled','[]',null);
 if (select on_hand from stock.materials where code=m)<>base-1 then raise exception 'Duplicate deduction or cancelled refund';end if;
 r:=stock.resolve_line('{"source":"shopee","category":"glossy","part":"glossy","line_key":"Q","quantity":2}');
 if jsonb_array_length(r->'allocations')<>2 or (r#>>'{allocations,0,quantity}')::numeric<>2 or (r#>>'{allocations,1,quantity}')::numeric<>2 then raise exception 'Glossy tape mismatch';end if;
 r:=stock.resolve_line('{"source":"icetak","category":"glossy","part":"glossy","line_key":"Q","quantity":2,"size":"custom"}');
 if not r?'error' then raise exception 'Custom size guessed';end if;
 r:=stock.resolve_line('{"source":"shopee","line_key":"A","part":"acrylic","category":"acrylic","size":"Lilac (light Purple),A6 (5.5x4inch) max","variation":"Lilac (light Purple),A6 (5.5x4inch) max","quantity":1}');
 if r#>>'{allocations,0,material_code}'<>'CU-86czdj0e3' then raise exception 'Lilac choice mismatch';end if;
 insert into stock.order_state(source,order_id,reference,stage) values('icetak',old_count,'QA-INTERNAL-COUNT','consume');
 update stock.materials set activated_at=now()-interval '2 days',counted_at=now()-interval '1 hour' where code=m;
 result:=stock.apply_order('icetak',old_count,'consume',d,now()-interval '1 day');
 if result<>'blocked' or not exists(select 1 from stock.issues where order_id=old_count and code='before_count') then raise exception 'Stocktake guard bypassed';end if;
 -- Server pagination and priority include the complete material list.
 r:=stock.snapshot('{}');
 if jsonb_array_length(r->'materials')<>(select count(*) from stock.materials) or not r?'issues_total' then raise exception 'Incomplete snapshot';end if;
 for n in 1..jsonb_array_length(r->'materials')-1 loop
  if (r#>>array['materials',(n-1)::text,'priority'])::int>(r#>>array['materials',n::text,'priority'])::int then raise exception 'Critical stock not first';end if;
 end loop;
 if has_table_privilege('anon','stock.material_health','select') or has_function_privilege('authenticated','stock.snapshot(jsonb)','execute') then raise exception 'Private inventory exposed';end if;
 -- Replaying actual already-consumed records cannot re-interpret or duplicate usage.
 select md5(jsonb_agg(jsonb_build_array(code,on_hand,reserved) order by code)::text) into row_before from stock.materials;
 select count(*) into ledger_before from stock.movements;
 for sample in select source,order_id from stock.order_state where consumed_at is not null and excluded_at is null order by updated_at desc limit 20 loop
  perform stock.process_order(sample.source,sample.order_id);
  perform stock.process_order(sample.source,sample.order_id);
 end loop;
 select md5(jsonb_agg(jsonb_build_array(code,on_hand,reserved) order by code)::text) into row_after from stock.materials;
 if row_before<>row_after or ledger_before<>(select count(*) from stock.movements) then raise exception 'Live replay changed stock';end if;
end $verify$;
rollback;
select 'stock reconciliation suite passed; all fixture effects reverted' result;
