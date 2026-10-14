select pg_advisory_xact_lock(hashtextextended('stock:writer',0));
create or replace function stock.order_trigger() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if tg_table_name='marketplace_orders' then if row(new.current_status,new.detail_complete,new.internal_order_id,new.placed_at,new.latest_provider_update_at) is not distinct from row(old.current_status,old.detail_complete,old.internal_order_id,old.placed_at,old.latest_provider_update_at) then return new;end if;end if;
  if tg_table_name='marketplace_order_items' then if row(new.is_current,new.quantity,new.title,new.variation_name,new.item_sku,new.variation_sku) is not distinct from row(old.is_current,old.quantity,old.title,old.variation_name,old.item_sku,old.variation_sku) then return new;end if;end if;
  if tg_table_name='orders' then if row(new.status,new.payment_status,new.customer_confirmed,new.production_approved,new.shipment_status_group,new.shipment_updated_at,new.pickup_ready_at,new.delivery_method,new.delivery,new.source) is not distinct from row(old.status,old.payment_status,old.customer_confirmed,old.production_approved,old.shipment_status_group,old.shipment_updated_at,old.pickup_ready_at,old.delivery_method,old.delivery,old.source) then return new;end if;end if;
  if tg_table_name='order_items' then if row(new.qty,new.size,new.style,new.customization,new.product_type,new.k,new.title,new.product_id,new.product_snapshot->>'sku') is not distinct from row(old.qty,old.size,old.style,old.customization,old.product_type,old.k,old.title,old.product_id,old.product_snapshot->>'sku') then return new;end if;end if;
  if tg_table_name='notification_queue' then if row(new.status,new.sent_at) is not distinct from row(old.status,old.sent_at) then return new;end if;end if;
 end if;
 if tg_table_name='marketplace_orders' then if new.provider='shopee' then perform stock.enqueue('shopee',new.id);end if;
 elsif tg_table_name='marketplace_order_items' then perform stock.enqueue('shopee',case when tg_op='DELETE' then old.order_id else new.order_id end);
 elsif tg_table_name='order_items' then perform stock.enqueue('icetak',case when tg_op='DELETE' then old.order_id else new.order_id end);
 elsif tg_table_name='notification_queue' then
  if new.status='sent' and new.sent_at is not null and new.event_type in ('order_ready_pickup','order_ready_pickup_auto') and new.order_id is not null then perform stock.enqueue('icetak',new.order_id);end if;
 else perform stock.enqueue('icetak',new.id);end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
drop trigger stock_marketplace_order on public.marketplace_orders;
create trigger stock_marketplace_order after insert or update of current_status,detail_complete,internal_order_id,placed_at,latest_provider_update_at on public.marketplace_orders for each row execute function stock.order_trigger();
drop trigger stock_direct_order on public.orders;
create trigger stock_direct_order after insert or update of status,payment_status,customer_confirmed,production_approved,shipment_status_group,shipment_updated_at,pickup_ready_at,delivery_method,delivery,source on public.orders for each row execute function stock.order_trigger();
drop trigger stock_direct_items on public.order_items;
create trigger stock_direct_items after insert or update of qty,size,style,customization,product_type,k,title,product_id,product_snapshot or delete on public.order_items for each row execute function stock.order_trigger();
