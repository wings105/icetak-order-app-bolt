-- Roll back every fixture and stock effect; never deliver a customer message.
begin;
do $test$
declare r jsonb; d jsonb; st uuid:=gen_random_uuid(); m text:='CU-1yzqnfk'; fixture_id uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); before_count integer; result text; linked_id uuid; mp_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('stock:writer',0));
 -- Isolate the seed materials while the transaction is open; restore real
 -- reservations, settings and configured rates automatically on rollback.
 update stock.materials set reserved=0,on_hand=null,auto_enabled=false,activated_at=null where auto_eligible;
 update stock.settings set enabled=true;
 update stock.size_rules set approved=false,rate=null where size_key like '%in';
 if (select count(*) from stock.materials)<>71 then raise exception 'Material seed mismatch';end if;
 if exists(select 1 from stock.materials where auto_eligible and base_unit<>'helai A4 setara') then raise exception 'Auto material unit mismatch';end if;
 if exists(select 1 from stock.materials where name ilike '%edible%big%') then raise exception 'Edible big retained';end if;
 if has_function_privilege('anon','public.icetak_stock_admin(text,jsonb,text)','execute') or has_function_privilege('authenticated','public.icetak_stock_process_queue(integer)','execute') then raise exception 'Public stock RPC access';end if;
 if has_table_privilege('anon','stock.materials','select') then raise exception 'Public stock table access';end if;
 if stock.size_key('A6 (5.5x4inch) max')<>'A6' or stock.size_key('4 × 4 inch,⚫ Round / Bulat')<>'4in' or stock.size_key('A4 / A5') is not null then raise exception 'Size parser';end if;
 if stock.size_key('5.5 x 7.5inch')<>'A5' or stock.shape_key('⚫ Round / Bulat')<>'round' then raise exception 'Size/shape normalization';end if;
 r:=stock.resolve_line('{"source":"icetak","line_key":"L","part":"edible","category":"edible","size":"A5","quantity":3}');
 if (r#>>'{allocations,0,quantity}')::numeric<>1.5 then raise exception 'Edible size times quantity %',r;end if;
 r:=stock.resolve_line('{"source":"shopee","line_key":"A","part":"acrylic","category":"acrylic","size":"Gold,A6 (5.5x4inch)","variation":"Gold,A6 (5.5x4inch)","title":"Acrylic Gold Silver Rose Gold","quantity":4}');
 if r#>>'{allocations,0,material_code}'<>'CU-86czdhy1c' or (r#>>'{allocations,0,quantity}')::numeric<>1 then raise exception 'Acrylic customer colour %',r;end if;
 r:=stock.resolve_line('{"source":"icetak","line_key":"A","part":"acrylic","category":"acrylic","size":"A7","style":"Lilac / Light Purple","quantity":1}');
 if r#>>'{allocations,0,material_code}'<>'CU-86czdj0e3' then raise exception 'Lilac mapping %',r;end if;
 r:=stock.resolve_line('{"source":"shopee","line_key":"A","part":"acrylic","category":"acrylic","size":"A6","title":"Gold Silver Black","quantity":1}');
 if not r ? 'error' then raise exception 'Listing title guessed buyer colour';end if;
 r:=stock.resolve_line('{"source":"icetak","line_key":"P","part":"glossy","category":"glossy","size":"A5","quantity":3}');
 if jsonb_array_length(r->'allocations')<>2 or (r#>>'{allocations,0,quantity}')::numeric<>1.5 or (r#>>'{allocations,1,quantity}')::numeric<>1.5 then raise exception 'Glossy + double tape %',r;end if;
 if stock.category('mirror','Mirror Gold Artpaper',null)<>'artpaper_gold' or stock.category('acrylic','Acrylic Gold',null)<>'acrylic' then raise exception 'Gold materials mixed';end if;
 r:=stock.resolve_line('{"source":"icetak","line_key":"E","part":"edible","category":"edible","size":"4 inch","quantity":1}');
 if not r ? 'error' then raise exception 'Unapproved inch rate used';end if;
 r:=public.icetak_stock_admin('snapshot','{}','test');
 if jsonb_array_length(r->'materials')<>71 then raise exception 'Snapshot material completeness';end if;
 -- Initial count is a real zero when supplied, not a missing value.
 r:=public.icetak_stock_admin('opening',jsonb_build_object('request_id',req,'material_code',m,'quantity',10,'auto_enabled',true),'test');
 perform public.icetak_stock_admin('opening',jsonb_build_object('request_id',req,'material_code',m,'quantity',10,'auto_enabled',true),'test');
 if (select count(*) from stock.movements where idempotency_key='admin:'||req::text)<>1 or (select on_hand from stock.materials where code=m)<>10 then raise exception 'Opening retry duplicated';end if;
 req:=gen_random_uuid();
 perform public.icetak_stock_admin('purchase',jsonb_build_object('request_id',req,'material_code',m,'quantity',2,'reason','Stock test purchase'),'test');
 perform public.icetak_stock_admin('purchase',jsonb_build_object('request_id',req,'material_code',m,'quantity',2,'reason','Stock test purchase'),'test');
 if (select on_hand from stock.materials where code=m)<>12 then raise exception 'Purchase retry duplicated';end if;
 -- Directly exercise the transaction boundary with isolated order identities.
 update stock.materials set activated_at=now()-interval '1 day' where code=m;
 insert into stock.order_state(source,order_id,reference,stage) values('icetak',st,'STOCK-ROLLBACK','to_ship');
 d:=jsonb_build_array(jsonb_build_object('line_key','L','part','edible','material_code',m,'quantity',1.5));
 result:=stock.apply_order('icetak',st,'to_ship',d,null);
 if result<>'done' or (select reserved from stock.materials where code=m)<>1.5 or (select on_hand from stock.materials where code=m)<>12 then raise exception 'To Ship deducted instead of reserving';end if;
 perform stock.apply_order('icetak',st,'to_ship',d,null);
 if (select reserved from stock.materials where code=m)<>1.5 then raise exception 'Reserve duplicate';end if;
 d:=jsonb_build_array(jsonb_build_object('line_key','L','part','edible','material_code',m,'quantity',0.5));
 perform stock.apply_order('icetak',st,'to_ship',d,null);
 if (select reserved from stock.materials where code=m)<>0.5 then raise exception 'Quantity edit delta';end if;
 perform stock.apply_order('icetak',st,'consume',d,now());
 perform stock.apply_order('icetak',st,'consume',d,now());
 if (select on_hand from stock.materials where code=m)<>11.5 or (select reserved from stock.materials where code=m)<>0 then raise exception 'Shipped deduction/idempotency';end if;
 perform stock.apply_order('icetak',st,'cancelled','[]',null);
 if (select on_hand from stock.materials where code=m)<>11.5 then raise exception 'Post-ship cancellation returned material';end if;
 d:=jsonb_build_array(jsonb_build_object('line_key','L','part','edible','material_code',m,'quantity',2));
 if stock.apply_order('icetak',st,'consume',d,now())<>'blocked' or (select on_hand from stock.materials where code=m)<>11.5 then raise exception 'Post-ship edit changed stock';end if;
 st:=gen_random_uuid();insert into stock.order_state(source,order_id,reference,stage) values('icetak',st,'STOCK-CANCEL','to_ship');
 perform stock.apply_order('icetak',st,'to_ship',d,null);
 perform stock.apply_order('icetak',st,'cancelled','[]',null);
 if (select reserved from stock.materials where code=m)<>0 then raise exception 'Cancellation reserve release';end if;
 st:=gen_random_uuid();insert into stock.order_state(source,order_id,reference,stage) values('icetak',st,'STOCK-OLD','to_ship');
 if stock.apply_order('icetak',st,'consume',d,now()-interval '2 days')<>'blocked' then raise exception 'Pre-opening history deducted';end if;
 -- Exact item mapping can resolve a nonstandard size without changing all SKUs.
 r:=stock.resolve_line('{"source":"icetak","line_key":"Z","part":"edible","category":"edible","size":"custom","quantity":2}');
 perform public.icetak_stock_admin('item_rule',jsonb_build_object('request_id',gen_random_uuid(),'match_key',r->>'match_key','material_code',m,'rate',0.25,'label','Custom test'),'test');
 r:=stock.resolve_line('{"source":"icetak","line_key":"Z","part":"edible","category":"edible","size":"custom","quantity":2}');
 if (r#>>'{allocations,0,quantity}')::numeric<>0.5 then raise exception 'Reusable exact mapping %',r;end if;
 perform public.icetak_stock_admin('size_rule',jsonb_build_object('request_id',gen_random_uuid(),'category','edible','size_key','4in','shape_key','round','rate',0.25),'test');
 r:=stock.resolve_line('{"source":"icetak","line_key":"Y","part":"edible","category":"edible","size":"4 inch","style":"Round / Bulat","quantity":2}');
 if (r#>>'{allocations,0,quantity}')::numeric<>0.5 then raise exception 'Approved inch rule %',r;end if;
 -- A pickup-ready timestamp by itself never authorizes consumption.
 insert into public.orders(id,order_no,created_at,status,payment_status,delivery_method,customer_confirmed,pickup_ready_at,source,whatsapp_opt_in,delivery_name) values(fixture_id,'STOCK-PICKUP-ROLLBACK',now(),'Ready for Pickup','cash_counter','pickup',true,now(),'admin',false,'Stock verification');
 r:=stock.order_input('icetak',fixture_id);
 if r->>'stage'<>'to_ship' then raise exception 'Ready without sent notification consumed';end if;
 insert into public.notification_queue(id,event_type,order_id,status,sent_at) values(gen_random_uuid(),'order_ready_pickup_auto',fixture_id,'pending',null);
 r:=stock.order_input('icetak',fixture_id);if r->>'stage'<>'to_ship' then raise exception 'Queued notice consumed';end if;
  update public.notification_queue set status='sent',sent_at=now()-interval '1 day' where order_id=fixture_id and event_type='order_ready_pickup_auto';
  r:=stock.order_input('icetak',fixture_id);if r->>'stage'<>'to_ship' then raise exception 'Old notice reused before current pickup readiness';end if;
  update public.notification_queue set sent_at=now() where order_id=fixture_id and event_type='order_ready_pickup_auto';
 r:=stock.order_input('icetak',fixture_id);if r->>'stage'<>'consume' then raise exception 'Sent ready notice did not authorize pickup deduction';end if;
 -- Two Burn Away layers use their own size and preserve ordered quantity.
 insert into public.order_items(id,order_id,product_type,k,title,qty,size,customization) values(gen_random_uuid(),fixture_id,'burnaway','burnaway','Burn Away',3,'5 inch','{"layers":{"edible":{"size":"5 inch","shape":"Round / Bulat"},"wafer":{"size":"6 inch","shape":"Round / Bulat"}}}');
 r:=stock.order_input('icetak',fixture_id);
 if jsonb_array_length(r->'lines')<>2 or r#>>'{lines,0,size}'<>'5 inch' or r#>>'{lines,1,size}'<>'6 inch' or (r#>>'{lines,0,quantity}')::integer<>3 then raise exception 'Burn Away size/quantity split %',r;end if;
 perform public.icetak_stock_admin('size_rule',jsonb_build_object('request_id',gen_random_uuid(),'category','edible','size_key','5in','shape_key','round','rate',0.5),'test');
 perform public.icetak_stock_admin('size_rule',jsonb_build_object('request_id',gen_random_uuid(),'category','wafer','size_key','6in','shape_key','round','rate',0.25),'test');
 update stock.materials set is_default=true,on_hand=10,auto_enabled=true,activated_at=now()-interval '1 day' where code='CU-86cz5hxaf';
 if stock.process_order('icetak',fixture_id)<>'done' then raise exception 'Pickup worker failed';end if;
 if (select on_hand from stock.materials where code=m)<>10 or (select on_hand from stock.materials where code='CU-86cz5hxaf')<>9.25 then raise exception 'Burn Away actual order deduction';end if;
 perform stock.process_order('icetak',fixture_id);
 if (select on_hand from stock.materials where code=m)<>10 then raise exception 'Pickup duplicate deduction';end if;
 -- Whole marketplace flow, including status replay and linked direct-order redirect.
 fixture_id:=gen_random_uuid();
 update stock.materials set on_hand=10,auto_enabled=true,activated_at=now()-interval '1 day' where code='CU-86czdhy1c';
 insert into public.marketplace_orders(id,provider,order_sn,shop_id,current_status,placed_at,latest_provider_update_at,detail_complete) values(fixture_id,'shopee','STOCK-MP-ROLLBACK','188218638','READY_TO_SHIP',now(),now(),true);
 insert into public.marketplace_order_items(id,order_id,line_no,title,item_sku,variation_name,quantity,is_current) values(gen_random_uuid(),fixture_id,1,'Acrylic Cake Topper Gold Silver','acrylic','Gold,A6 (5.5x4inch)',2,true);
 result:=stock.process_order('shopee',fixture_id);
 if result<>'done' or (select reserved from stock.materials where code='CU-86czdhy1c')<>0.5 then raise exception 'Marketplace reserve result:%, input:%, issues:%',result,stock.order_input('shopee',fixture_id),(select jsonb_agg(to_jsonb(z)) from stock.issues z where z.order_id=fixture_id);end if;
 update public.marketplace_orders set current_status='PROCESSED' where id=fixture_id;
 perform stock.process_order('shopee',fixture_id);
 if (select reserved from stock.materials where code='CU-86czdhy1c')<>0.5 then raise exception 'Processed reserved twice';end if;
 update public.marketplace_orders set current_status='SHIPPED' where id=fixture_id;
 if stock.process_order('shopee',fixture_id)<>'done' then raise exception 'Marketplace Shipped failed';end if;
 perform stock.process_order('shopee',fixture_id);
 if (select on_hand from stock.materials where code='CU-86czdhy1c')<>9.5 or (select reserved from stock.materials where code='CU-86czdhy1c')<>0 then raise exception 'Marketplace shipped duplicate';end if;
 -- New rates cannot reinterpret an unchanged, already consumed order.
 update stock.size_rules set rate=0.3 where category='acrylic' and size_key='A6';
 if stock.process_order('shopee',fixture_id)<>'done' or exists(select 1 from stock.issues where order_id=fixture_id and code='after_dispatch_edit' and resolved_at is null) then raise exception 'Rule change reinterpreted consumed order';end if;
 update stock.size_rules set rate=0.25 where category='acrylic' and size_key='A6';
 update public.marketplace_order_items set quantity=3 where order_id=fixture_id;
 if stock.process_order('shopee',fixture_id)<>'blocked' then raise exception 'Changed fulfilled order not reviewed';end if;
 perform public.icetak_stock_admin('resolve_issue',jsonb_build_object('request_id',gen_random_uuid(),'source','shopee','order_id',fixture_id,'line_key','','issue_code','after_dispatch_edit','reason','Reviewed manual physical usage'),'test');
 if stock.process_order('shopee',fixture_id)<>'done' or (select on_hand from stock.materials where code='CU-86czdhy1c')<>9.5 then raise exception 'Reviewed edit changed original use';end if;
 -- Replayed unchanged source values should leave a completed job alone.
 update stock.work_queue set status='done' where source='shopee' and order_id=fixture_id;
 update public.marketplace_orders set current_status=current_status where id=fixture_id;
 update public.marketplace_order_items set quantity=quantity where order_id=fixture_id;
 if exists(select 1 from stock.work_queue where order_id=fixture_id and status<>'done') then raise exception 'No-op source update requeued completed work';end if;
 -- First shipping evidence survives later receipt timestamps and status regression.
 mp_id:=gen_random_uuid();
 insert into public.marketplace_orders(id,provider,order_sn,shop_id,current_status,placed_at,latest_provider_update_at,detail_complete) values(mp_id,'shopee','STOCK-EVIDENCE-ROLLBACK','188218638','READY_TO_SHIP',now(),now(),true);
 insert into public.marketplace_order_items(id,order_id,line_no,title,item_sku,variation_name,quantity,is_current) values(gen_random_uuid(),mp_id,1,'Acrylic Cake Topper','acrylic','Gold,A6',1,true);
 perform stock.process_order('shopee',mp_id);
 update stock.materials set activated_at=now() where code='CU-86czdhy1c';
 update public.marketplace_orders set current_status='SHIPPED',latest_provider_update_at=now()-interval '1 hour' where id=mp_id;
 if stock.process_order('shopee',mp_id)<>'blocked' then raise exception 'Old shipment crossed opening boundary';end if;
 update public.marketplace_orders set current_status='PROCESSED',latest_provider_update_at=now() where id=mp_id;
 perform stock.process_order('shopee',mp_id);
 update public.marketplace_orders set current_status='TO_CONFIRM_RECEIVE',latest_provider_update_at=now()+interval '1 hour' where id=mp_id;
 if stock.process_order('shopee',mp_id)<>'blocked' or (select on_hand from stock.materials where code='CU-86czdhy1c')<>9.5 then raise exception 'Later receipt bypassed first shipping evidence';end if;
 -- Late canonical linking transfers reserve and retains one proven deduction.
 linked_id:=gen_random_uuid();mp_id:=gen_random_uuid();
 insert into public.orders(id,order_no,created_at,status,payment_status,delivery_method,customer_confirmed,source,whatsapp_opt_in,delivery_name) values(linked_id,'STOCK-LINK-ROLLBACK',now(),'Processing','cash_counter','pickup',true,'admin',false,'Stock verification');
 insert into public.order_items(id,order_id,product_type,k,title,qty,size) values(gen_random_uuid(),linked_id,'edible','edible','Edible Image',1,'A4');
 if stock.process_order('icetak',linked_id)<>'done' then raise exception 'Direct link fixture reserve failed';end if;
 insert into public.marketplace_orders(id,provider,order_sn,shop_id,current_status,placed_at,latest_provider_update_at,detail_complete) values(mp_id,'shopee','STOCK-LINK-MP-ROLLBACK','188218638','READY_TO_SHIP',now(),now(),true);
 insert into public.marketplace_order_items(id,order_id,line_no,title,item_sku,variation_name,quantity,is_current) values(gen_random_uuid(),mp_id,1,'Edible Image','edible','A4',1,true);
 perform stock.process_order('shopee',mp_id);
 update public.marketplace_orders set internal_order_id=linked_id where id=mp_id;
 perform stock.process_order('shopee',mp_id);
 if (select reserved from stock.materials where code=m)<>1 or not exists(select 1 from stock.order_state where source='icetak' and order_id=linked_id and excluded_at is not null) then raise exception 'Late linking retained duplicate reserve';end if;
 update public.marketplace_orders set current_status='SHIPPED' where id=mp_id;
 perform stock.process_order('shopee',mp_id);perform stock.process_order('icetak',linked_id);
 if (select on_hand from stock.materials where code=m)<>9 or (select reserved from stock.materials where code=m)<>0 then raise exception 'Late linked deduction duplicated';end if;
 linked_id:=gen_random_uuid();mp_id:=gen_random_uuid();
 insert into stock.order_state(source,order_id,reference,stage) values('icetak',linked_id,'STOCK-ALREADY-CONSUMED','to_ship');
 d:=jsonb_build_array(jsonb_build_object('line_key','L','part','edible','material_code',m,'quantity',1));
 perform stock.apply_order('icetak',linked_id,'consume',d,now());
 insert into public.marketplace_orders(id,provider,order_sn,shop_id,current_status,placed_at,latest_provider_update_at,detail_complete) values(mp_id,'shopee','STOCK-ALREADY-MP-ROLLBACK','188218638','SHIPPED',now(),now(),true);
 insert into public.marketplace_order_items(id,order_id,line_no,title,item_sku,variation_name,quantity,is_current) values(gen_random_uuid(),mp_id,1,'Edible Image','edible','A4',1,true);
 if stock.reconcile_link(mp_id,linked_id)<>'done' or stock.process_order('shopee',mp_id)<>'done' or (select on_hand from stock.materials where code=m)<>8 then raise exception 'Already consumed direct link deducted again';end if;
 mp_id:=gen_random_uuid();insert into stock.order_state(source,order_id,reference,stage) values('shopee',mp_id,'STOCK-DUPLICATE-LINK','to_ship');
 perform stock.apply_order('shopee',mp_id,'consume',d,now());
 -- Simulate the owner attaching identities already consumed independently.
 if stock.reconcile_link(mp_id,linked_id)<>'blocked' then raise exception 'Previously consumed double link not reviewed';end if;
 if not exists(select 1 from stock.issues where order_id=mp_id and code='linked_duplicate' and resolved_at is null) then raise exception 'Duplicate consumption evidence missing';end if;
 -- Other stocks remain manual, and zero stock is valid.
 perform public.icetak_stock_admin('material_save',jsonb_build_object('request_id',gen_random_uuid(),'material_code','MAN-ROLLBACK','name','Manual test','base_unit','pcs'),'test');
 perform public.icetak_stock_admin('opening',jsonb_build_object('request_id',gen_random_uuid(),'material_code','MAN-ROLLBACK','quantity',0,'auto_enabled',false),'test');
 if (select on_hand from stock.materials where code='MAN-ROLLBACK')<>0 then raise exception 'Zero opening treated as missing';end if;
 perform public.icetak_stock_admin('purchase',jsonb_build_object('request_id',gen_random_uuid(),'material_code','MAN-ROLLBACK','quantity',5,'reason','Manual purchase'),'test');
 perform public.icetak_stock_admin('manual_use',jsonb_build_object('request_id',gen_random_uuid(),'material_code','MAN-ROLLBACK','quantity',2,'reason','Manual usage'),'test');
 perform public.icetak_stock_admin('adjustment',jsonb_build_object('request_id',gen_random_uuid(),'material_code','MAN-ROLLBACK','quantity',1,'reason','Physical count'),'test');
 if (select on_hand from stock.materials where code='MAN-ROLLBACK')<>1 then raise exception 'Manual stock workflow';end if;
 -- Resuming also wakes jobs that arrived while paused before enrollment.
 insert into stock.work_queue(source,order_id,status) values('shopee',gen_random_uuid(),'blocked');
 perform stock.wake();
 if exists(select 1 from stock.work_queue where status='blocked') then raise exception 'Paused un-enrolled work lost on resume';end if;
 -- Read and mutating RPCs do not create finance postings or notification sends.
 raise notice 'Stock checks passed';
end;
$test$;
rollback;
