-- Compare-and-swap patches preserve current privileges and reject a changed production baseline.
select pg_advisory_xact_lock(hashtextextended('stock:writer',0));
do $patch$
declare d text:=btrim(pg_get_functiondef('stock.apply_order(text,uuid,text,jsonb,timestamp with time zone)'::regprocedure), E' \n\r\t');
begin
 if md5(d)<>'128e59788f9e9b873c1ca8af8152d354' then raise exception 'Stock function changed since review: stock.apply_order';end if;
 d:=overlay(d placing $edit$;$edit$ from 7346 for 0);
 d:=overlay(d placing $edit$));blocked:=true;
   elsif m.counted_at>m.activated_at and p_evidence<m.counted_at then
    perform stock.issue(p_source,p_id,d->>'line_key','before_count','Penghantaran sebelum kiraan fizikal terkini. Sahkan penggunaan sudah termasuk dalam baki.',jsonb_build_object('material_code',m.code,'evidence_at',p_evidence,'counted_at',m.counted_at$edit$ from 3538 for 0);
 if md5(d)<>'0c91d97ef9064ab587dfb3bc3ba28d13' then raise exception 'Stock patch checksum failed: stock.apply_order';end if;
 execute d;
end $patch$;

do $patch$
declare d text:=btrim(pg_get_functiondef('stock.order_input(text,uuid)'::regprocedure), E' \n\r\t');
begin
 if md5(d)<>'cd0389fd7e8c24837c16eaf87736e4fb' then raise exception 'Stock function changed since review: stock.order_input';end if;
 d:=overlay(d placing $edit$;$edit$ from 4663 for 0);
 d:=overlay(d placing $edit$ else coalesce(nullif(i.customization->>'shape',''),i.style) end$edit$ from 4154 for 0);
 d:=overlay(d placing $edit$''),$edit$ from 4146 for 0);
 d:=overlay(d placing $edit$''),nullif($edit$ from 4120 for 0);
 d:=overlay(d placing $edit$(nullif$edit$ from 4092 for 0);
 d:=overlay(d placing $edit$ase when cat='acrylic' then c$edit$ from 4085 for 0);
 d:=overlay(d placing $edit$,'')$edit$ from 3962 for 0);
 d:=overlay(d placing $edit$nullif($edit$ from 3938 for 0);
 d:=overlay(d placing $edit$in$edit$ from 2541 for 2);
 d:=overlay(d placing $edit$)$edit$ from 821 for 0);
 d:=overlay(d placing $edit$coalesce(evidence,$edit$ from 793 for 0);
 d:=overlay(d placing $edit$select min(occurred_at) into evidence from public.marketplace_order_status_history
   where order_id=p_id and status in ('SHIPPED','LOGISTICS_PICKUP_DONE','TO_CONFIRM_RECEIVE','LOGISTICS_DELIVERY_DONE','COMPLETED');
  $edit$ from 783 for 0);
 if md5(d)<>'e20f39e3c16e76b8f2968a4eb7398c64' then raise exception 'Stock patch checksum failed: stock.order_input';end if;
 execute d;
end $patch$;

do $patch$
declare d text:=btrim(pg_get_functiondef('stock.process_order(text,uuid)'::regprocedure), E' \n\r\t');
begin
 if md5(d)<>'01db79bd6cec355a4064002104d10113' then raise exception 'Stock function changed since review: stock.process_order';end if;
 d:=overlay(d placing $edit$;$edit$ from 3671 for 0);
 d:=overlay(d placing $edit$stage=input->>'stage',$edit$ from 3099 for 0);
 d:=overlay(d placing $edit$and st.consumed_at is null then
  -- Reserve the known lines; never retain a removed or now-unmapped colour as if still selected.
  perform stock.apply_order(p_source,p_id,'to_ship',desired,null);
 end if;
 if has_error $edit$ from 3065 for 0);
 d:=overlay(d placing $edit$
  if jsonb_array_length(input->'lines')=0 and coalesce((input->>'detail_complete')::boolean,false) then perform stock.apply_order(p_source,p_id,'to_ship','[]',null);end if;$edit$ from 2568 for 0);
 d:=overlay(d placing $edit$ull)$edit$ from 2452 for 2);
 d:=overlay(d placing $edit$[]',$edit$ from 2449 for 2);
 d:=overlay(d placing $edit$stock.apply_order(p_source,p_id,stage,$edit$ from 2448 for 0);
 d:=overlay(d placing $edit$ct from first_evidence$edit$ from 1880 for 3);
 d:=overlay(d placing $edit$disti$edit$ from 1879 for 0);
 d:=overlay(d placing $edit$t$edit$ from 1759 for 2);
 d:=overlay(d placing $edit$a$edit$ from 1758 for 0);
 d:=overlay(d placing $edit$$edit$ from 1753 for 3);
 if md5(d)<>'93ebdf08a69a119a9778d4dbae6842db' then raise exception 'Stock patch checksum failed: stock.process_order';end if;
 execute d;
end $patch$;

do $patch$
declare d text:=btrim(pg_get_functiondef('stock.order_trigger()'::regprocedure), E' \n\r\t');
begin
 if md5(d)<>'c074f622bf065d5a5ccc855aa4fad986' then raise exception 'Stock function changed since review: stock.order_trigger';end if;
 d:=overlay(d placing $edit$;$edit$ from 2546 for 0);
 d:=overlay(d placing $edit$
  if tg_op='UPDATE' and old.order_id is distinct from new.order_id then perform stock.enqueue('icetak',old.order_id);end if;
 $edit$ from 2065 for 0);
 d:=overlay(d placing $edit$
  if tg_op='UPDATE' and old.order_id is distinct from new.order_id then perform stock.enqueue('shopee',old.order_id);end if;
 $edit$ from 1927 for 0);
 d:=overlay(d placing $edit$status_history' then
  if new.status in ('SHIPPED','LOGISTICS_PICKUP_DONE','TO_CONFIRM_RECEIVE','LOGISTICS_DELIVERY_DONE','COMPLETED') then perform stock.enqueue('shopee',new.order_id);end if;
 elsif tg_table_name='marketplace_order_$edit$ from 1916 for 0);
 d:=overlay(d placing $edit$old.order_id,$edit$ from 1436 for 0);
 d:=overlay(d placing $edit$order_id,new.$edit$ from 1292 for 0);
 d:=overlay(d placing $edit$old.admin_status,old.fulfillment_stage,$edit$ from 1020 for 0);
 d:=overlay(d placing $edit$new.admin_status,new.fulfillment_stage,$edit$ from 803 for 0);
 d:=overlay(d placing $edit$old.order_id,old.provider_item_id,old.provider_variation_id,$edit$ from 643 for 0);
 d:=overlay(d placing $edit$order_id,new.provider_item_id,new.provider_variation_id,new.$edit$ from 533 for 0);
 if md5(d)<>'c7928dece3451faac145dfc630abe854' then raise exception 'Stock patch checksum failed: stock.order_trigger';end if;
 execute d;
end $patch$;

create or replace trigger stock_direct_order after insert or update of admin_status,fulfillment_stage,status,payment_status,customer_confirmed,production_approved,shipment_status_group,shipment_updated_at,pickup_ready_at,delivery_method,delivery,source on public.orders for each row execute function stock.order_trigger();
create or replace trigger stock_direct_items after insert or update of order_id,qty,size,style,customization,product_type,k,title,product_id,product_snapshot or delete on public.order_items for each row execute function stock.order_trigger();
create or replace trigger stock_marketplace_items after insert or update of order_id,provider_item_id,provider_variation_id,is_current,quantity,title,variation_name,item_sku,variation_sku or delete on public.marketplace_order_items for each row execute function stock.order_trigger();
create trigger stock_marketplace_history after insert on public.marketplace_order_status_history for each row execute function stock.order_trigger();
create index if not exists stock_history_fulfillment_evidence on public.marketplace_order_status_history(order_id,occurred_at)
 where status in ('SHIPPED','LOGISTICS_PICKUP_DONE','TO_CONFIRM_RECEIVE','LOGISTICS_DELIVERY_DONE','COMPLETED');

