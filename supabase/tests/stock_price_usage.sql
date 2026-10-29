-- Native private inventory and transient canonical fixtures only; never retain an order or send a message.
begin;
do $verify$
declare p jsonb; r jsonb; oid uuid:=gen_random_uuid(); iid uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid();
 raw_before numeric; reserved_before numeric; before_moves bigint; stock_code text:='CU-1yzqnfk';
begin
 perform pg_advisory_xact_lock(hashtextextended('stock:writer',0));
 p:='{"source":"icetak","line_key":"L","part":"edible","category":"edible","size":"custom","currency":"MYR","standard_unit_price":24,"quantity":1}';
 r:=stock.resolve_line(p);if (r#>>'{allocations,0,quantity}')::numeric is distinct from 1 then raise exception 'RM24 not one A4';end if;
 r:=stock.resolve_line(p||'{"standard_unit_price":36}');if (r#>>'{allocations,0,quantity}')::numeric is distinct from 1.5 then raise exception 'RM36 not 1.5 A4';end if;
 r:=stock.resolve_line(p||'{"standard_unit_price":36,"quantity":2}');if (r#>>'{allocations,0,quantity}')::numeric is distinct from 3 then raise exception 'Unit price/quantity double counted';end if;
 r:=stock.resolve_line(p||'{"unit_discounted_price":12,"line_subtotal":12}');if (r#>>'{allocations,0,quantity}')::numeric is distinct from 1 then raise exception 'Discount changed physical use';end if;
 r:=stock.resolve_line(p||'{"currency":"SGD"}');if not r?'error' then raise exception 'Foreign currency treated as RM';end if;
 r:=stock.resolve_line(p||'{"bundled":true}');if not r?'error' then raise exception 'Bundle amount applied to both layers';end if;
 r:=stock.resolve_line(p||'{"standard_unit_price":0}');if not r?'error' then raise exception 'Missing price/size guessed';end if;
 select on_hand,reserved into raw_before,reserved_before from stock.materials where materials.code=stock_code;
 insert into public.orders(id,order_no,created_at,status,payment_status,delivery_method,customer_confirmed,source,whatsapp_opt_in,delivery_name)
 values(oid,'QA-PRICE-ROLLBACK',now(),'Processing','cash_counter','postal',true,'admin',false,'Inventory verification');
 insert into public.order_items(id,order_id,product_type,k,title,qty,size,price,review_required)
 values(iid,oid,'edible','edible','Edible Image',2,'custom',36,false);
 r:=jsonb_build_object('outcome',stock.process_order('icetak',oid));
 if r->>'outcome'<>'done' or (select reserved from stock.materials where materials.code=stock_code) is distinct from reserved_before+3 then raise exception 'Actual price input did not reserve three A4: %, input %, issues %',r,stock.order_input('icetak',oid),(select jsonb_agg(to_jsonb(i)) from stock.issues i where order_id=oid);end if;
 update stock.work_queue set status='done' where source='icetak' and order_id=oid;
 update public.order_items set price=24 where id=iid;
 if not exists(select 1 from stock.work_queue where source='icetak' and order_id=oid and status='pending') then raise exception 'Price edit did not wake worker';end if;
 perform stock.process_order('icetak',oid);
 if (select reserved from stock.materials where materials.code=stock_code)<>reserved_before+2 then raise exception 'Price edit did not replace reserve';end if;
 update public.orders set status='Shipped',updated_at=now() where id=oid;
 perform stock.process_order('icetak',oid);
 if (select on_hand from stock.materials where materials.code=stock_code)<>raw_before-2 or (select reserved from stock.materials where materials.code=stock_code)<>reserved_before then raise exception 'Actual shipping did not consume exactly once';end if;
 select count(*) into before_moves from stock.movements;
 perform stock.process_order('icetak',oid);
 update public.order_items set price=36 where id=iid;perform stock.process_order('icetak',oid);
 if (select count(*) from stock.movements)<>before_moves then raise exception 'Fulfilled pricing reinterpreted usage';end if;
 -- Canonical production completed before a later stocktake is already included in the physical count.
 oid:=gen_random_uuid();iid:=gen_random_uuid();cid:=gen_random_uuid();
 insert into public.orders(id,order_no,created_at,status,payment_status,delivery_method,customer_confirmed,source,whatsapp_opt_in,delivery_name,production_completed_at)
 values(oid,'QA-PREPARED-ROLLBACK',now()-interval '1 day','AWB Created','cash_counter','postal',true,'admin',false,'Inventory verification',now()-interval '1 day');
 insert into public.order_items(id,order_id,product_type,k,title,qty,size,price) values(iid,oid,'edible','edible','Edible Image',1,'A4',24);
 insert into public.production_components(id,order_id,order_item_id,component_type,label,clickup_status,progress_percent,progress_stage,last_synced_at,updated_at)
 values(cid,oid,iid,'edible','QA native fixture','design edible image',50,4,now()-interval '1 day',now()-interval '1 day');
 if stock.order_input('icetak',oid)->>'prepared_at' is not null then raise exception 'Unfinished component treated as prepared';end if;
 perform stock.process_order('icetak',oid);
 update public.production_components set clickup_status='complete',progress_percent=100,progress_stage=7 where id=cid;
 if stock.order_input('icetak',oid)->>'stage'<>'to_ship' then raise exception 'Production completion falsely marked shipped';end if;
 perform stock.process_order('icetak',oid);
 if not exists(select 1 from stock.order_state where source='icetak' and order_id=oid and excluded_at is not null) then raise exception 'Count-covered completed production still reserved';end if;
 if (select on_hand from stock.materials where materials.code=stock_code)<>raw_before-2 or (select reserved from stock.materials where materials.code=stock_code)<>reserved_before then raise exception 'Count-covered production changed raw stock';end if;
 if exists(select 1 from stock.material_health where ledger_mismatch) then raise exception 'Ledger mismatch';end if;
 if has_function_privilege('anon','stock.resolve_line(jsonb)','execute') or has_function_privilege('authenticated','stock.order_input(text,uuid)','execute') then raise exception 'Private stock functions exposed';end if;
end $verify$;
rollback;
select 'Price formula, quantities/discount/currency/bundle guards, actual reserve/edit/ship/idempotency and count-covered production passed; all effects reverted.' result;
